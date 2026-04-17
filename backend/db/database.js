/**
 * PostgreSQL — dùng node-postgres (pg)
 * Schema được quản lý bởi migrate.js
 */
const { Pool } = require('pg');
const { runMigration } = require('./migrate');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// =============================================
// Khởi tạo DB: chạy migration schema đầy đủ
// =============================================
const initDb = async () => {
  // Tạo bảng posts cơ bản trước (đảm bảo tồn tại trước khi migrate)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id           VARCHAR(255) PRIMARY KEY,
      page_id      VARCHAR(255) NOT NULL,
      user_id      VARCHAR(255) NOT NULL,
      content      TEXT         DEFAULT '',
      picture_url  TEXT,
      permalink    TEXT,
      likes        INTEGER      DEFAULT 0,
      comments     INTEGER      DEFAULT 0,
      shares       INTEGER      DEFAULT 0,
      saved_at     TIMESTAMPTZ  DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_posts_user_page ON posts (user_id, page_id);
  `);

  // Chạy migration thêm các bảng intelligence + cột mới
  await runMigration();
  console.log('[DB] PostgreSQL ready');
};

initDb().catch((err) => console.error('[DB] Init failed:', err.message));

// =============================================
// Lưu nhiều posts (upsert — nếu đã có thì update)
// Dùng tên cột mới: content, post_created_time_on_fb
// =============================================
const savePosts = async (userId, pageId, posts) => {
  if (posts.length === 0) return 0;

  let saved = 0;
  for (const post of posts) {
    await pool.query(
      `INSERT INTO posts
         (id, page_id, user_id, content, post_created_time_on_fb, picture_url, permalink, likes, comments, shares, saved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
       ON CONFLICT (id) DO UPDATE SET
         content                  = EXCLUDED.content,
         picture_url              = EXCLUDED.picture_url,
         permalink                = EXCLUDED.permalink,
         likes                    = EXCLUDED.likes,
         comments                 = EXCLUDED.comments,
         shares                   = EXCLUDED.shares,
         saved_at                 = NOW()`,
      [
        post.id,
        pageId,
        userId,
        post.message || '',
        post.createdTime || null,
        post.picture || null,
        post.permalink || null,
        post.likes || 0,
        post.comments || 0,
        post.shares || 0,
      ]
    );
    saved++;
  }
  return saved;
};

// =============================================
// Lấy posts của 1 page từ DB
// =============================================
const getPostsByPage = async (userId, pageId, limit = 50) => {
  const { rows } = await pool.query(
    `SELECT id, page_id AS "pageId", user_id AS "userId",
            content AS message,
            post_created_time_on_fb AS "createdTime",
            picture_url AS "pictureUrl",
            permalink, likes, comments, shares,
            saved_at AS "savedAt",
            is_sale_post AS "isSalePost",
            extracted_product_name AS "extractedProductName",
            price, llm_processed AS "llmProcessed"
     FROM posts
     WHERE user_id = $1 AND page_id = $2
     ORDER BY post_created_time_on_fb DESC NULLS LAST
     LIMIT $3`,
    [userId, pageId, limit]
  );
  return rows;
};

// =============================================
// Đếm số posts trong DB
// =============================================
const countPosts = async (userId, pageId) => {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM posts WHERE user_id = $1 AND page_id = $2',
    [userId, pageId]
  );
  return rows[0].count;
};

// =============================================
// Tổng quan pages đã lưu của 1 user
// =============================================
const getSavedPages = async (userId) => {
  const { rows } = await pool.query(
    `SELECT page_id AS "pageId",
            COUNT(*)::int AS "postCount",
            MAX(saved_at) AS "lastSaved"
     FROM posts
     WHERE user_id = $1
     GROUP BY page_id`,
    [userId]
  );
  return rows;
};

module.exports = { savePosts, getPostsByPage, countPosts, getSavedPages };
