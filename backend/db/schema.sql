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

-- Vector embedding cho nội dung post (Gemini text-embedding-004 = 768d)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS post_embedding          vector(768);

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
  -- Ảnh đại diện sản phẩm (ảnh đầu tiên từ post phát hiện)
  image_url        TEXT,
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


-- =============================================
-- 7. Bảng page_tokens — lưu page access token cho webhook
--    Webhook không có session, cần token persistent
-- =============================================
CREATE TABLE IF NOT EXISTS page_tokens (
  page_id           VARCHAR(255) PRIMARY KEY,
  user_id           VARCHAR(255) NOT NULL,
  page_access_token TEXT         NOT NULL,
  updated_at        TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_tokens_user
  ON page_tokens (user_id);


-- =============================================
-- ALTER: thêm cột mới cho DB đã tồn tại (idempotent)
-- =============================================
ALTER TABLE product_from_posts ADD COLUMN IF NOT EXISTS image_url TEXT;


-- =============================================
-- 8. AI Chat — cài đặt AI per fanpage
-- =============================================
CREATE TABLE IF NOT EXISTS ai_page_settings (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      VARCHAR(255) NOT NULL,
  page_id      VARCHAR(255) NOT NULL,
  ai_enabled   BOOLEAN      DEFAULT false,
  -- null = 24/7, có giá trị: {"start":"08:00","end":"22:00","timezone":"Asia/Ho_Chi_Minh"}
  active_hours JSONB,
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(user_id, page_id)
);


-- =============================================
-- 9. AI Chat — sessions hội thoại với khách
-- =============================================
CREATE TABLE IF NOT EXISTS chat_sessions (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id           VARCHAR(255) NOT NULL,
  user_id           VARCHAR(255) NOT NULL,
  customer_psid     VARCHAR(255) NOT NULL,
  customer_name     VARCHAR(255),
  customer_avatar   TEXT,
  -- Intent: Muốn Mua | Đang Tư Vấn | Khách Đùa | Không Nhu Cầu | Đang Chốt | Đã Chốt | Dừng
  intent            VARCHAR(50)  DEFAULT 'Khách Đùa',
  intent_updated_at TIMESTAMPTZ  DEFAULT NOW(),
  -- AI Mode: 'AI' = AI Hoạt Động | 'HUMAN' = Người Tư Vấn
  ai_mode           VARCHAR(10)  DEFAULT 'AI',
  cooldown_until    TIMESTAMPTZ,
  ai_turn_count     INTEGER      DEFAULT 0,
  last_message_at   TIMESTAMPTZ  DEFAULT NOW(),
  created_at        TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(page_id, customer_psid)
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user
  ON chat_sessions (user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_page_psid
  ON chat_sessions (page_id, customer_psid);


-- =============================================
-- 10. AI Chat — tin nhắn
-- =============================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id              UUID         NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  -- sender_type: 'customer' | 'ai' | 'human'
  sender_type             VARCHAR(10)  NOT NULL,
  content                 TEXT,
  attachments             JSONB        DEFAULT '[]',
  intent_at_time          VARCHAR(50),
  is_confirmation_summary BOOLEAN      DEFAULT false,
  is_customer_confirmed   BOOLEAN      DEFAULT false,
  fb_message_id           VARCHAR(255) UNIQUE,
  created_at              TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
  ON chat_messages (session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_confirmation
  ON chat_messages (session_id, is_confirmation_summary, is_customer_confirmed);


-- =============================================
-- 11. AI Chat — tags thủ công của user
-- =============================================
CREATE TABLE IF NOT EXISTS session_tags (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID         NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  tag        VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(session_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_session_tags_session
  ON session_tags (session_id);


-- =============================================
-- 12. AI Chat — đơn hàng được AI chốt
-- =============================================
CREATE TABLE IF NOT EXISTS chat_orders (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                  UUID        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  customer_name               VARCHAR(255),
  phone                       VARCHAR(50),
  address                     TEXT,
  product_name                TEXT,
  note                        TEXT,
  -- status: PENDING_REVIEW | CONFIRMED | CANCELLED
  status                      VARCHAR(20) DEFAULT 'PENDING_REVIEW',
  confirmation_summary_msg_id UUID        REFERENCES chat_messages(id),
  customer_confirmed_msg_id   UUID        REFERENCES chat_messages(id),
  customer_confirmed_at       TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_orders_user
  ON chat_orders (session_id);

CREATE INDEX IF NOT EXISTS idx_chat_orders_status
  ON chat_orders (status) WHERE status = 'PENDING_REVIEW';

-- Phase 7: Message Intelligence — thêm columns vào bảng đã có
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS identified_product JSONB,
  ADD COLUMN IF NOT EXISTS customer_mood      VARCHAR(20) DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS clarify_count      INTEGER     DEFAULT 0;

ALTER TABLE ai_page_settings
  ADD COLUMN IF NOT EXISTS reply_style TEXT;
