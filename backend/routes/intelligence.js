/**
 * Intelligence Routes — API cho Product Intelligence Graph
 *
 * POST /api/intelligence/crawl            — kích hoạt crawl 500 posts
 * GET  /api/intelligence/status/:jobId    — polling trạng thái job
 * GET  /api/intelligence/products         — danh sách sản phẩm đã extract
 * GET  /api/intelligence/posts            — posts đã xử lý LLM
 * GET  /api/intelligence/logs             — lịch sử crawl
 * GET  /api/intelligence/summary          — tổng quan dashboard
 * GET  /api/intelligence/debug/db         — thống kê DB + queue (debug)
 * POST /api/intelligence/retry-embeddings — retry failed embedding jobs
 */
const express = require('express');
const router = express.Router();

const { createJob, getJob, runBackground, subscribeJob, unsubscribeJob } = require('../queues/jobManager');
const { processCrawlJob } = require('../workers/crawlWorker');
const {
  getProductsByUser,
  countProductsByUser,
  getExistingPostIds,
  getCrawlLogs,
  getIntelligenceSummary,
  getPendingMedia,
  deleteUserData,
} = require('../db/intelligenceDB');
const { pool } = require('../db/migrate');

// =============================================
// POST /api/intelligence/crawl
// Trigger crawl job — lấy pageAccessToken từ session
// =============================================
router.post('/crawl', async (req, res, next) => {
  const { id: userId } = req.session.user;
  const { pageId, limit = 500 } = req.body;

  if (!pageId) {
    return res.status(400).json({ error: 'pageId là bắt buộc' });
  }

  // Lấy page access token đã lưu trong session khi user vào trang /pages
  const pageTokens = req.session.pageTokens || {};
  const pageAccessToken = pageTokens[pageId];

  if (!pageAccessToken) {
    return res.status(403).json({
      error: 'Không tìm thấy access token cho page này. Vào Dashboard để refresh.',
    });
  }

  // Giới hạn limit hợp lý
  const safeLimit = Math.min(Math.max(parseInt(limit) || 500, 10), 1000);

  try {
    const jobId = createJob({ userId, pageId, pageAccessToken, limit: safeLimit });
    runBackground(jobId, processCrawlJob);

    res.json({
      message: `Đã bắt đầu crawl ${safeLimit} posts`,
      jobId,
      pageId,
      limit: safeLimit,
    });
  } catch (err) {
    next({ status: 500, message: `Lỗi khi tạo crawl job: ${err.message}` });
  }
});

// =============================================
// GET /api/intelligence/status/:jobId
// Polling trạng thái — giữ lại cho backwards compat
// =============================================
router.get('/status/:jobId', async (req, res, next) => {
  try {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Không tìm thấy job' });
    res.json({ found: true, ...job });
  } catch (err) {
    next({ status: 500, message: err.message });
  }
});

