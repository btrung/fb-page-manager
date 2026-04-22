/**
 * Chat Worker — AI pipeline xử lý tin nhắn Messenger
 *
 * Luồng:
 *  1. Lấy session + tin nhắn cuối
 *  2. Kiểm tra ai_mode → nếu HUMAN thì bỏ qua
 *  3. Kiểm tra cooldown → nếu chưa hết thì bỏ qua
 *  4. Kiểm tra active hours của page
 *  5. Gọi AI classify-intent
 *  6. Handle theo intent:
 *     - Khách Đùa / Không Nhu Cầu  → probe hoặc cooldown
 *     - Muốn Mua / Đang Tư Vấn     → generate-reply với product search
 *     - Đang Chốt                  → extract-order info
 *     - Đã Xác Nhận                → tạo đơn hàng, gửi xác nhận cuối
 *     - Dừng                       → không làm gì
 */
const axios = require('axios');
const { Worker } = require('bullmq');
const { getRedisConnection } = require('../queues/redisConnection');
const chatDB = require('../db/chatDB');
const { sendFbMessage } = require('../routes/chat');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// Giới hạn số lượt AI tự vấn trước khi cooldown
const MAX_AI_TURNS = 10;
// Cooldown khi khách không có nhu cầu (giờ)
const COOLDOWN_HOURS = 5;

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
  if (!activeHours) return true; // không cài đặt → luôn active
  const now = new Date();
  const day = now.getDay(); // 0=Sun … 6=Sat
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

  // Người dùng đang tư vấn tay → AI không xen vào
  if (session.aiMode === 'HUMAN') return { skipped: 'human_mode' };

  // Kiểm tra cooldown
  if (session.cooldownUntil && new Date(session.cooldownUntil) > new Date()) {
    return { skipped: 'cooldown' };
  }

  // Kiểm tra intent Dừng
  if (session.intent === 'Dừng') return { skipped: 'intent_dung' };

  // Kiểm tra giờ hoạt động
  const aiSettings = await chatDB.getAiPageSettingsByPageId(session.pageId).catch(() => null);
  if (aiSettings && !aiSettings.aiEnabled) return { skipped: 'ai_disabled' };
  if (aiSettings?.activeHours && !isWithinActiveHours(aiSettings.activeHours)) {
    return { skipped: 'outside_active_hours' };
  }

  // Lấy lịch sử hội thoại (tối đa 20 tin)
  const messages = await chatDB.getSessionMessages(sessionId, 20);
  if (!messages.length) return { skipped: 'no_messages' };

  const lastCustomer = getLastCustomerMessage(messages);
  if (!lastCustomer) return { skipped: 'no_customer_message' };

  // Giới hạn số lượt AI tự vấn
  if (session.aiTurnCount >= MAX_AI_TURNS) {
    await chatDB.setCooldown(sessionId, COOLDOWN_HOURS);
    return { skipped: 'turn_limit_reached' };
  }

  // ── Bước 1: Phân loại intent ──────────────────────────────────────────
  const historyForClassify = messages.map((m) => ({
    role: m.senderType,
    content: m.content || '',
  }));

  const { intent } = await callAI('/classify-intent', { messages: historyForClassify });
  await chatDB.updateSessionIntent(sessionId, intent);

  // ── Bước 2: Handle theo intent ────────────────────────────────────────
  if (intent === 'Dừng' || intent === 'Không Nhu Cầu') {
    await chatDB.setCooldown(sessionId, COOLDOWN_HOURS);
    return { handled: 'cooldown_set', intent };
  }

  if (intent === 'Khách Đùa') {
    // Gửi câu probe ngắn để kéo khách vào hội thoại
    const { reply } = await callAI('/generate-probe', {
      customer_message: lastCustomer.content || '',
    });
    await _sendAndSave({ session, reply });
    return { handled: 'probe_sent', intent };
  }

  if (intent === 'Muốn Mua' || intent === 'Đang Tư Vấn') {
    // Tìm ảnh từ attachment cuối của khách (nếu có)
    const lastAttachment = lastCustomer.attachments?.find((a) => a.type === 'image');

    const { reply, products } = await callAI('/generate-reply', {
      customer_message: lastCustomer.content || '',
      page_id: session.pageId,
      user_id: session.userId,
      image_url: lastAttachment?.url || null,
      top_k: 3,
    });

    await _sendAndSave({ session, reply });
    return { handled: 'reply_sent', intent, productCount: products?.length || 0 };
  }

  if (intent === 'Đang Chốt') {
    // Trích xuất thông tin đơn hàng từ hội thoại
    const { customer_name, phone, address, complete } = await callAI('/extract-order', {
      messages: historyForClassify,
    });

    if (!complete) {
      // Thiếu thông tin → hỏi thêm
      const missing = [
        !customer_name && 'tên',
        !phone && 'số điện thoại',
        !address && 'địa chỉ',
      ].filter(Boolean).join(', ');

      const reply = `Dạ để em giao hàng anh/chị cho biết thêm ${missing} với ạ!`;
      await _sendAndSave({ session, reply });
      return { handled: 'ask_missing_info', intent, missing };
    }

    // Đủ thông tin → lấy sản phẩm từ hội thoại rồi tạo confirmation
    const productName = await _extractProductFromHistory(historyForClassify);

    const { reply: confirmReply } = await callAI('/generate-confirmation', {
      product_name:   productName,
      customer_name,
      phone,
      address,
    });

    // Lưu tin nhắn xác nhận, đánh dấu is_confirmation_summary
    const confirmMsg = await chatDB.saveMessage({
      sessionId,
      senderType:            'ai',
      content:               confirmReply,
      intentAtTime:          intent,
      isConfirmationSummary: true,
    });

    await sendFbMessage(session.pageId, session.customerPsid, confirmReply);
    await chatDB.incrementTurnCount(sessionId);
    await chatDB.touchSession(sessionId);

    // Lưu draft đơn hàng (PENDING_REVIEW)
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
    // Khách vừa xác nhận → đánh dấu tin nhắn + update đơn hàng
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.senderType === 'customer') {
      await chatDB.markCustomerConfirmed(sessionId, lastMsg.id);
    }

    const reply = 'Dạ em đã ghi nhận đơn của anh/chị! Bộ phận giao hàng sẽ liên hệ xác nhận ạ 🎉';
    await _sendAndSave({ session, reply });
    await chatDB.updateSessionIntent(sessionId, 'Đã Chốt');
    return { handled: 'order_confirmed', intent };
  }

  return { handled: 'noop', intent };
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const _sendAndSave = async ({ session, reply }) => {
  await chatDB.saveMessage({
    sessionId:   session.id,
    senderType:  'ai',
    content:     reply,
    intentAtTime: session.intent,
  });
  await sendFbMessage(session.pageId, session.customerPsid, reply);
  await chatDB.incrementTurnCount(session.id);
  await chatDB.touchSession(session.id);
};

const _extractProductFromHistory = async (messages) => {
  // Heuristic: lấy tên sản phẩm từ tin nhắn AI đầu tiên đề cập
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
