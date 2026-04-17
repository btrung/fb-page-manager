/**
 * Sync Routes — auto-sync + debug endpoints
 *
 * GET  /sync/webhook                — FB webhook verification (hub.challenge)
 * POST /sync/webhook                — Nhận FB webhook khi có post mới
 * GET  /api/debug/queue-stats       — Thống kê BullMQ queues
 * POST /api/debug/retry-embeddings  — Retry failed embedding jobs
 * GET  /api/debug/pending-media     — Danh sách ảnh chưa embed
 * POST /api/debug/reset-log/:logId  — Xoá crawl log (debug)
 */
const express = require('express');
const crypto  = require('crypto');

const { addCrawlJob, getCrawlQueueStats }            = require('../queues/crawlQueue');
const { retryFailedEmbeddingJobs, getEmbeddingQueueStats } = require('../queues/embeddingQueue');
const { getPendingMedia, getCrawlLogs }               = require('../db/intelligenceDB');
const { pool }                                        = require('../db/migrate');

// =============================================
// Webhook router — KHÔNG cần requireAuth
// FB gọi trực tiếp, xác thực bằng VERIFY_TOKEN
// =============================================
const webhookRouter = express.Router();

// GET /sync/webhook — FB gửi challenge để verify endpoint
webhookRouter.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

  const verifyToken = process.env.FB_WEBHOOK_VERIFY_TOKEN || 'fb_webhook_secret';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[WEBHOOK] Webhook verified ✅');
    return res.status(200).send(challenge);
  }

  console.warn('[WEBHOOK] Verification failed');
  res.sendStatus(403);
});

// POST /sync/webhook — FB gửi event khi có post mới
// Xác thực signature bằng FB App Secret
webhookRouter.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // Trả 200 ngay cho FB — tránh timeout 20s
  res.sendStatus(200);

  try {
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (appSecret) {
      const sig = req.headers['x-hub-signature-256'] || '';
      const expected = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(req.body)
        .digest('hex');

      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        console.warn('[WEBHOOK] Signature mismatch — bỏ qua');
        return;
      }
    }

    const body = JSON.parse(req.body.toString());

    // Xử lý feed events (post mới)
    if (body.object === 'page') {
      for (const entry of body.entry || []) {
        const pageId = entry.id;

        for (const change of entry.changes || []) {
          if (change.field !== 'feed') continue;

          const item = change.value;
          // Chỉ xử lý post mới, không xử lý comment/like
          if (item.item !== 'status' && item.item !== 'photo' && item.item !== 'link') continue;
          if (item.verb !== 'add') continue;

          console.log(`[WEBHOOK] Post mới từ page ${pageId}: ${item.post_id}`);

          // Lấy page token từ DB (cần lưu token riêng cho webhook)
          // Webhook không có session — dùng stored token
          const { rows } = await pool.query(
            `SELECT page_access_token FROM page_tokens WHERE page_id = $1 LIMIT 1`,
            [pageId],
          ).catch(() => ({ rows: [] }));

          if (!rows[0]?.page_access_token) {
            console.warn(`[WEBHOOK] Không có token cho page ${pageId}`);
            continue;
          }

          // Tìm user_id của page này
          const { rows: userRows } = await pool.query(
            `SELECT DISTINCT user_id FROM posts WHERE page_id = $1 LIMIT 1`,
            [pageId],
          ).catch(() => ({ rows: [] }));

          const userId = userRows[0]?.user_id;
          if (!userId) {
            console.warn(`[WEBHOOK] Không tìm được user cho page ${pageId}`);
            continue;
          }

          // Enqueue crawl job — chỉ lấy 50 posts mới nhất để sync
          await addCrawlJob({
            userId,
            pageId,
            pageAccessToken: rows[0].page_access_token,
            limit: 50,
            triggeredBy: 'webhook',
          }).catch((err) => console.error('[WEBHOOK] Enqueue failed:', err.message));
        }
      }
    }
  } catch (err) {
    console.error('[WEBHOOK] Xử lý event thất bại:', err.message);
  }
});

// =============================================
// Debug router — cần requireAuth (mount trong api)
// =============================================
const debugRouter = express.Router();

// GET /api/debug/queue-stats
debugRouter.get('/queue-stats', async (req, res, next) => {
  try {
    const [crawl, embedding] = await Promise.all([
      getCrawlQueueStats(),
      getEmbeddingQueueStats(),
    ]);
    res.json({ crawl, embedding });
  } catch (err) {
    next({ status: 500, message: err.message });
  }
});

// POST /api/debug/retry-embeddings
debugRouter.post('/retry-embeddings', async (req, res, next) => {
  try {
    const retried = await retryFailedEmbeddingJobs();
    res.json({ message: `Đã retry ${retried} embedding jobs`, retried });
  } catch (err) {
    next({ status: 500, message: err.message });
  }
});

// GET /api/debug/pending-media?limit=50
debugRouter.get('/pending-media', async (req, res, next) => {
  const { id: userId } = req.session.user;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  try {
    const media = await getPendingMedia(userId, limit);
    res.json({ total: media.length, media });
  } catch (err) {
    next({ status: 500, message: err.message });
  }
});

// GET /api/debug/crawl-logs?pageId=xxx
debugRouter.get('/crawl-logs', async (req, res, next) => {
  const { id: userId } = req.session.user;
  const { pageId } = req.query;
  try {
    const logs = await getCrawlLogs(userId, pageId || null, 50);
    res.json({ logs });
  } catch (err) {
    next({ status: 500, message: err.message });
  }
});

// GET /api/debug/db-tables — kiểm tra bảng đã migrate chưa
debugRouter.get('/db-tables', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT table_name,
             (SELECT COUNT(*)::int FROM information_schema.columns c
              WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS col_count
      FROM information_schema.tables t
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    res.json({ tables: rows });
  } catch (err) {
    next({ status: 500, message: err.message });
  }
});

module.exports = { webhookRouter, debugRouter };
