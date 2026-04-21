/**
 * Intelligence DB Layer — tất cả queries cho Product Intelligence Graph
 * Các bảng: posts (extended), post_media, product_from_posts,
 *           post_products, product_media_vectors, crawl_logs
 *
 * Nguyên tắc:
 *  - Idempotent: chạy lại không tạo dữ liệu trùng
 *  - Không raise exception khi conflict — dùng ON CONFLICT DO NOTHING/UPDATE
 *  - Dùng pool từ migrate.js để share connection
 */
const { pool } = require('./migrate');

// =============================================
// POSTS
// =============================================

/**
 * Lưu post với đầy đủ fields từ FB + LLM extraction
 * ON CONFLICT (id) DO NOTHING — không ghi đè post đã có
 * Trả về: 'inserted' | 'skipped'
 */
const insertPost = async ({
  postId, pageId, userId, content, pictureUrl, permalink,
  likes, comments, shares, postCreatedTimeOnFb,
  isSalePost, isSingleProductPost, productCount,
  extractedProductName, price, whatIsProduct, whatIsPromotion,
}) => {
  const { rows } = await pool.query(
    `INSERT INTO posts (
       id, page_id, user_id, content, picture_url, permalink,
       likes, comments, shares, post_created_time_on_fb, saved_at,
       is_sale_post, is_single_product_post, product_count,
       extracted_product_name, price, what_is_product, what_is_promotion,
       llm_processed, synced_time, status
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),
       $11,$12,$13,$14,$15,$16,$17,
       TRUE, NOW(), 'active'
     )
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      postId, pageId, userId, content || '', pictureUrl, permalink,
      likes || 0, comments || 0, shares || 0, postCreatedTimeOnFb,
      isSalePost, isSingleProductPost ?? null, productCount || 0,
      extractedProductName, price, whatIsProduct, whatIsPromotion,
    ],
  );
  return rows.length > 0 ? 'inserted' : 'skipped';
};

/**
 * Lấy danh sách post_id đã tồn tại trong DB cho 1 page
 * Dùng để skip posts đã crawl
 */
const getExistingPostIds = async (userId, pageId) => {
  const { rows } = await pool.query(
    `SELECT id FROM posts WHERE user_id = $1 AND page_id = $2`,
    [userId, pageId],
  );
  return new Set(rows.map((r) => r.id));
};

/**
 * Cập nhật post_embedding sau khi embed text
 * (gọi sau khi AI service trả về vector)
 */
const updatePostEmbedding = async (postId, embeddingJson) => {
  await pool.query(
    `UPDATE posts SET post_embedding = $2::vector WHERE id = $1`,
    [postId, JSON.stringify(embeddingJson)],
  );
};

// =============================================
// POST_MEDIA
// =============================================

/**
 * Lưu danh sách ảnh của 1 post vào post_media
 * Trả về mảng { mediaId, imageUrl } cho những ảnh đã insert mới
 * (skip ảnh đã tồn tại)
 */
const savePostMediaBatch = async (postId, pageId, userId, imageUrls) => {
  if (!imageUrls || imageUrls.length === 0) return [];

  const inserted = [];
  for (const url of imageUrls) {
    const { rows } = await pool.query(
      `INSERT INTO post_media (post_id, page_id, user_id, image_url, embedding_status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (post_id, image_url) DO NOTHING
       RETURNING media_id, image_url`,
      [postId, pageId, userId, url],
    );
    if (rows.length > 0) {
      inserted.push({ mediaId: rows[0].media_id, imageUrl: rows[0].image_url });
    }
  }
  return inserted;
};

/**
 * Cập nhật trạng thái embedding của 1 media
 * status: 'done' | 'failed' | 'pending'
 * embeddingJson: vector array (nullable)
 */
const updateMediaEmbeddingStatus = async (mediaId, status, embeddingJson = null) => {
  if (embeddingJson) {
    await pool.query(
      `UPDATE post_media
       SET embedding_status = $2,
           image_embedding  = $3::vector
       WHERE media_id = $1`,
      [mediaId, status, JSON.stringify(embeddingJson)],
    );
  } else {
    await pool.query(
      `UPDATE post_media SET embedding_status = $2 WHERE media_id = $1`,
      [mediaId, status],
    );
  }
};

/**
 * Lấy danh sách media đang pending/failed để re-process
 */
const getPendingMedia = async (userId, limit = 100) => {
  const { rows } = await pool.query(
    `SELECT pm.media_id, pm.post_id, pm.page_id, pm.image_url,
            pm.embedding_status
     FROM post_media pm
     JOIN posts p ON p.id = pm.post_id
     WHERE p.user_id = $1
       AND pm.embedding_status IN ('pending', 'failed')
     ORDER BY pm.created_at ASC
     LIMIT $2`,
    [userId, limit],
  );
  return rows;
};

// =============================================
// CRAWL_LOGS
// =============================================

/**
 * Tạo crawl log mới khi bắt đầu job
 * Trả về logId để update sau
 */
const createCrawlLog = async ({ userId, pageId, jobId }) => {
  const { rows } = await pool.query(
    `INSERT INTO crawl_logs (user_id, page_id, job_id, status)
     VALUES ($1, $2, $3, 'running')
     RETURNING log_id`,
    [userId, pageId, jobId],
  );
  return rows[0].log_id;
};

/**
 * Cập nhật crawl log khi hoàn thành hoặc thất bại
 */
const updateCrawlLog = async (logId, {
  status, postsCrawled = 0, postsSaved = 0, postsSkipped = 0,
  mediaProcessed = 0, mediaEmbedded = 0, timeTaken = null, errorMessage = null,
}) => {
  await pool.query(
    `UPDATE crawl_logs SET
       status          = $2,
       posts_crawled   = $3,
       posts_saved     = $4,
       posts_skipped   = $5,
       media_processed = $6,
       media_embedded  = $7,
       time_taken      = $8,
       error_message   = $9,
       updated_at      = NOW()
     WHERE log_id = $1`,
    [logId, status, postsCrawled, postsSaved, postsSkipped,
     mediaProcessed, mediaEmbedded, timeTaken, errorMessage],
  );
};

/**
 * Lấy lịch sử crawl của 1 user/page
 */
const getCrawlLogs = async (userId, pageId = null, limit = 20) => {
  const params = pageId ? [userId, pageId, limit] : [userId, limit];
  const pageClause = pageId ? 'AND page_id = $2' : '';
  const limitParam = pageId ? '$3' : '$2';

  const { rows } = await pool.query(
    `SELECT
       log_id AS "logId",
       page_id AS "pageId",
       posts_crawled AS "postsCrawled",
       posts_saved AS "postsSaved",
       posts_skipped AS "postsSkipped",
       media_processed AS "mediaProcessed",
       media_embedded AS "mediaEmbedded",
       status,
       time_taken AS "timeTaken",
       error_message AS "errorMessage",
       job_id AS "jobId",
       created_at AS "createdAt"
     FROM crawl_logs
     WHERE user_id = $1 ${pageClause}
     ORDER BY created_at DESC
     LIMIT ${limitParam}`,
    params,
  );
  return rows;
};

// =============================================
// STATS (dashboard)
// =============================================

/**
 * Tổng quan intelligence data của 1 user
 */
const getIntelligenceSummary = async (userId) => {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM posts
        WHERE user_id = $1 AND is_sale_post = TRUE)           AS "salePosts",
       (SELECT COUNT(*)::int FROM posts
        WHERE user_id = $1 AND llm_processed = TRUE)          AS "processedPosts",
       (SELECT COUNT(*)::int FROM post_media pm
        JOIN posts p ON p.id = pm.post_id
        WHERE p.user_id = $1 AND pm.embedding_status = 'done') AS "embeddedImages",
       (SELECT COUNT(*)::int FROM post_media pm
        JOIN posts p ON p.id = pm.post_id
        WHERE p.user_id = $1 AND pm.embedding_status = 'pending') AS "pendingImages"`,
    [userId],
  );
  return rows[0];
};

module.exports = {
  // Posts
  insertPost,
  getExistingPostIds,
  updatePostEmbedding,
  // Post media
  savePostMediaBatch,
  updateMediaEmbeddingStatus,
  getPendingMedia,
  // Crawl logs
  createCrawlLog,
  updateCrawlLog,
  getCrawlLogs,
  // Stats
  getIntelligenceSummary,
  // Delete
  deleteUserData,
};

// =============================================
// DELETE USER DATA
// =============================================
async function deleteUserData(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r1 = await client.query(`DELETE FROM post_media  WHERE user_id = $1`, [userId]);
    const r2 = await client.query(`DELETE FROM crawl_logs  WHERE user_id = $1`, [userId]);
    const r3 = await client.query(`DELETE FROM posts       WHERE user_id = $1`, [userId]);
    await client.query('COMMIT');
    return {
      post_media: r1.rowCount,
      crawl_logs: r2.rowCount,
      posts: r3.rowCount,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
