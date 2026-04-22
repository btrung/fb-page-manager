/**
 * Chat Routes — AI Chat feature
 *
 * Webhook (public, no auth — FB gọi trực tiếp):
 *   GET  /webhook/chat        — verify webhook token
 *   POST /webhook/chat        — nhận tin nhắn từ Messenger
 *
 * API (auth required):
 *   GET  /api/chat/sessions                         — danh sách hội thoại
 *   GET  /api/chat/sessions/:id/messages            — tin nhắn của session
 *   POST /api/chat/sessions/:id/ai-mode             — toggle AI mode
 *   POST /api/chat/sessions/:id/intent              — override intent
 *   POST /api/chat/sessions/:id/messages            — human gửi tin nhắn
 *   POST /api/chat/sessions/:id/tags                — thêm tag
 *   DELETE /api/chat/sessions/:id/tags/:tag         — xoá tag
 *   GET  /api/chat/sessions/:id/tags                — lấy tags
 *   GET  /api/chat/orders                           — đơn hàng chờ duyệt
 *   PUT  /api/chat/orders/:orderId                  — confirm/cancel đơn
 *   GET  /api/chat/settings                         — lấy cài đặt AI
 *   PUT  /api/chat/settings/:pageId                 — cập nhật cài đặt AI
 */
const express = require('express');
const chatDB = require('../db/chatDB');
const { addChatJob } = require('../queues/chatQueue');
const { sendFbMessage } = require('../utils/fbSendApi');

// =============================================
// Webhook Router (không cần auth)
// =============================================
const webhookRouter = express.Router();

