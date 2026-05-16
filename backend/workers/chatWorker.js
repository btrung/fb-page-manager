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
const { sendFbMessage, sendFbImage, sendFbImageWithCaption, sendWebviewButton } = require('../utils/fbSendApi');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// In-memory lock: tránh 2 job cùng session chạy song song
const _processing = new Set();

// Giới hạn lượt AI reply theo từng state
const LIMIT_NO_PRODUCT  = 5;
const LIMIT_UNCONFIRMED = 8;
const LIMIT_CONSULTING  = 10;
const LIMIT_CLOSING     = 10;

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

// Tìm SP: Stage 1 vector search → Stage 2 LLM rerank → trả về mảng kết quả
const _searchProducts = async ({ session, query, imageUrl = null, topK = 3 }) => {
  try {
    // Stage 1: vector search lấy top 5 (threshold thấp, LLM sẽ lọc)
    const result = await callAI('/generate-reply', {
      customer_message: query,
      page_id:          session.pageId,
      user_id:          session.userId,
      image_url:        imageUrl || null,
      top_k:            5,
    });

    const rawList = result.products || [];
    if (!rawList.length) return [];

    const candidates = rawList.filter(f => (f.score || 0) >= 0.20);
    if (!candidates.length) {
      console.log('[CHAT WORKER] all scores too low:', (rawList[0]?.score || 0).toFixed(3), '| query:', query);
      return [];
    }

    // Enrich với content từ DB
    const enriched = await Promise.all(candidates.map(async (found, idx) => {
      const p = found.payload || found;
      const postId = p.post_id || null;
      const postData = postId ? await chatDB.getPostContent(postId) : null;

      const content = postData?.what_is_product || postData?.content || p.content || p.what_is_product || '';
      const promotion = postData?.what_is_promotion || '';
      const fullContent = promotion ? `${content}\nKhuyến mãi: ${promotion}` : content;
      const imgUrl = p.image_url || result.product_images?.[0] || null;

      return {
        index:        idx,
        product_name: p.product_name || query,
        content:      fullContent,
        price:        p.current_price || p.price || null,
        imgUrl,
        score:        found.score || 0,
        query,
      };
    }));

    // Stage 2: LLM rerank
    const rerank = await callAI('/rerank-products', {
      query,
      candidates: enriched.map(e => ({
        index:        e.index,
        product_name: e.product_name,
        content:      e.content,
        price:        e.price,
      })),
    });
    console.log('[CHAT WORKER] rerank:', JSON.stringify(rerank), '| query:', query);

    if (rerank.best_index === -1 || rerank.confidence === 'low') return [];

    const pickedIndices = rerank.confidence === 'high'
      ? [rerank.best_index]
      : (rerank.picked_indices?.length ? rerank.picked_indices : [rerank.best_index]);

    // Detect variants chỉ cho các SP được chọn
    const picked = await Promise.all(
      pickedIndices.map(async (idx) => {
        const e = enriched[idx];
        if (!e) return null;
        const variantsRes = await callAI('/detect-variants', {
          product_name:    e.product_name,
          product_content: e.content,
          niche:           null,
        }).catch(() => ({ required_variants: [] }));
        return {
          product: {
            name:              e.product_name,
            query:             e.query,
            price:             e.price,
            image_url:         e.imgUrl,
            content:           e.content,
            required_variants: variantsRes.required_variants || [],
          },
          imageUrl: e.imgUrl,
          score:    e.score,
        };
      })
    );

    return picked.filter(Boolean);
  } catch (err) {
    console.error('[CHAT WORKER] _searchProducts error:', err.message);
    return [];
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
    product_name:       identifiedProduct.name,
    price:              identifiedProduct.price || null,
    product_content:    identifiedProduct.content || '',
    required_variants:  identifiedProduct.required_variants || [],
    reply_style:        aiSettings?.replyStyle || null,
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
  const { sessionId } = job.data;

  // Fix 3: tránh 2 job cùng session chạy song song → double reply
  if (_processing.has(sessionId)) return { skipped: 'already_processing' };
  _processing.add(sessionId);

  try {

  // ── Guards cơ bản ──────────────────────────────────────────────────────────
  const session = await chatDB.getSessionById(sessionId);
  if (!session) return { skipped: 'session_not_found' };

  const aiSettings = await chatDB.getAiPageSettingsByPageId(session.pageId).catch(() => null);
  if (aiSettings && !aiSettings.aiEnabled) return { skipped: 'ai_disabled' };
  if (aiSettings?.activeHours && !isWithinActiveHours(aiSettings.activeHours)) {
    return { skipped: 'outside_active_hours' };
  }

  // ── Reset ai_mode → AI nếu idle >24h ─────────────────────────────────────
  const lastMsgAt = session.lastMessageAt ? new Date(session.lastMessageAt) : null;
  const hoursSince = lastMsgAt ? (Date.now() - lastMsgAt.getTime()) / (1000 * 60 * 60) : 0;
  if (session.aiMode === 'HUMAN' && hoursSince > 24) {
    await chatDB.updateSessionAiMode(sessionId, 'AI');
    await chatDB.updateSessionIntelligence(sessionId, { supportTurns: 0, generalTurns: 0, lastProductHint: null });
    session.aiMode = 'AI';
    console.log(`[CHAT WORKER] session ${sessionId} auto-reset AI mode after ${hoursSince.toFixed(1)}h idle`);
  }
  if (session.aiMode === 'HUMAN') return { skipped: 'human_mode' };

  // ── Reset state nếu khách im lặng quá 3 ngày ─────────────────────────────
  const daysSince = hoursSince / 24;
  if (daysSince > 3 && session.identifiedProduct) {
    await chatDB.updateSessionIntelligence(sessionId, {
      identifiedProduct:   null,
      productConfirmed:    false,
      productVariants:     {},
      variantConfirmed:    false,
      profileConfirmAsked: false,
      candidateProducts:   null,
      noProductTurns:      0,
      unconfirmedTurns:    0,
      consultingTurns:     0,
      lastProductHint:     null,
    });
    console.log(`[CHAT WORKER] session ${sessionId} full reset after ${daysSince.toFixed(1)} days idle`);
  }

  // ── Gom tất cả tin nhắn khách chưa được reply ─────────────────────────────
  const unreplied = await chatDB.getUnrepliedCustomerMessages(sessionId);
  if (!unreplied.length) return { skipped: 'no_customer_message' };

  // Tin nhắn cuối cùng (dùng cho metadata: ảnh, messageId)
  const lastCustomer = unreplied[unreplied.length - 1];

  // Gom nội dung: nếu nhiều tin thì join lại để LLM hiểu đủ context
  const combinedContent = unreplied
    .map((m) => m.content || '')
    .filter(Boolean)
    .join('\n');

  // Có ảnh trong bất kỳ tin nào không
  const hasImage = unreplied.some((m) => (m.attachments || []).some((a) => a.type === 'image'));
  const imageUrl = hasImage
    ? unreplied.flatMap((m) => m.attachments || []).find((a) => a.type === 'image')?.url
    : null;

  console.log(`[CHAT WORKER] session=${sessionId} msgs=${unreplied.length} combined="${combinedContent.slice(0, 80)}"`);

  // ── Đọc trạng thái hiện tại ────────────────────────────────────────────────
  const {
    identifiedProduct, productConfirmed, variantConfirmed,
    noProductTurns, unconfirmedTurns, consultingTurns, closingTurns,
    supportTurns, generalTurns, lastProductHint,
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
  if (identifiedProduct && productConfirmed && !variantConfirmed && consultingTurns >= LIMIT_CONSULTING) {
    await chatDB.updateSessionAiMode(sessionId, 'HUMAN');
    return { skipped: 'dung_consulting', turns: consultingTurns };
  }
  if (identifiedProduct && variantConfirmed && closingTurns >= LIMIT_CLOSING) {
    await chatDB.updateSessionAiMode(sessionId, 'HUMAN');
    return { skipped: 'dung_closing', turns: closingTurns };
  }

  // ── Phân tích tin nhắn (dùng combinedContent) ─────────────────────────────
  const currentState = !identifiedProduct ? 'state0'
    : !productConfirmed   ? 'state1'
    : !variantConfirmed   ? 'state2'
    : 'state3';

  const recentMsgs = await chatDB.getSessionMessages(sessionId, 5);

  const classify = await callAI('/classify-intent', {
    message:         combinedContent,
    has_image:       hasImage,
    current_state:   currentState,
    recent_messages: recentMsgs.map(m => ({ role: m.senderType, content: m.content || '' })),
  });
  console.log('[CHAT WORKER] classify:', JSON.stringify(classify), '| msg:', lastCustomer.content?.slice(0, 60));
  const { has_product_signal, product_hint, message_intent, product_feedback,
          frustration_level, buy_candidate } = classify;

  // buy_candidate = khách muốn mua SP cụ thể → luôn là buying, không phải support
  const conversation_type = buy_candidate ? 'buying' : classify.conversation_type;
  // switchHint: hint tốt nhất để tìm SP mới khi khách muốn đổi
  const switchHint = buy_candidate || product_hint;

  // Lưu last_product_hint mỗi lượt nếu có
  if (switchHint) {
    await chatDB.updateSessionIntelligence(sessionId, { lastProductHint: switchHint });
  }

  // ── conversation_type routing — áp dụng mọi state ────────────────────────
  if (conversation_type === 'support' && supportTurns < 5) {
    const result = await callAI('/handle-support', {
      message:           combinedContent,
      product_hint:      product_hint || lastProductHint || identifiedProduct?.name || null,
      frustration_level: frustration_level || 'low',
      reply_style:       aiSettings?.replyStyle || null,
    });
    await _sendAndSave({ session, reply: result.reply });
    await chatDB.incrementCounter(sessionId, 'support_turns');
    console.log('[CHAT WORKER] support:', { frustration_level: result.frustration_level, cta_included: result.cta_included });
    return { handled: 'support', turns: supportTurns + 1, frustration: result.frustration_level };
  }

  if (conversation_type === 'support' && supportTurns >= 5) {
    await chatDB.updateSessionAiMode(sessionId, 'HUMAN');
    return { skipped: 'dung_support', turns: supportTurns };
  }

  if (conversation_type === 'general' && generalTurns < 5) {
    const result = await callAI('/handle-general', {
      message:     combinedContent,
      page_policy: aiSettings?.pagePolicy || null,
      niche:       aiSettings?.niche || null,
      reply_style: aiSettings?.replyStyle || null,
    });
    await _sendAndSave({ session, reply: result.reply });
    await chatDB.incrementCounter(sessionId, 'general_turns');
    return { handled: 'general', turns: generalTurns + 1 };
  }

  if (conversation_type === 'general' && generalTurns >= 5) {
    await chatDB.updateSessionAiMode(sessionId, 'HUMAN');
    return { skipped: 'dung_general', turns: generalTurns };
  }

  // Fast-track — chỉ khi chưa có identified_product
  if (!identifiedProduct) {
    const fastTrackHint = buy_candidate || (conversation_type === 'buying' ? product_hint : null) || lastProductHint;
    if (fastTrackHint && conversation_type === 'buying') {
      const found = await _searchProducts({ session, query: fastTrackHint, imageUrl, topK: 3 });
      if (found.length === 1 && found[0].score >= 0.5) {
        await chatDB.updateSessionIntelligence(sessionId, {
          identifiedProduct: found[0].product,
          noProductTurns:    0,
          lastProductHint:   null,
        });
        await chatDB.updateSessionIntent(sessionId, 'Muốn Mua');
        const { reply } = await callAI('/generate-product-confirm', { product_name: found[0].product.name });
        if (found[0].imageUrl) await sendFbImage(session.pageId, session.customerPsid, found[0].imageUrl);
        await _sendAndSave({ session, reply });
        return { handled: 'state0_fasttrack_s1', product: found[0].product.name };
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATE 0 — Chưa có identified_product
  // ════════════════════════════════════════════════════════════════════════════
  if (!identifiedProduct) {

    // ── Khách đang chọn từ danh sách candidates đã gửi ──────────────────────
    if (session.candidateProducts?.length > 0) {
      const candidates = session.candidateProducts;
      let picked = null;

      // Match theo product_hint (tên SP trong câu trả lời)
      if (product_hint) {
        const hint = product_hint.toLowerCase();
        picked = candidates.find(c => {
          const name = c.product.name.toLowerCase();
          return name.includes(hint) || hint.includes(name) ||
            name.split(' ').some(w => w.length > 3 && hint.includes(w));
        });
      }

      // Match theo số thứ tự ("1", "đầu", "một", "hai", "2"...)
      if (!picked) {
        const text = combinedContent.toLowerCase();
        const idx = /\b(1|một|đầu|đầu tiên|thứ nhất|first)\b/.test(text) ? 0
          : /\b(2|hai|thứ hai|second)\b/.test(text) ? 1
          : /\b(3|ba|thứ ba|third)\b/.test(text) ? 2
          : -1;
        if (idx >= 0 && candidates[idx]) picked = candidates[idx];
      }

      if (picked) {
        await chatDB.updateSessionIntelligence(sessionId, {
          identifiedProduct:  picked.product,
          candidateProducts:  null,
          noProductTurns:     0,
        });
        await chatDB.updateSessionIntent(sessionId, 'Muốn Mua');
        const { reply } = await callAI('/generate-product-confirm', { product_name: picked.product.name });
        if (picked.imageUrl) await sendFbImage(session.pageId, session.customerPsid, picked.imageUrl);
        await _sendAndSave({ session, reply });
        return { handled: 'state0_candidate_picked', product: picked.product.name };
      }

      // Chưa chọn rõ → nhắc lại
      const listText = candidates.map((c, i) => `${i + 1}. ${c.product.name}`).join('\n');
      await _sendAndSave({ session, reply: `Anh/chị muốn xem mẫu nào ạ?\n${listText}` });
      await chatDB.incrementCounter(sessionId, 'no_product_turns');
      return { handled: 'state0_candidate_unclear' };
    }

    // ── Tìm SP mới ──────────────────────────────────────────────────────────
    if (has_product_signal && product_hint) {
      const found = await _searchProducts({ session, query: product_hint, imageUrl, topK: 3 });

      if (found.length === 1) {
        // Duy nhất 1 kết quả → confirm ngay
        await chatDB.updateSessionIntelligence(sessionId, {
          identifiedProduct: found[0].product,
          noProductTurns:    0,
        });
        await chatDB.updateSessionIntent(sessionId, 'Muốn Mua');
        const { reply } = await callAI('/generate-product-confirm', { product_name: found[0].product.name });
        if (found[0].imageUrl) await sendFbImage(session.pageId, session.customerPsid, found[0].imageUrl);
        await _sendAndSave({ session, reply });
        return { handled: 'state0_product_found', product: found[0].product.name };

      } else if (found.length > 1) {
        // Nhiều kết quả → gửi tất cả, hỏi chọn
        await chatDB.updateSessionIntelligence(sessionId, {
          candidateProducts: found,
          noProductTurns:    0,
        });
        for (let i = 0; i < found.length; i++) {
          const f = found[i];
          const priceStr = f.product.price
            ? `${Number(f.product.price).toLocaleString('vi-VN')}đ` : 'Liên hệ';
          const msg = `SP ${i + 1}: ${f.product.name} — ${priceStr}`;
          if (f.imageUrl) {
            await sendFbImageWithCaption(session.pageId, session.customerPsid, f.imageUrl, msg);
          } else {
            await sendFbMessage(session.pageId, session.customerPsid, msg);
          }
        }
        const options = found.map(f => f.product.name.slice(0, 20));
        await sendQuickReplies(
          session.pageId, session.customerPsid,
          'Em thấy có mấy mẫu phù hợp, anh/chị muốn xem mẫu nào ạ?',
          options,
        );
        await chatDB.updateSessionIntent(sessionId, 'Muốn Mua');
        await chatDB.saveMessage({ sessionId, senderType: 'ai', content: '[Gợi ý nhiều sản phẩm]' });
        await chatDB.incrementTurnCount(sessionId);
        await chatDB.touchSession(sessionId);
        return { handled: 'state0_multiple_candidates', count: found.length };
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
      if (switchHint) {
        const _results = await _searchProducts({ session, query: switchHint, imageUrl });
        const found = _results[0] || null;
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

    // Khách xác nhận SP → vào State 2, gửi closing script ngay
    if (product_feedback === 'confirmed' || message_intent === 'confirming') {
      await chatDB.updateSessionIntelligence(sessionId, {
        productConfirmed:  true,
        unconfirmedTurns:  0,
        productVariants:   {},
        variantConfirmed:  false,
        consultingTurns:   0,
      });
      await chatDB.updateSessionIntent(sessionId, 'Đang Tư Vấn');
      // Gửi closing script ngay: mark "đã reply" + mở đầu tư vấn
      await _sendClosingScript({ session, identifiedProduct, aiSettings });
      return { handled: 'state1_confirmed_enter_s2' };
    }

    // Khách muốn SP khác (switchHint khác với SP hiện tại)
    if (switchHint && switchHint !== identifiedProduct.query && switchHint !== identifiedProduct.name) {
      const _results = await _searchProducts({ session, query: switchHint, imageUrl });
      const found = _results[0] || null;
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

    // Hỏi thêm về cùng SP → re-confirm (kèm ảnh để khách xem rõ)
    const { reply } = await callAI('/generate-product-confirm', {
      product_name: identifiedProduct.name,
    });
    if (identifiedProduct.image_url) {
      await sendFbImage(session.pageId, session.customerPsid, identifiedProduct.image_url);
    }
    await _sendAndSave({ session, reply });
    await chatDB.incrementCounter(sessionId, 'unconfirmed_turns');
    return { handled: 'state1_reconfirm', turns: unconfirmedTurns + 1 };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATE 2 — SP đã khoá, chưa chốt biến thể → Tư vấn + Thuyết phục
  // ════════════════════════════════════════════════════════════════════════════
  if (identifiedProduct && productConfirmed && !variantConfirmed) {

    // ── Tư vấn + thu thập biến thể — worker tính routing, LLM lo reply ──
    const currentVariants  = session.productVariants || {};
    const requiredVariants = identifiedProduct.required_variants || [];
    const missingVariants  = requiredVariants.filter((v) => !(v in currentVariants));
    const isComplete       = missingVariants.length === 0;

    const recentMsgs = await chatDB.getSessionMessages(sessionId, 6);
    const conversationHistory = recentMsgs.map((m) => ({
      role:    m.senderType === 'customer' ? 'customer' : 'ai',
      content: m.content || '',
    }));

    const consult = await callAI('/consult', {
      latest_message:       combinedContent,
      product_name:         identifiedProduct.name,
      product_content:      identifiedProduct.content || '',
      niche:                aiSettings?.niche || null,
      price:                identifiedProduct.price || null,
      current_variants:     currentVariants,
      missing_variants:     missingVariants,
      is_complete:          isComplete,
      conversation_history: conversationHistory,
      reply_style:          aiSettings?.replyStyle || null,
    });

    const {
      updated_variants, confirmed_variants,
      exit: shouldExit, new_product_hint, reply: consultReply,
    } = consult;
    console.log('[CHAT WORKER] consult:', JSON.stringify({ isComplete, missingVariants, confirmed_variants, exit: shouldExit, new_product_hint }));

    // Cập nhật variants
    if (updated_variants && Object.keys(updated_variants).length > 0) {
      await chatDB.updateSessionIntelligence(sessionId, { productVariants: updated_variants });
    }

    // Khách muốn SP khác → search + về State 0
    if (new_product_hint) {
      const _results = await _searchProducts({ session, query: new_product_hint, imageUrl });
      const found = _results[0] || null;
      if (found) {
        await chatDB.updateSessionIntelligence(sessionId, {
          identifiedProduct:   found.product,
          productConfirmed:    false,
          unconfirmedTurns:    0,
          productVariants:     {},
          variantConfirmed:    false,
          profileConfirmAsked: false,
        });
        await chatDB.updateSessionIntent(sessionId, 'Đang Tư Vấn');
        const { reply } = await callAI('/generate-product-confirm', { product_name: found.product.name });
        if (found.imageUrl) await sendFbImage(session.pageId, session.customerPsid, found.imageUrl);
        await _sendAndSave({ session, reply });
        return { handled: 'state2_switch_product', product: found.product.name };
      }
    }

    // Khách từ chối dứt khoát → HUMAN
    if (shouldExit) {
      await _sendAndSave({ session, reply: consultReply });
      await chatDB.updateSessionAiMode(sessionId, 'HUMAN');
      return { handled: 'state2_exit_human' };
    }

    // Variants đủ + khách xác nhận → State 3
    if (isComplete && confirmed_variants) {
      await chatDB.updateSessionIntelligence(sessionId, {
        variantConfirmed: true,
        consultingTurns:  0,
      });
      await chatDB.updateSessionIntent(sessionId, 'Đang Chốt');
      await _sendAndSave({ session, reply: consultReply });
      return { handled: 'state2_variant_confirmed' };
    }

    await _sendAndSave({ session, reply: consultReply });
    await chatDB.incrementCounter(sessionId, 'consulting_turns');
    return { handled: 'state2_consulting', isComplete, missingVariants };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATE 3 — Biến thể đã chốt → Lấy thông tin giao hàng (LLM-assisted)
  // Worker tính missing_fields (deterministic) → LLM chỉ lo văn phong + extract
  // KHÔNG tạo đơn cho đến khi khách confirm tóm tắt
  // ════════════════════════════════════════════════════════════════════════════
  if (identifiedProduct && variantConfirmed) {

    // Bước 1: Chưa gửi webview button → gửi ngay
    if (!session.profileConfirmAsked) {
      const appUrl  = process.env.APP_URL || 'http://localhost:5000';
      const formUrl = `${appUrl}/form/shipping?session=${sessionId}&page=${session.pageId}`;
      await sendWebviewButton(
        session.pageId,
        session.customerPsid,
        'Anh/chị điền thông tin để em chốt đơn nhé! 🛍️',
        '📋 Điền thông tin giao hàng',
        formUrl,
      );
      await chatDB.saveMessage({ sessionId, senderType: 'ai', content: '[Form điền thông tin giao hàng]' });
      await chatDB.updateSessionIntelligence(sessionId, { profileConfirmAsked: true });
      await chatDB.incrementTurnCount(sessionId);
      await chatDB.touchSession(sessionId);
      return { handled: 'state3_webview_sent' };
    }

    // Bước 2: Kiểm tra form đã submit chưa (form.js gửi isConfirmationSummary message)
    const existingSummary = await chatDB.getLastConfirmationSummary(sessionId);

    if (!existingSummary) {
      // Escape: khách muốn SP khác → tìm SP, về State 1
      if (switchHint && switchHint.toLowerCase() !== identifiedProduct.name?.toLowerCase()) {
        const _results = await _searchProducts({ session, query: switchHint, imageUrl });
        const found = _results[0] || null;
        if (found) {
          await chatDB.updateSessionIntelligence(sessionId, {
            identifiedProduct:   found.product,
            productConfirmed:    false,
            unconfirmedTurns:    0,
            productVariants:     {},
            variantConfirmed:    false,
            profileConfirmAsked: false,
          });
          const { reply } = await callAI('/generate-product-confirm', { product_name: found.product.name });
          if (found.imageUrl) await sendFbImage(session.pageId, session.customerPsid, found.imageUrl);
          await _sendAndSave({ session, reply });
          return { handled: 'state3_escape_new_product', product: found.product.name };
        }
      }

      // Chưa submit → nhắc nhở
      const nudge = 'Anh/chị điền form bên trên để em chốt đơn nhé! Có thắc mắc gì cứ hỏi em ạ 😊';
      await _sendAndSave({ session, reply: nudge });
      return { handled: 'state3_waiting_form' };
    }

    // Bước 3: Form đã submit, chờ khách confirm
    if (message_intent === 'confirming' || product_feedback === 'confirmed') {
      const profile = await chatDB.getCustomerProfile(session.customerPsid, session.pageId);
      const order   = await chatDB.createOrder({
        sessionId,
        customerName:             profile?.name    || '',
        phone:                    profile?.phone   || '',
        address:                  profile?.address || '',
        productName:              identifiedProduct.name,
        productVariants:          session.productVariants || null,
        confirmationSummaryMsgId: existingSummary.id,
      });
      await chatDB.markCustomerConfirmed(sessionId, lastCustomer.id);
      const reply = 'Dạ em đã ghi nhận đơn! Bộ phận giao hàng sẽ liên hệ xác nhận ạ 🎉';
      await _sendAndSave({ session, reply });
      await chatDB.updateSessionIntent(sessionId, 'Đã Chốt');
      await chatDB.updateSessionAiMode(sessionId, 'HUMAN');
      return { handled: 'state3_order_confirmed', orderId: order.id };
    }

    // Escape: khách muốn SP khác dù đã điền form → tìm SP, về State 1
    if (switchHint && switchHint.toLowerCase() !== identifiedProduct.name?.toLowerCase()) {
      const _results = await _searchProducts({ session, query: switchHint, imageUrl });
      const found = _results[0] || null;
      if (found) {
        await chatDB.updateSessionIntelligence(sessionId, {
          identifiedProduct:   found.product,
          productConfirmed:    false,
          unconfirmedTurns:    0,
          productVariants:     {},
          variantConfirmed:    false,
          profileConfirmAsked: false,
        });
        const { reply } = await callAI('/generate-product-confirm', { product_name: found.product.name });
        if (found.imageUrl) await sendFbImage(session.pageId, session.customerPsid, found.imageUrl);
        await _sendAndSave({ session, reply });
        return { handled: 'state3_escape_new_product_post_form', product: found.product.name };
      }
    }

    // Khách muốn đổi thông tin → gửi lại form
    const wantsChange = /đổi|sửa|thay|địa chỉ mới|khác/i.test(combinedContent);
    if (wantsChange) {
      const appUrl  = process.env.APP_URL || 'http://localhost:5000';
      const formUrl = `${appUrl}/form/shipping?session=${sessionId}&page=${session.pageId}`;
      await sendWebviewButton(
        session.pageId, session.customerPsid,
        'Anh/chị mở lại form để sửa thông tin nhé!',
        '✏️ Sửa thông tin giao hàng',
        formUrl,
      );
      await chatDB.saveMessage({ sessionId, senderType: 'ai', content: '[Form sửa thông tin giao hàng]' });
      await chatDB.incrementTurnCount(sessionId);
      return { handled: 'state3_reopen_form' };
    }

    // Tin khác → nhắc confirm
    const reply = 'Anh/chị xác nhận đơn hàng bên trên nhé ạ! Nhắn "OK" để em ghi nhận 😊';
    await _sendAndSave({ session, reply });
    await chatDB.incrementCounter(sessionId, 'closing_turns');
    return { handled: 'state3_nudge_confirm' };
  }

  return { handled: 'noop' };
  } finally {
    _processing.delete(sessionId);
  }
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
