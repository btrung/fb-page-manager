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
// PRODUCT_FROM_POSTS
// =============================================

/**
 * Normalize tên sản phẩm để so sánh: lowercase + bỏ dấu + trim
 * Ví dụ: "Áo Polo Nam" → "ao polo nam"
 */
const normalizeProductName = (name) => {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')                     // tách dấu khỏi ký tự gốc
    .replace(/[\u0300-\u036f]/g, '')      // xoá dấu
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Upsert sản phẩm từ post:
 *  - Nếu chưa có: tạo mới
 *  - Nếu đã có:
 *    + Tăng mention_count
 *    + Update price nếu post mới hơn và có giá
 *    + Update last_seen_at
 * Trả về { productId, isNew }
 */
const upsertProduct = async ({
  userId, productName, whatIsProduct, whatIsPromotion,
  firstPostId, firstPageId, price, postCreatedTime,
}) => {
  const normalized = normalizeProductName(productName);
  if (!normalized) return null;

  const { rows } = await pool.query(
    `INSERT INTO product_from_posts (
       user_id, product_name, normalized_name,
       what_is_product, what_is_promotion,
       first_post_id, first_page_id,
       mention_count, current_price,
       first_seen_at, last_seen_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       1, $8, $9, $9
     )
     ON CONFLICT (user_id, normalized_name) DO UPDATE SET
       mention_count    = product_from_posts.mention_count + 1,
       last_seen_at     = NOW(),
       what_is_product  = COALESCE(EXCLUDED.what_is_product, product_from_posts.what_is_product),
       what_is_promotion = COALESCE(EXCLUDED.what_is_promotion, product_from_posts.what_is_promotion),
       -- Chỉ update price nếu post mới hơn post đã biết và có giá
       current_price    = CASE
         WHEN $8 IS NOT NULL
           AND $9 IS NOT NULL
           AND (product_from_posts.last_seen_at IS NULL OR $9 > product_from_posts.last_seen_at)
         THEN $8
         ELSE product_from_posts.current_price
       END
     RETURNING product_id, (xmax = 0) AS is_new`,
    [
      userId, productName, normalized,
      whatIsProduct, whatIsPromotion,
      firstPostId, firstPageId,
      price, postCreatedTime,
    ],
  );

  if (rows.length === 0) return null;
  return { productId: rows[0].product_id, isNew: rows[0].is_new };
};

/**
 * Lấy danh sách sản phẩm của 1 user (cho UI)
 */
const getProductsByUser = async (userId, { limit = 50, offset = 0, search = '' } = {}) => {
  const searchClause = search
    ? `AND (p.product_name ILIKE $3 OR p.normalized_name ILIKE $3)`
    : '';
  const params = search
    ? [userId, limit, `%${search}%`, offset]
    : [userId, limit, offset];

  const { rows } = await pool.query(
    `SELECT
       product_id AS "productId",
       product_name AS "productName",
       what_is_product AS "whatIsProduct",
       what_is_promotion AS "whatIsPromotion",
       current_price AS "currentPrice",
       mention_count AS "mentionCount",
       first_page_id AS "firstPageId",
       status,
       first_seen_at AS "firstSeenAt",
       last_seen_at AS "lastSeenAt"
     FROM product_from_posts p
     WHERE user_id = $1 ${searchClause}
     ORDER BY mention_count DESC, last_seen_at DESC
     LIMIT $2 OFFSET $${search ? 4 : 3}`,
    params,
  );
  return rows;
};

/**
 * Đếm tổng sản phẩm của user
 */
const countProductsByUser = async (userId) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM product_from_posts WHERE user_id = $1`,
    [userId],
  );
  return rows[0].count;
};

// =============================================
// POST_PRODUCTS (quan hệ post ↔ product)
// =============================================

/**
 * Tạo liên kết post → product
 * ON CONFLICT DO NOTHING — tránh duplicate
 */
const linkPostToProduct = async ({
  postId, pageId, productId, extractedProductName,
  confidence = 1.0, isPrimary = true, productCount = 1,
}) => {
  await pool.query(
    `INSERT INTO post_products
       (post_id, page_id, product_id, extracted_product_name,
        confidence, is_primary, product_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (post_id, product_id) DO NOTHING`,
    [postId, pageId, productId, extractedProductName,
     confidence, isPrimary, productCount],
  );
};

// =============================================
// PRODUCT_MEDIA_VECTORS
// =============================================

/**
 * Lưu vector ảnh sản phẩm vào product_media_vectors
 * Dùng sau khi embedding worker xử lý xong
 */
const saveProductMediaVector = async ({
  productId, productName, postId, pageId,
  imageUrl, imageEmbedding, isPrimary = false, similarityScore = null,
}) => {
  await pool.query(
    `INSERT INTO product_media_vectors
       (product_id, product_name, post_id, page_id, image_url,
        image_embedding, similarity_score, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8)
     ON CONFLICT (product_id, image_url) DO UPDATE SET
       image_embedding  = EXCLUDED.image_embedding,
       similarity_score = EXCLUDED.similarity_score,
       is_primary       = EXCLUDED.is_primary`,
    [
      productId, productName, postId, pageId,
      imageUrl,
      imageEmbedding ? JSON.stringify(imageEmbedding) : null,
      similarityScore, isPrimary,
    ],
  );
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
       (SELECT COUNT(*)::int FROM product_from_posts
        WHERE user_id = $1)                                    AS "totalProducts",
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
  // Products
  upsertProduct,
  getProductsByUser,
  countProductsByUser,
  normalizeProductName,
  // Post-product links
  linkPostToProduct,
  // Product media vectors
  saveProductMediaVector,
  // Crawl logs
  createCrawlLog,
  updateCrawlLog,
  getCrawlLogs,
  // Stats
  getIntelligenceSummary,
};
