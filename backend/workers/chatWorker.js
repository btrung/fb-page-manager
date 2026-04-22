/**
 * Chat Worker — AI pipeline xử lý tin nhắn Messenger (Phase 7)
 *
 * Luồng:
 *  1. Lấy session + tin nhắn cuối
 *  2. Kiểm tra ai_mode → nếu HUMAN thì bỏ qua
 *  3. Kiểm tra active hours của page
 *  4. Gọi AI classify-intent → trả về intent + mood + identified_product
 *  5. Lưu intelligence vào session
 *  6. Handle theo intent:
 *     - Khách Đùa                  → probe (câu hỏi ngắn kéo vào hội thoại)
 *     - Muốn Mua / Đang Tư Vấn     → nếu identified_product rõ: generate-reply
 *                                     nếu chưa rõ và clarify_count < 2: clarify
 *                                     nếu clarify_count >= 2: vẫn reply với query mờ
 *     - Đang Chốt                  → extract-order info
 *     - Đã Xác Nhận                → tạo đơn hàng, gửi xác nhận cuối
 *     - Không Nhu Cầu / Dừng       → chuyển sang HUMAN mode
 */
const axios = require('axios');
const { Worker } = require('bullmq');
const { getRedisConnection } = require('../queues/redisConnection');
const chatDB = require('../db/chatDB');
const { sendFbMessage, sendFbImageWithCaption } = require('../utils/fbSendApi');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const MAX_AI_TURNS = 10;
const MAX_CLARIFY = 2;

// =============================================
// Helper: gọi AI service
// =============================================

const callAI = async (path, body) => {
  const resp = await axios.post(`${AI_URL}/chat${path}`, body, { timeout: 20000 });
  return resp.data;
};

const getLastCustomerMessage = (messages) =>
  [...messages].reverse().find((m) => m.senderType === 'customer');

const isWithinActiveHours = (activeHours) => {
  if (!activeHours) return true;
  const now = new Date();
  const day = now.getDay();
  const hhmm = now.getHours() * 100 + now.getMinutes();

  const todayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][day];
  const range = activeHours[todayKey];
  if (!range || !range.enabled) return false;

  const [startH, startM] = (range.start || '00:00').split(':').map(Number);
  const [endH, endM]     = (range.end   || '23:59').split(':').map(Number);
  const start = startH * 100 + startM;
  const end   = endH   * 100 + endM;
  return hhmm >= start && hhmm <= end;
};

// =============================================
// Processor
// =============================================