// GET — Facebook verify webhook
webhookRouter.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.CHAT_WEBHOOK_VERIFY_TOKEN) {
    console.log('[CHAT WEBHOOK] Verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// POST — nhận tin nhắn từ Messenger
webhookRouter.post('/', express.json(), async (req, res) => {
  // Phải reply 200 ngay để FB không retry
  res.sendStatus(200);

  const body = req.body;
  if (body.object !== 'page') return;

  for (const entry of body.entry || []) {
    const pageId = entry.id;

    // Kiểm tra AI có được bật cho page này không
    const settings = await chatDB.getAiPageSettingsByPageId(pageId).catch(() => null);
    if (!settings || !settings.aiEnabled) continue;

    for (const event of entry.messaging || []) {
      // Bỏ qua tin nhắn do chính page gửi ra (echo)
      if (event.message?.is_echo) continue;
      // Bỏ qua nếu không có message
      if (!event.message) continue;

      const customerPsid = event.sender.id;
      const fbMessageId  = event.message.mid;
      const text         = event.message.text || null;
      const attachments  = event.message.attachments || [];

      try {
        // Tìm hoặc tạo session
        const session = await chatDB.getOrCreateSession({
          pageId,
          userId: settings.userId,
          customerPsid,
        });

        // Lưu tin nhắn của khách
        await chatDB.saveMessage({
          sessionId:    session.id,
          senderType:   'customer',
          content:      text,
          attachments:  attachments.map((a) => ({ type: a.type, url: a.payload?.url })),
          fbMessageId,
          intentAtTime: session.intent,
        });

        // Đẩy vào chat queue để AI xử lý
        await addChatJob({ sessionId: session.id, pageId, userId: settings.userId });

        console.log(`[CHAT WEBHOOK] page=${pageId} psid=${customerPsid} msg="${text?.slice(0, 50)}"`);
      } catch (err) {
        console.error('[CHAT WEBHOOK] Error processing message:', err.message);
      }
    }
  }
});


// =============================================
// API Router (cần auth — mount với requireAuth)
// =============================================
const apiRouter = express.Router();

// GET /api/chat/sessions — danh sách hội thoại của user
apiRouter.get('/sessions', async (req, res) => {
  try {
    const { intent, aiMode } = req.query;
    const sessions = await chatDB.getSessionsByUser(req.user.id, {
      intentFilter: intent || null,
      aiModeFilter: aiMode || null,
    });

    // Gắn tags cho mỗi session
    const sessionsWithTags = await Promise.all(
      sessions.map(async (s) => ({
        ...s,
        tags: await chatDB.getSessionTags(s.id),
      }))
    );

    res.json({ sessions: sessionsWithTags });
  } catch (err) {
    console.error('[CHAT API] GET sessions:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/sessions/:id/messages
apiRouter.get('/sessions/:id/messages', async (req, res) => {
  try {
    const session = await chatDB.getSessionById(req.params.id);
    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const limit    = Math.min(parseInt(req.query.limit) || 50, 100);
    const messages = await chatDB.getSessionMessages(req.params.id, limit);
    const order    = await chatDB.getOrderBySession(req.params.id);

    // Nếu có đơn hàng, lấy thêm tin nhắn bằng chứng xác nhận
    let confirmationMessages = [];
    if (order) {
      confirmationMessages = await chatDB.getConfirmationMessages(req.params.id);
    }

    res.json({ messages, order: order || null, confirmationMessages });
  } catch (err) {
    console.error('[CHAT API] GET messages:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/sessions/:id/messages — human gửi tin nhắn thủ công
apiRouter.post('/sessions/:id/messages', async (req, res) => {
  try {
    const session = await chatDB.getSessionById(req.params.id);
    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content required' });

    // Lưu tin nhắn human vào DB
    const message = await chatDB.saveMessage({
      sessionId:   session.id,
      senderType:  'human',
      content:     content.trim(),
      intentAtTime: session.intent,
    });

    // Gửi qua Facebook Send API
    await sendFbMessage(session.pageId, session.customerPsid, content.trim());

    // Human gửi → chuyển sang Người Tư Vấn nếu đang là AI
    if (session.aiMode === 'AI') {
      await chatDB.updateSessionAiMode(session.id, 'HUMAN');
    }

    res.json({ message });
  } catch (err) {
    console.error('[CHAT API] POST message:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/sessions/:id/ai-mode — toggle AI mode
apiRouter.post('/sessions/:id/ai-mode', async (req, res) => {
  try {
    const session = await chatDB.getSessionById(req.params.id);
    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { aiMode } = req.body; // 'AI' | 'HUMAN'
    if (!['AI', 'HUMAN'].includes(aiMode)) {
      return res.status(400).json({ error: 'aiMode must be AI or HUMAN' });
    }

    await chatDB.updateSessionAiMode(session.id, aiMode);

    // Nếu bật lại AI → đẩy job xử lý tin nhắn chưa trả lời
    if (aiMode === 'AI') {
      const unreplied = await chatDB.getUnrepliedSessions(session.pageId);
      await Promise.all(
        unreplied.map((s) => addChatJob({ sessionId: s.id, pageId: session.pageId, userId: req.user.id }))
      );
    }

    res.json({ sessionId: session.id, aiMode });
  } catch (err) {
    console.error('[CHAT API] POST ai-mode:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/sessions/:id/intent — override intent
apiRouter.post('/sessions/:id/intent', async (req, res) => {
  try {
    const session = await chatDB.getSessionById(req.params.id);
    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const validIntents = ['Muốn Mua', 'Đang Tư Vấn', 'Khách Đùa', 'Không Nhu Cầu', 'Đang Chốt', 'Đã Chốt', 'Dừng'];
    const { intent } = req.body;
    if (!validIntents.includes(intent)) {
      return res.status(400).json({ error: 'Intent không hợp lệ', validIntents });
    }

    await chatDB.updateSessionIntent(session.id, intent);
    res.json({ sessionId: session.id, intent });
  } catch (err) {
    console.error('[CHAT API] POST intent:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/sessions/:id/tags
apiRouter.post('/sessions/:id/tags', async (req, res) => {
  try {
    const session = await chatDB.getSessionById(req.params.id);
    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { tag } = req.body;
    if (!tag?.trim()) return res.status(400).json({ error: 'tag required' });

    await chatDB.addSessionTag(session.id, tag.trim());
    const tags = await chatDB.getSessionTags(session.id);
    res.json({ tags });
  } catch (err) {
    console.error('[CHAT API] POST tag:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chat/sessions/:id/tags/:tag
apiRouter.delete('/sessions/:id/tags/:tag', async (req, res) => {
  try {
    const session = await chatDB.getSessionById(req.params.id);
    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await chatDB.removeSessionTag(session.id, req.params.tag);
    const tags = await chatDB.getSessionTags(session.id);
    res.json({ tags });
  } catch (err) {
    console.error('[CHAT API] DELETE tag:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/sessions/:id/tags
apiRouter.get('/sessions/:id/tags', async (req, res) => {
  try {
    const session = await chatDB.getSessionById(req.params.id);
    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const tags = await chatDB.getSessionTags(session.id);
    res.json({ tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/orders — đơn chờ duyệt
apiRouter.get('/orders', async (req, res) => {
  try {
    const orders = await chatDB.getPendingOrders(req.user.id);
    res.json({ orders });
  } catch (err) {
    console.error('[CHAT API] GET orders:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/chat/orders/:orderId — confirm hoặc cancel đơn
apiRouter.put('/orders/:orderId', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['CONFIRMED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({ error: 'status must be CONFIRMED or CANCELLED' });
    }
    const order = await chatDB.updateOrderStatus(req.params.orderId, status);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ order });
  } catch (err) {
    console.error('[CHAT API] PUT order:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/settings — cài đặt AI của user
apiRouter.get('/settings', async (req, res) => {
  try {
    const settings = await chatDB.getAllAiPageSettings(req.user.id);
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/chat/settings/:pageId — cập nhật cài đặt AI
apiRouter.put('/settings/:pageId', async (req, res) => {
  try {
    const { aiEnabled, activeHours } = req.body;
    const setting = await chatDB.upsertAiPageSettings(
      req.user.id,
      req.params.pageId,
      { aiEnabled, activeHours }
    );
    res.json({ setting });
  } catch (err) {
    console.error('[CHAT API] PUT settings:', err.message);
    res.status(500).json({ error: err.message });
  }
});


module.exports = { webhookRouter, apiRouter };
