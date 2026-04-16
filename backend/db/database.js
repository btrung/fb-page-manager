/**
 * PostgreSQL — dùng node-postgres (pg)
 * Bảng posts tự động tạo khi khởi động nếu chưa có
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// =============================================
// Tạo bảng nếu chưa tồn tại
// =============================================
const initDb = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id           VARCHAR(255) PRIMARY KEY,
      page_id      VARCHAR(255) NOT NULL,
      user_id      VARCHAR(255) NOT NULL,
      message      TEXT         DEFAULT '',
      created_time TIMESTAMPTZ,
      picture_url  TEXT,
      permalink    TEXT,
      likes        INTEGER      DEFAULT 0,
      comments     INTEGER      DEFAULT 0,
      shares       INTEGER      DEFAULT 0,
      saved_at     TIMESTAMPTZ  DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_posts_user_page ON posts (user_id, page_id);
  `);
  console.log('[DB] PostgreSQL ready');
};

initDb().catch((err) => console.error('[DB] Init failed:', err.message));

// =============================================
// Lưu nhiều posts (upsert — nếu đã có thì update)
// =============================================
const savePosts = async (userId, pageId, posts) => {
  if (posts.length === 0) return 0;

  let saved = 0;
  for (const post of posts) {
    await pool.query(
      `INSERT INTO posts
         (id, page_id, user_id, message, created_time, picture_url, permalink, likes, comments, shares, saved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
       ON CONFLICT (id) DO UPDATE SET
         message      = EXCLUDED.message,
         picture_url  = EXCLUDED.picture_url,
         permalink    = EXCLUDED.permalink,
         likes        = EXCLUDED.likes,
         comments     = EXCLUDED.comments,
         shares       = EXCLUDED.shares,
         saved_at     = NOW()`,
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
    `SELECT id, page_id AS "pageId", user_id AS "userId", message,
            created_time AS "createdTime", picture_url AS "pictureUrl",
            permalink, likes, comments, shares, saved_at AS "savedAt"
     FROM posts
     WHERE user_id = $1 AND page_id = $2
     ORDER BY created_time DESC
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
