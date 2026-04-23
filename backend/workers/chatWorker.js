/**
 * Chat Worker — AI pipeline xử lý tin nhắn Messenger
 *
 * State machine 3 trạng thái:
 *  State 0 — chưa có identified_product  → hỏi tên/ảnh SP, tối đa 5 lượt
 *  State 1 — có SP, chưa confirm          → show SP + hỏi confirm, tối đa 8 lượt
 *  State 2 — SP đã khoá                   → kịch bản chốt đơn, tối đa 5 lượt
 *
 * Phân tích chỉ dựa vào tin nhắn MỚI NHẤT của khách (không dùng history).
 */
const axios = require('axios');
const { Worker } = require('bullmq');
const { getRedisConnection } = require('../queues/redisConnection');
const chatDB = require('../db/chatDB');
const { sendFbMessage, sendFbImage, sendFbImageWithCaption } = require('../utils/fbSendApi');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// Giới hạn lượt AI reply theo từng state
const LIMIT_NO_PRODUCT  = 5;
const LIMIT_UNCONFIRMED = 8;
const LIMIT_CLOSING     = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────

const callAI = async (path, body) => {
  const resp = await axios.post(`${AI_URL}/chat${path}`, body, { timeout: 20000 });
  return resp.data;
};

const getLastCustomerMessage = (messages) =>
  [...messages].reverse().find((m) => m.senderType === 'customer');

const isWithinActiveHours = (activeHours) => {
  if (!activeHours) return true;

  // Luôn dùng Asia/Ho_Chi_Minh vì container chạy UTC
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'short',
    hour:    '2-digit',
    minute:  '2-digit',
    hour12:  false,
  });
  const parts  = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const dayMap = { Sun:'sun', Mon:'mon', Tue:'tue', Wed:'wed', Thu:'thu', Fri:'fri', Sat:'sat' };
  const todayKey = dayMap[parts.weekday];
  const hhmm     = parseInt(parts.hour) * 100 + parseInt(parts.minute);

  const range = activeHours[todayKey];
  if (!range || !range.enabled) return false;

  const [sH, sM] = (range.start || '00:00').split(':').map(Number);
  const [eH, eM] = (range.end   || '23:59').split(':').map(Number);
  return hhmm >= sH * 100 + sM && hhmm <= eH * 100 + eM;
};

// Tìm SP trong Qdrant, trả về enriched product object hoặc null
const _searchProduct = async ({ session, query, imageUrl = null }) => {
  try {
    const result = await callAI('/generate-reply', {
      customer_message: query,
      page_id:          session.pageId,
      user_id:          session.userId,
      image_url:        imageUrl || null,
      top_k:            1,
    });
    const found = result.products?.[0];
    if (!found) return null;
    const p = found.payload || found;
    return {
      product: {
        name:      p.product_name || query,
        query,
        price:     p.current_price || p.price || null,
        image_url: result.product_images?.[0] || null,
        content:   p.content || p.what_is_product || '',
      },
      imageUrl: result.product_images?.[0] || null,
    };
  } catch {
    return null;
  }
};

// Gửi tin nhắn AI + lưu DB + tăng turn count
const _sendAndSave = async ({ session, reply, intent = null, isConfirmationSummary = false }) => {
  await sendFbMessage(session.pageId, session.customerPsid, reply);
  const msg = await chatDB.saveMessage({
    sessionId:             session.id,
    senderType:            'ai',
    content:               reply,
    intentAtTime:          intent || session.intent,
    isConfirmationSummary,
  });
  await chatDB.incrementTurnCount(session.id);
  await chatDB.touchSession(session.id);
  return msg;
};

