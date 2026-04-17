-- =============================================
-- Product Intelligence Graph — Database Schema
-- Chạy idempotent: an toàn khi chạy lại nhiều lần
-- =============================================

-- Bật extension pgvector cho vector search
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================
-- 1. Mở rộng bảng posts hiện có
--    Thêm các cột LLM + intelligence fields
-- =============================================

-- Đổi tên cột message → content (nếu chưa đổi)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'message'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'content'
  ) THEN
    ALTER TABLE posts RENAME COLUMN message TO content;
  END IF;
END$$;

-- Thêm cột post_created_time_on_fb (map từ created_time của FB)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'post_created_time_on_fb'
  ) THEN
    ALTER TABLE posts RENAME COLUMN created_time TO post_created_time_on_fb;
  END IF;
END$$;

-- Các cột LLM extraction
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_sale_post            BOOLEAN   DEFAULT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_single_product_post  BOOLEAN   DEFAULT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS product_count           INTEGER   DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS extracted_product_name  TEXT      DEFAULT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS price                   INTEGER   DEFAULT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS what_is_product         TEXT      DEFAULT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS what_is_promotion       TEXT      DEFAULT NULL;

-- Vector embedding cho nội dung post (OpenAI text-embedding-3-small = 1536d)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS post_embedding          vector(1536);

-- Tracking
ALTER TABLE posts ADD COLUMN IF NOT EXISTS synced_time             TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE posts ADD COLUMN IF NOT EXISTS status                  VARCHAR(20) DEFAULT 'active';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS llm_processed           BOOLEAN     DEFAULT FALSE;

-- Unique constraint (post_id, page_id) — chống trùng lặp
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_id_page_id_key'
  ) THEN
    ALTER TABLE posts ADD CONSTRAINT posts_id_page_id_key UNIQUE (id, page_id);
  END IF;
END$$;

-- Index tìm kiếm theo trạng thái xử lý
CREATE INDEX IF NOT EXISTS idx_posts_llm_processed ON posts (llm_processed, status);
CREATE INDEX IF NOT EXISTS idx_posts_is_sale       ON posts (is_sale_post) WHERE is_sale_post = TRUE;