const processChatJob = async (job) => {
  const { sessionId } = job.data;

  const session = await chatDB.getSessionById(sessionId);
  if (!session) return { skipped: 'session_not_found' };

  if (session.aiMode === 'HUMAN') return { skipped: 'human_mode' };

  const aiSettings = await chatDB.getAiPageSettingsByPageId(session.pageId).catch(() => null);
  if (aiSettings && !aiSettings.aiEnabled) return { skipped: 'ai_disabled' };
  if (aiSettings?.activeHours && !isWithinActiveHours(aiSettings.activeHours)) {
    return { skipped: 'outside_active_hours' };
  }

  const messages = await chatDB.getSessionMessages(sessionId, 20);
  if (!messages.length) return { skipped: 'no_messages' };

  const lastCustomer = getLastCustomerMessage(messages);
  if (!lastCustomer) return { skipped: 'no_customer_message' };

  if (session.aiTurnCount >= MAX_AI_TURNS) {
    await chatDB.updateSessionAiMode(sessionId, 'HUMAN');
    return { skipped: 'turn_limit_reached' };
  }

  // ── Bước 1: Phân loại intent + mood + identified_product ─────────────
  const historyForClassify = messages.map((m) => ({
    role: m.senderType,
    content: m.content || '',
  }));

  const classify = await callAI('/classify-intent', { messages: historyForClassify });
  const { intent, mood, identified_product: identifiedProduct } = classify;

  await chatDB.updateSessionIntent(sessionId, intent);

  // Merge identified_product: giữ cái cũ nếu mới null
  const resolvedProduct = identifiedProduct || session.identifiedProduct || null;

  await chatDB.updateSessionIntelligence(sessionId, {
    identifiedProduct: resolvedProduct,
    customerMood:      mood,
    clarifyCount:      null, // chỉ increment khi cần, không reset
  });

  // ── Bước 2: Handle theo intent ────────────────────────────────────────
  if (intent === 'Dừng' || intent === 'Không Nhu Cầu') {
    await chatDB.updateSessionAiMode(sessionId, 'HUMAN');
    return { handled: 'switched_to_human', intent };
  }

  if (intent === 'Khách Đùa') {
    const { reply } = await callAI('/generate-probe', {
      customer_message: lastCustomer.content || '',
    });
    await _sendAndSave({ session, reply, intent });
    return { handled: 'probe_sent', intent };
  }

  if (intent === 'Muốn Mua' || intent === 'Đang Tư Vấn') {
    const clarifyCount = session.clarifyCount || 0;

    // Nếu chưa xác định sản phẩm và còn lượt clarify
    if (!resolvedProduct && clarifyCount < MAX_CLARIFY) {
      const { reply } = await callAI('/generate-clarify', {
        customer_message: lastCustomer.content || '',
        identified_product: identifiedProduct || null,
      });
      await _sendAndSave({ session, reply, intent });
      await chatDB.updateSessionIntelligence(sessionId, {
        clarifyCount: clarifyCount + 1,
      });
      return { handled: 'clarify_sent', intent, clarifyCount: clarifyCount + 1 };
    }

    // Có sản phẩm, hoặc đã clarify đủ lần → reply với product search
    const searchQuery = resolvedProduct?.query || resolvedProduct?.name || lastCustomer.content || '';
    const lastAttachment = lastCustomer.attachments?.find((a) => a.type === 'image');

    const { reply, product_images } = await callAI('/generate-reply', {
      customer_message: searchQuery,
      page_id:          session.pageId,
      user_id:          session.userId,
      image_url:        lastAttachment?.url || null,
      top_k:            3,
      mood:             mood || 'neutral',
      reply_style:      aiSettings?.replyStyle || null,
      customer_name:    session.customerName || null,
      identified_product: resolvedProduct,
    });

    const firstImage = product_images?.[0];
    if (firstImage) {
      await sendFbImageWithCaption(session.pageId, session.customerPsid, firstImage, reply);
    } else {
      await sendFbMessage(session.pageId, session.customerPsid, reply);
    }

    await chatDB.saveMessage({
      sessionId: session.id, senderType: 'ai', content: reply, intentAtTime: intent,
    });
    await chatDB.incrementTurnCount(session.id);
    await chatDB.touchSession(session.id);

    return { handled: 'reply_sent', intent, hasImage: !!firstImage };
  }

  if (intent === 'Đang Chốt') {
    const { customer_name, phone, address, complete } = await callAI('/extract-order', {
      messages: historyForClassify,
    });

    if (!complete) {
      const missing = [
        !customer_name && 'tên',
        !phone && 'số điện thoại',
        !address && 'địa chỉ',
      ].filter(Boolean).join(', ');

      const reply = `Dạ để em giao hàng anh/chị cho biết thêm ${missing} với ạ!`;
      await _sendAndSave({ session, reply, intent });
      return { handled: 'ask_missing_info', intent, missing };
    }

    const productName = resolvedProduct?.name || (await _extractProductFromHistory(historyForClassify));

    const { reply: confirmReply } = await callAI('/generate-confirmation', {
      product_name:   productName,
      customer_name,
      phone,
      address,
    });

    await sendFbMessage(session.pageId, session.customerPsid, confirmReply);

    const confirmMsg = await chatDB.saveMessage({
      sessionId,
      senderType:            'ai',
      content:               confirmReply,
      intentAtTime:          intent,
      isConfirmationSummary: true,
    });
    await chatDB.incrementTurnCount(sessionId);
    await chatDB.touchSession(sessionId);

    const existing = await chatDB.getOrderBySession(sessionId);
    if (!existing) {
      await chatDB.createOrder({
        sessionId,
        customerName: customer_name,
        phone,
        address,
        productName,
        confirmationSummaryMsgId: confirmMsg.id,
      });
    }

    return { handled: 'confirmation_sent', intent };
  }

  if (intent === 'Đã Xác Nhận') {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.senderType === 'customer') {
      await chatDB.markCustomerConfirmed(sessionId, lastMsg.id);
    }

    const reply = 'Dạ em đã ghi nhận đơn của anh/chị! Bộ phận giao hàng sẽ liên hệ xác nhận ạ 🎉';
    await _sendAndSave({ session, reply, intent });
    await chatDB.updateSessionIntent(sessionId, 'Đã Chốt');
    return { handled: 'order_confirmed', intent };
  }

  return { handled: 'noop', intent };
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const _sendAndSave = async ({ session, reply, intent }) => {
  await sendFbMessage(session.pageId, session.customerPsid, reply);
  await chatDB.saveMessage({
    sessionId:    session.id,
    senderType:   'ai',
    content:      reply,
    intentAtTime: intent || session.intent,
  });
  await chatDB.incrementTurnCount(session.id);
  await chatDB.touchSession(session.id);
};

const _extractProductFromHistory = async (messages) => {
  for (const m of messages) {
    if (m.role === 'ai' && m.content) {
      const match = m.content.match(/SP\d?:\s*([^\n—]+)/);
      if (match) return match[1].trim();
    }
  }
  return null;
};

// =============================================
// Worker factory
// =============================================

const startChatWorker = () => {
  const worker = new Worker('chat', processChatJob, {
    connection: getRedisConnection(),
    concurrency: 5,
  });

  worker.on('completed', (job, result) => {
    console.log(`[CHAT WORKER] Job ${job.id} done:`, result);
  });

  worker.on('failed', (job, err) => {
    console.error(`[CHAT WORKER] Job ${job?.id} failed:`, err.message);
  });

  console.log('[CHAT WORKER] Started');
  return worker;
};

module.exports = { startChatWorker };