// =============================================
// GET /api/intelligence/status/:jobId/stream
// SSE — push trạng thái job real-time, không polling
// =============================================
router.get('/status/:jobId/stream', (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);
  if (!job) {
    res.status(404).json({ error: 'Không tìm thấy job' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Gửi trạng thái hiện tại ngay lập tức
  send({ found: true, ...job });

  // Nếu job đã xong thì đóng luôn
  if (job.state === 'completed' || job.state === 'failed') {
    res.end();
    return;
  }

  // Subscribe nhận update
  const onUpdate = (updated) => {
    send({ found: true, ...updated });
    if (updated.state === 'completed' || updated.state === 'failed') {
      unsubscribeJob(jobId, onUpdate);
      res.end();
    }
  };

  subscribeJob(jobId, onUpdate);

  // Client ngắt kết nối → dọn dẹp
  req.on('close', () => unsubscribeJob(jobId, onUpdate));
});

// =============================================
// GET /api/intelligence/products
// Danh sách sản phẩm đã extract từ posts
// Query: ?limit=50&offset=0&search=áo
// =============================================
router.get('/products', async (req, res, next) => {
  const { id: userId } = req.session.user;
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const search = req.query.search?.trim() || '';

  try {
    const [products, total] = await Promise.all([
      getProductsByUser(userId, { limit, offset, search }),
      countProductsByUser(userId),
    ]);

    res.json({
      total,
      limit,
      offset,
      products,
    });
  } catch (err) {
    next({ status: 500, message: err.message });
  }
});

// =============================================
// GET /api/intelligence/posts
// Posts đã qua LLM — có product data
// Query: ?pageId=xxx&limit=50&offset=0&saleOnly=true
// =============================================
router.get('/posts', async (req, res, next) => {
  const { id: userId } = req.session.user;
  const { pageId, saleOnly } = req.query;
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);

  try {
    const conditions = ['p.user_id = $1', 'p.llm_processed = TRUE'];
    const params = [userId];
    let idx = 2;

    if (pageId) {
      conditions.push(`p.page_id = $${idx++}`);
      params.push(pageId);
    }
    if (saleOnly === 'true') {
      conditions.push('p.is_sale_post = TRUE');
    }

    const where = conditions.join(' AND ');
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT
         p.id                                AS "postId",
         p.page_id                           AS "pageId",
         p.content,
         p.picture_url                       AS "pictureUrl",
         p.permalink,
         p.is_sale_post                      AS "isSalePost",
         p.extracted_product_name            AS "extractedProductName",
         p.price,
         p.what_is_product                   AS "whatIsProduct",
         p.what_is_promotion                 AS "whatIsPromotion",
         p.product_count                     AS "productCount",
         p.post_created_time_on_fb           AS "createdTime",
         p.synced_time                       AS "syncedTime",
         COUNT(pm.media_id)::int             AS "imageCount",
         COUNT(pm.media_id) FILTER (WHERE pm.embedding_status = 'done')::int AS "embeddedImages"
       FROM posts p
       LEFT JOIN post_media pm ON pm.post_id = p.id
       WHERE ${where}
       GROUP BY p.id
       ORDER BY p.post_created_time_on_fb DESC NULLS LAST
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    // Đếm tổng
    const countParams = params.slice(0, -2);
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM posts p WHERE ${where}`,
      countParams,
    );

    res.json({
      total: countRows[0]?.total || 0,
      limit,
      offset,
      posts: rows,
    });
  } catch (err) {
    next({ status: 500, message: err.message });
  }
});

// =============================================
// GET /api/intelligence/logs
// Lịch sử crawl jobs
// Query: ?pageId=xxx&limit=20
// =============================================
router.get('/logs', async (req, res, next) => {
  const { id: userId } = req.session.user;
  const { pageId } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  try {
    const logs = await getCrawlLogs(userId, pageId || null, limit);
    res.json({ logs });
  } catch (err) {
    next({ status: 500, message: err.message });
  }
});

// =============================================
// GET /api/intelligence/summary
// Tổng quan cho dashboard
// =============================================
router.get('/summary', async (req, res, next) => {
  const { id: userId } = req.session.user;
  try {
    const summary = await getIntelligenceSummary(userId);
    res.json(summary);
  } catch (err) {
    next({ status: 500, message: err.message });
  }
});

// =============================================
// GET /api/intelligence/debug/db
// Thống kê DB + queue — dùng để debug/monitor
// =============================================
router.get('/debug/db', async (req, res, next) => {
  const { id: userId } = req.session.user;
  try {
    const [summary, pendingMedia] = await Promise.all([
      getIntelligenceSummary(userId),
      getPendingMedia(userId, 10),
    ]);

    res.json({
      db: summary,
      pendingMediaSample: pendingMedia.map((m) => ({
        mediaId: m.media_id,
        postId: m.post_id,
        status: m.embedding_status,
        url: m.image_url?.slice(0, 80) + '...',
      })),
    });
  } catch (err) {
    next({ status: 500, message: err.message });
  }
});


// =============================================
// DELETE /api/intelligence/data
// Xóa toàn bộ data của user hiện tại
// =============================================
router.delete('/data', async (req, res, next) => {
  const { id: userId } = req.session.user;
  try {
    const result = await deleteUserData(userId);
    res.json({ message: 'Đã xóa toàn bộ dữ liệu', deleted: result });
  } catch (err) {
    next({ status: 500, message: err.message });
  }
});

module.exports = router;