-- =============================================
-- 2. Bảng post_media — lưu ảnh từ bài đăng
--    Không lưu file ảnh, chỉ lưu URL + vector
-- =============================================
CREATE TABLE IF NOT EXISTS post_media (
  media_id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id          VARCHAR(255)  NOT NULL,
  page_id          VARCHAR(255)  NOT NULL,
  user_id          VARCHAR(255)  NOT NULL,
  image_url        TEXT          NOT NULL,
  -- Vector CLIP 512d — chỉ lưu sau khi embed xong
  image_embedding  vector(512),
  -- Perceptual hash để phát hiện ảnh trùng
  image_hash       VARCHAR(64),
  width            INTEGER,
  height           INTEGER,
  -- Trạng thái embedding: pending / done / failed
  embedding_status VARCHAR(20)   DEFAULT 'pending',
  created_at       TIMESTAMPTZ   DEFAULT NOW(),

  CONSTRAINT fk_post_media_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_media_unique
  ON post_media (post_id, image_url);

CREATE INDEX IF NOT EXISTS idx_post_media_status
  ON post_media (embedding_status) WHERE embedding_status IN ('pending', 'failed');


-- =============================================
-- 3. Bảng product_from_posts — sản phẩm được trích xuất
--    Gom nhóm theo tên sản phẩm, không trùng lặp
-- =============================================
CREATE TABLE IF NOT EXISTS product_from_posts (
  product_id       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          VARCHAR(255)  NOT NULL,
  product_name     TEXT          NOT NULL,
  -- Tên đã normalize (lowercase, bỏ dấu) để so sánh
  normalized_name  TEXT          NOT NULL,
  what_is_product  TEXT,
  what_is_promotion TEXT,
  -- Độ tin cậy của tên sản phẩm (0.0 - 1.0)
  name_confidence  FLOAT         DEFAULT 1.0,
  -- Post đầu tiên phát hiện sản phẩm này
  first_post_id    VARCHAR(255),
  first_page_id    VARCHAR(255),
  -- Số lần xuất hiện trong các bài đăng
  mention_count    INTEGER       DEFAULT 1,
  -- Giá hiện tại (cập nhật theo post mới nhất có giá)
  current_price    INTEGER,
  status           VARCHAR(20)   DEFAULT 'active',
  first_seen_at    TIMESTAMPTZ   DEFAULT NOW(),
  last_seen_at     TIMESTAMPTZ   DEFAULT NOW(),
  created_at       TIMESTAMPTZ   DEFAULT NOW()
);

-- Mỗi user chỉ có 1 product với cùng normalized_name
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_user_name
  ON product_from_posts (user_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_product_status
  ON product_from_posts (user_id, status);


-- =============================================
-- 4. Bảng post_products — quan hệ post ↔ product
--    1 post có thể có nhiều sản phẩm
-- =============================================
CREATE TABLE IF NOT EXISTS post_products (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id                VARCHAR(255)  NOT NULL,
  page_id                VARCHAR(255)  NOT NULL,
  product_id             UUID          NOT NULL,
  extracted_product_name TEXT,
  -- Độ tin cậy khi liên kết post → product
  confidence             FLOAT         DEFAULT 1.0,
  -- TRUE nếu đây là sản phẩm chính của bài đăng
  is_primary             BOOLEAN       DEFAULT TRUE,
  product_count          INTEGER       DEFAULT 1,
  created_at             TIMESTAMPTZ   DEFAULT NOW(),

  CONSTRAINT fk_pp_post    FOREIGN KEY (post_id)    REFERENCES posts (id)               ON DELETE CASCADE,
  CONSTRAINT fk_pp_product FOREIGN KEY (product_id) REFERENCES product_from_posts (product_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_products_unique
  ON post_products (post_id, product_id);

CREATE INDEX IF NOT EXISTS idx_post_products_product
  ON post_products (product_id);


-- =============================================
-- 5. Bảng product_media_vectors — vector ảnh của sản phẩm
--    Phục vụ AI Chat tìm kiếm ảnh sản phẩm
-- =============================================
CREATE TABLE IF NOT EXISTS product_media_vectors (
  id                         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id                 UUID          NOT NULL,
  product_name               TEXT,
  post_id                    VARCHAR(255)  NOT NULL,
  page_id                    VARCHAR(255)  NOT NULL,
  image_url                  TEXT          NOT NULL,
  -- Vector ảnh CLIP 512d
  image_embedding            vector(512),
  -- Vector tham chiếu của product (để so sánh similarity)
  product_reference_embedding vector(512),
  -- Điểm similarity ảnh với sản phẩm (0.0 - 1.0)
  similarity_score           FLOAT,
  -- TRUE nếu đây là ảnh đại diện chính của sản phẩm
  is_primary                 BOOLEAN       DEFAULT FALSE,
  created_at                 TIMESTAMPTZ   DEFAULT NOW(),

  CONSTRAINT fk_pmv_product FOREIGN KEY (product_id) REFERENCES product_from_posts (product_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pmv_product_image
  ON product_media_vectors (product_id, image_url);

CREATE INDEX IF NOT EXISTS idx_pmv_product
  ON product_media_vectors (product_id);


-- =============================================
-- 6. Bảng crawl_logs — lịch sử crawl
--    Theo dõi mỗi lần crawl: bao nhiêu post, kết quả
-- =============================================
CREATE TABLE IF NOT EXISTS crawl_logs (
  log_id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          VARCHAR(255)  NOT NULL,
  page_id          VARCHAR(255)  NOT NULL,
  -- Thống kê bài đăng
  posts_crawled    INTEGER       DEFAULT 0,
  posts_saved      INTEGER       DEFAULT 0,
  posts_skipped    INTEGER       DEFAULT 0,
  -- Thống kê media
  media_processed  INTEGER       DEFAULT 0,
  media_embedded   INTEGER       DEFAULT 0,
  -- Trạng thái: running / completed / failed
  status           VARCHAR(20)   DEFAULT 'running',
  -- Thông tin lỗi nếu có
  error_message    TEXT,
  -- Thời gian thực thi (giây)
  time_taken       FLOAT,
  -- Job ID từ BullMQ để tracking
  job_id           VARCHAR(255),
  created_at       TIMESTAMPTZ   DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crawl_logs_user_page
  ON crawl_logs (user_id, page_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crawl_logs_status
  ON crawl_logs (status) WHERE status = 'running';
