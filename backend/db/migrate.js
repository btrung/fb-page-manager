/**
 * Database Migration — chạy khi backend khởi động
 * Đọc schema.sql và thực thi idempotent
 * An toàn khi chạy lại: IF NOT EXISTS, DO $$ checks
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

/**
 * Chạy migration từ schema.sql
 * Tách các statement bằng dấu $$ để tránh split nhầm trong DO blocks
 */
const runMigration = async () => {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const client = await pool.connect();
  try {
    console.log('[MIGRATE] Bắt đầu migration database...');

    // Kiểm tra pgvector extension có sẵn không
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      console.log('[MIGRATE] ✅ pgvector extension OK');
    } catch (err) {
      console.warn('[MIGRATE] ⚠️  pgvector không khả dụng, vector columns sẽ bị bỏ qua');
      console.warn('[MIGRATE]    Dùng image: pgvector/pgvector:pg16 thay vì postgres:16-alpine');
    }

    // Thực thi toàn bộ schema trong 1 transaction
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
      console.log('[MIGRATE] ✅ Schema migration hoàn tất');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
};

/**
 * Kiểm tra trạng thái schema — dùng cho health check
 */
const checkSchema = async () => {
  const { rows } = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'posts', 'post_media', 'product_from_posts',
        'post_products', 'product_media_vectors', 'crawl_logs'
      )
    ORDER BY table_name
  `);
  return rows.map((r) => r.table_name);
};

module.exports = { runMigration, checkSchema, pool };