// Gửi kịch bản chốt: ảnh SP (nếu có) + text
const _sendClosingScript = async ({ session, identifiedProduct, aiSettings }) => {
  const { reply } = await callAI('/generate-closing', {
    product_name:    identifiedProduct.name,
    price:           identifiedProduct.price || null,
    product_content: identifiedProduct.content || '',
    reply_style:     aiSettings?.replyStyle || null,
  });

  if (identifiedProduct.image_url) {
    await sendFbImageWithCaption(session.pageId, session.customerPsid, identifiedProduct.image_url, reply);
  } else {
    await sendFbMessage(session.pageId, session.customerPsid, reply);
  }
  await chatDB.saveMessage({ sessionId: session.id, senderType: 'ai', content: reply });
  await chatDB.incrementTurnCount(session.id);
  await chatDB.touchSession(session.id);
  return { handled: 'closing_script_sent' };
};

// ── Processor chính ───────────────────────────────────────────────────────────

const processChatJob = async (job) => {
  const { sessionId, messageId } = job.data;

  // ── Guards cơ bản ──────────────────────────────────────────────────────────
  const session = await chatDB.getSessionById(sessionId);
  if (!session) return { skipped: 'session_not_found' };
  if (session.aiMode === 'HUMAN') return { skipped: 'human_mode' };

  const aiSettings = await chatDB.getAiPageSettingsByPageId(session.pageId).catch(() => null);
  if (aiSettings && !aiSettings.aiEnabled) return { skipped: 'ai_disabled' };
  if (aiSettings?.activeHours && !isWithinActiveHours(aiSettings.activeHours)) {
    return { skipped: 'outside_active_hours' };
  }

  const messages = await chatDB.getSessionMessages(sessionId, 20);

  // Dùng đúng tin nhắn đã trigger job; fallback sang latest nếu không có messageId
  let lastCustomer = messageId
    ? await chatDB.getMessageById(messageId)
    : null;
  if (!lastCustomer || lastCustomer.senderType !== 'customer') {
    lastCustomer = getLastCustomerMessage(messages);
  }
  if (!lastCustomer) return { skipped: 'no_customer_message' };

  // ── Đọc trạng thái hiện tại ────────────────────────────────────────────────
  const {
    identifiedProduct, productConfirmed,
    noProductTurns, unconfirmedTurns, closingTurns,
  } = session;

  // ── Kiểm tra DỪNG trước khi làm gì ────────────────────────────────────────
  if (!identifiedProduct && noProductTurns >= LIMIT_NO_PRODUCT) {
    await chatDB.updateSessionAiMode(sessionId, 'HUMAN');
    return { skipped: 'dung_no_product', turns: noProductTurns };
  }
  if (identifiedProduct && !productConfirmed && unconfirmedTurns >= LIMIT_UNCONFIRMED) {
    await chatDB.updateSessionAiMode(sessionId, 'HUMAN');
    return { skipped: 'dung_unconfirmed', turns: unconfirmedTurns };
  }
  if (identifiedProduct && productConfirmed && closingTurns >= LIMIT_CLOSING) {
    await chatDB.updateSessionAiMode(sessionId, 'HUMAN');
    return { skipped: 'dung_closing', turns: closingTurns };
  }

  // ── Phân tích tin nhắn mới nhất ────────────────────────────────────────────
  const hasImage = (lastCustomer.attachments || []).some((a) => a.type === 'image');
  const imageUrl = hasImage
    ? (lastCustomer.attachments || []).find((a) => a.type === 'image')?.url
    : null;

  const classify = await callAI('/classify-intent', {
    message:   lastCustomer.content || '',
    has_image: hasImage,
  });
  console.log('[CHAT WORKER] classify:', JSON.stringify(classify), '| msg:', lastCustomer.content?.slice(0, 60));
  const { has_product_signal, product_hint, message_intent, product_feedback } = classify;

  // ════════════════════════════════════════════════════════════════════════════
  // STATE 0 — Chưa có identified_product
  // ════════════════════════════════════════════════════════════════════════════
  if (!identifiedProduct) {
    if (has_product_signal && product_hint) {
      const found = await _searchProduct({ session, query: product_hint, imageUrl });
      if (found) {
        await chatDB.updateSessionIntelligence(sessionId, {
          identifiedProduct: found.product,
          noProductTurns:    0,
        });
        const { reply } = await callAI('/generate-product-confirm', {
          product_name: found.product.name,
        });
        if (found.imageUrl) {
          await sendFbImage(session.pageId, session.customerPsid, found.imageUrl);
        }
        await _sendAndSave({ session, reply });
        return { handled: 'state0_product_found', product: found.product.name };
      }
    }

    // Không tìm được SP → hỏi lại
    let reply;
    if (message_intent === 'joking') {
      const probe = await callAI('/generate-probe', { customer_message: lastCustomer.content });
      reply = probe.reply;
    } else {
      reply = 'Anh/chị muốn tìm sản phẩm gì ạ? Anh/chị nhắn tên SP hoặc gửi ảnh tham khảo để em hỗ trợ ngay nhé!';
    }
    await _sendAndSave({ session, reply });
    await chatDB.incrementCounter(sessionId, 'no_product_turns');
    return { handled: 'state0_ask_product', turns: noProductTurns + 1 };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATE 1 — Có identified_product, chưa confirm
  // ════════════════════════════════════════════════════════════════════════════
  if (identifiedProduct && !productConfirmed) {

    // Khách từ chối SP hiện tại
    if (product_feedback === 'denied') {
      if (has_product_signal && product_hint) {
        const found = await _searchProduct({ session, query: product_hint, imageUrl });
        if (found) {
          // SP mới → reset unconfirmed_turns
          await chatDB.updateSessionIntelligence(sessionId, {
            identifiedProduct: found.product,
            unconfirmedTurns:  0,
          });
          const { reply } = await callAI('/generate-product-confirm', {
            product_name: found.product.name,
          });
          if (found.imageUrl) {
            await sendFbImage(session.pageId, session.customerPsid, found.imageUrl);
          }
          await _sendAndSave({ session, reply });
          return { handled: 'state1_new_product', product: found.product.name };
        }
      }
      // Không có SP mới → về State 0
      await chatDB.updateSessionIntelligence(sessionId, {
        identifiedProduct: null,
        productConfirmed:  false,
      });
      const reply = 'Dạ xin lỗi ạ! Anh/chị mô tả thêm hoặc gửi ảnh tham khảo để em tìm đúng hơn nhé!';
      await _sendAndSave({ session, reply });
      await chatDB.incrementCounter(sessionId, 'no_product_turns');
      return { handled: 'state1_denied_back_to_s0' };
    }

    // Khách xác nhận SP → vào State 2 ngay
    if (product_feedback === 'confirmed' || message_intent === 'confirming') {
      await chatDB.updateSessionIntelligence(sessionId, {
        productConfirmed:  true,
        unconfirmedTurns:  0,
      });
      await chatDB.updateSessionIntent(sessionId, 'Đang Chốt');
      await _sendClosingScript({ session, identifiedProduct, aiSettings });
      await chatDB.incrementCounter(sessionId, 'closing_turns');
      return { handled: 'state1_confirmed_closing' };
    }

    // Khách hỏi SP khác (product_hint khác với SP hiện tại)
    if (has_product_signal && product_hint && product_hint !== identifiedProduct.query) {
      const found = await _searchProduct({ session, query: product_hint, imageUrl });
      if (found) {
        await chatDB.updateSessionIntelligence(sessionId, {
          identifiedProduct: found.product,
          unconfirmedTurns:  0,
        });
        const { reply } = await callAI('/generate-product-confirm', {
          product_name: found.product.name,
        });
        if (found.imageUrl) {
          await sendFbImage(session.pageId, session.customerPsid, found.imageUrl);
        }
        await _sendAndSave({ session, reply });
        return { handled: 'state1_switched_product', product: found.product.name };
      }
    }

    // Hỏi thêm về cùng SP → re-confirm
    const { reply } = await callAI('/generate-product-confirm', {
      product_name: identifiedProduct.name,
    });
    await _sendAndSave({ session, reply });
    await chatDB.incrementCounter(sessionId, 'unconfirmed_turns');
    return { handled: 'state1_reconfirm', turns: unconfirmedTurns + 1 };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATE 2 — SP đã khoá → Thu thập thông tin & chốt đơn
  // ════════════════════════════════════════════════════════════════════════════
  if (identifiedProduct && productConfirmed) {

    // ── Gate 1: Khách đổi ý / từ chối SP ──────────────────────────────────
    if (product_feedback === 'denied') {
      await chatDB.updateSessionIntelligence(sessionId, {
        productConfirmed:     false,
        unconfirmedTurns:     0,
        profileConfirmAsked:  false,
      });
      await chatDB.updateSessionIntent(sessionId, 'Đang Tư Vấn');
      const { reply } = await callAI('/generate-product-confirm', { product_name: identifiedProduct.name });
      if (identifiedProduct.image_url) {
        await sendFbImage(session.pageId, session.customerPsid, identifiedProduct.image_url);
      }
      await _sendAndSave({ session, reply });
      return { handled: 'state2_product_denied_back_s1' };
    }

    if (has_product_signal && product_hint && product_hint !== identifiedProduct.query) {
      const found = await _searchProduct({ session, query: product_hint, imageUrl });
      if (found) {
        await chatDB.updateSessionIntelligence(sessionId, {
          identifiedProduct:   found.product,
          productConfirmed:    false,
          unconfirmedTurns:    0,
          profileConfirmAsked: false,
        });
        await chatDB.updateSessionIntent(sessionId, 'Đang Tư Vấn');
        const { reply } = await callAI('/generate-product-confirm', { product_name: found.product.name });
        if (found.imageUrl) await sendFbImage(session.pageId, session.customerPsid, found.imageUrl);
        await _sendAndSave({ session, reply });
        return { handled: 'state2_different_product', product: found.product.name };
      }
    }

    // ── Gate 2: Xác nhận đơn đang chờ ─────────────────────────────────────
    const existingOrder = await chatDB.getOrderBySession(sessionId);
    if (existingOrder?.status === 'PENDING_REVIEW') {
      if (message_intent === 'confirming' || product_feedback === 'confirmed') {
        await chatDB.markCustomerConfirmed(sessionId, lastCustomer.id);
        const reply = 'Dạ em đã ghi nhận đơn! Bộ phận giao hàng sẽ liên hệ xác nhận ạ 🎉';
        await _sendAndSave({ session, reply });
        await chatDB.updateSessionIntent(sessionId, 'Đã Chốt');
        await chatDB.updateSessionAiMode(sessionId, 'HUMAN');
        return { handled: 'state2_order_confirmed' };
      }
      // Đơn chờ xác nhận, khách hỏi thêm → nhắc confirm
      const reply = 'Dạ đơn đã được lập rồi ạ! Anh/chị nhắn "OK" để em xác nhận đặt hàng nhé 😊';
      await _sendAndSave({ session, reply });
      await chatDB.incrementCounter(sessionId, 'closing_turns');
      return { handled: 'state2_waiting_confirmation' };
    }

    // ── Default: Thu thập thông tin đặt hàng ──────────────────────────────
    const PHONE_RE = /^(0|\+84)[0-9]{8,10}$/;

    const customerProfile = await chatDB.getCustomerProfile(session.customerPsid, session.pageId);

    // Có profile cũ và chưa hỏi xác nhận → hiện thông tin cũ và hỏi trước
    if (customerProfile && !session.profileConfirmAsked) {
      const profileLines = [
        'Dạ bên em có lưu thông tin cũ của anh/chị ạ:',
        `👤 Tên: ${customerProfile.name || '(chưa có)'}`,
        `📞 SĐT: ${customerProfile.phone || '(chưa có)'}`,
        `📍 Địa chỉ: ${customerProfile.address || '(chưa có)'}`,
        '',
        'Thông tin vẫn đúng ạ? Anh/chị nhắn "Đúng" để xác nhận, hoặc sửa thông tin nếu có thay đổi nhé! 😊',
      ];
      await _sendAndSave({ session, reply: profileLines.join('\n') });
      await chatDB.updateSessionIntelligence(sessionId, { profileConfirmAsked: true });
      await chatDB.incrementCounter(sessionId, 'closing_turns');
      return { handled: 'state2_profile_confirm_asked' };
    }

    // Extract từ tin nhắn mới nhất
    const extracted = await callAI('/extract-order-fields', { message: lastCustomer.content || '' });
    console.log('[CHAT WORKER] extracted fields:', JSON.stringify(extracted));

    // Merge: extracted > profile (field mới ghi đè field cũ)
    const merged = {
      name:    extracted.name    || customerProfile?.name    || null,
      phone:   extracted.phone   || customerProfile?.phone   || null,
      address: extracted.address || customerProfile?.address || null,
    };

    // Lưu ngay các trường vừa extract (partial upsert, không ghi đè null)
    if (extracted.name || extracted.phone || extracted.address) {
      await chatDB.upsertCustomerProfile({
        customerPsid: session.customerPsid,
        pageId:       session.pageId,
        name:         extracted.name    || null,
        phone:        extracted.phone   || null,
        address:      extracted.address || null,
      });
    }

    // Validate từng trường
    const valid = {
      name:    (merged.name?.trim()?.length ?? 0) >= 2,
      phone:   !!(merged.phone && PHONE_RE.test(merged.phone.replace(/[\s-]/g, ''))),
      address: (merged.address?.trim()?.length ?? 0) >= 10,
    };

    // Đủ cả 3 → gửi xác nhận + tạo đơn
    if (valid.name && valid.phone && valid.address) {
      const { reply: confirmReply } = await callAI('/generate-confirmation', {
        product_name:  identifiedProduct.name,
        price:         identifiedProduct.price || null,
        customer_name: merged.name,
        phone:         merged.phone,
        address:       merged.address,
      });
      if (identifiedProduct.image_url) {
        await sendFbImageWithCaption(
          session.pageId, session.customerPsid,
          identifiedProduct.image_url, confirmReply
        );
      } else {
        await sendFbMessage(session.pageId, session.customerPsid, confirmReply);
      }
      const confirmMsg = await chatDB.saveMessage({
        sessionId,
        senderType:            'ai',
        content:               confirmReply,
        isConfirmationSummary: true,
      });
      await chatDB.createOrder({
        sessionId,
        customerName:             merged.name,
        phone:                    merged.phone,
        address:                  merged.address,
        productName:              identifiedProduct.name,
        confirmationSummaryMsgId: confirmMsg.id,
      });
      await chatDB.incrementTurnCount(sessionId);
      await chatDB.touchSession(sessionId);
      await chatDB.updateSessionIntent(sessionId, 'Đang Chốt');
      return { handled: 'state2_confirmation_sent' };
    }

    // Thiếu/sai trường → hỏi đúng field còn thiếu
    let reply;
    if (!valid.name && !valid.phone && !valid.address) {
      reply = 'Anh/chị cho em xin tên, số điện thoại và địa chỉ giao hàng để em chốt đơn nhé! 📦';
    } else if (!valid.phone && merged.phone) {
      reply = 'Số điện thoại chưa đúng định dạng, anh/chị kiểm tra lại với em nhé!';
    } else {
      const missing = [];
      if (!valid.name)    missing.push('tên');
      if (!valid.phone)   missing.push('số điện thoại');
      if (!valid.address) missing.push('địa chỉ giao hàng');
      reply = `Dạ em còn thiếu ${missing.join(', ')} ạ, anh/chị bổ sung giúp em nhé! 😊`;
    }

    await _sendAndSave({ session, reply });
    await chatDB.incrementCounter(sessionId, 'closing_turns');
    return { handled: 'state2_collecting_info', valid };
  }

  return { handled: 'noop' };
};

// ── Worker factory ────────────────────────────────────────────────────────────

const startChatWorker = () => {
  const worker = new Worker('chat', processChatJob, {
    connection:  getRedisConnection(),
    concurrency: 5,
  });

  worker.on('completed', (job, result) => {
    console.log(`[CHAT WORKER] Job ${job.id}:`, result);
  });

  worker.on('failed', (job, err) => {
    console.error(`[CHAT WORKER] Job ${job?.id} failed:`, err.message);
  });

  console.log('[CHAT WORKER] Started');
  return worker;
};

module.exports = { startChatWorker };
