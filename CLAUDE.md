# CLAUDE.md — FB Page Manager

Đọc file này trước khi làm bất kỳ việc gì. Đây là context đầy đủ của dự án.

---

## Stack

| Layer | Tech | Port |
|---|---|---|
| Frontend | React + Vite + Tailwind | 5173 |
| Backend | Node.js / Express | 5000 |
| AI Service | Python FastAPI | 8000 |
| DB | PostgreSQL (pgvector) | 5432 |
| Queue | Redis + BullMQ | 6379 |
| Vector DB | Qdrant | 6333 |

Chạy bằng Docker Compose. Worker là **container riêng** (`fb-page-manager-worker-1`), không phải backend.

```bash
docker compose up -d
docker compose restart worker           # restart worker riêng
docker compose restart backend
docker compose up -d --build ai-service # rebuild khi đổi Python code
docker compose logs -f worker           # xem log realtime
```

---

## LLM & Embedding

- **LLM:** Groq (`llama-3.3-70b-versatile`) — key: `GROQ_API_KEY`
- **Text embed:** paraphrase-multilingual-MiniLM-L12-v2 (384d, local CPU)
- **Image embed:** CLIP ViT-B/32 (512d, local CPU)
- **Qdrant collections:** `post_embeddings` (384d text) + `product_images` (512d image)

---

## Tính năng chính

### 1. AI Học Fanpage (`/` — IntelligencePage)
Crawl bài đăng Facebook → LLM extract → embed vào Qdrant.

### 2. AI Chat (`/chat` — ChatPage)
AI tự động chat + chốt đơn qua Facebook Messenger. **Đang phát triển tích cực.**

### 3. Cài đặt (`/settings` — SettingsPage)
Toggle AI per fanpage + active hours + reply_style.

---

## Branch hiện tại: `chat-interface`

### Trạng thái git
Có nhiều uncommitted changes — **CHƯA COMMIT** toàn bộ Phase 7 + Phase 8 (state machine mới).
Cần test đủ rồi mới commit.

### Files chưa commit quan trọng
- `backend/workers/chatWorker.js` — **core logic, thay đổi nhiều nhất**
- `backend/db/chatDB.js`
- `backend/db/schema.sql`
- `backend/queues/chatQueue.js`
- `ai-service/app/routers/chat.py`
- `ai-service/app/services/chat_llm_service.py`
- `Logic-Feature.md/CHAT_FEATURE.md`

---

## AI Chat — State Machine 4 States

**Đọc `Logic-Feature.md/CHAT_FEATURE.md` để hiểu toàn bộ design chi tiết.**

```
STATE 0 — Tìm SP (max 5 lượt)
  → search Qdrant, confidence threshold 0.45
  → joking → probe, other → hỏi SP

STATE 1 — Xác nhận SP (max 8 lượt)
  → confirmed → gửi closing script + vào State 2
  → denied → về State 0

STATE 2 — Tư vấn + Biến thể (max 10 lượt)
  Worker tính: missing = required_variants - keys(current_variants)
               is_complete = missing.length === 0
  LLM (/consult): nhận missing_variants + is_complete + history 6 tin
    → is_complete=false: tư vấn/thuyết phục + hỏi missing[0]
    → is_complete=true: tóm tắt variants + hỏi xác nhận
  Routing: new_product_hint→S0, exit→HUMAN, is_complete+confirmed→S3

STATE 3 — Thông tin giao hàng (max 5 lượt)
  LLM (/consult-state3): extract name/phone/address + cho đổi variants
  Nguyên tắc: KHÔNG tạo đơn cho đến khi khách confirm tóm tắt
  → Đủ 3 trường → gửi summary (chưa tạo đơn)
  → Khách confirm → createOrder với data cuối cùng → HUMAN
```

---

## Kiến trúc LLM Endpoints (ai-service)

| Endpoint | Dùng khi |
|---|---|
| `/chat/classify-intent` | Mọi tin nhắn — phân loại intent |
| `/chat/generate-reply` | State 0 — tìm SP qua Qdrant |
| `/chat/generate-product-confirm` | State 0/1 — hỏi xác nhận SP |
| `/chat/generate-closing` | State 1→2 — opening message hỏi variant đầu |
| `/chat/detect-variants` | Khi tìm được SP — xác định variants cần hỏi |
| `/chat/consult` | State 2 — tư vấn + fill variants |
| `/chat/consult-state3` | State 3 — thu thập thông tin giao hàng |
| `/chat/generate-confirmation` | State 3 — tạo summary xác nhận đơn |
| `/chat/extract-order-fields` | State 3 — extract name/phone/address |
| `/chat/detect-niche` | Sau crawl — xác định ngách fanpage |
| `/chat/generate-probe` | State 0 — redirect khách đùa |

---

## DB Schema (chat_sessions — các fields quan trọng)

```sql
identified_product    JSONB     -- {name, query, price, image_url, content, required_variants}
product_confirmed     BOOLEAN   -- State 1 confirmed
product_variants      JSONB     -- variants đang thu thập {size:M, màu:xanh}
variant_confirmed     BOOLEAN   -- State 2 xong → State 3
no_product_turns      INT       -- counter State 0 (max 5)
unconfirmed_turns     INT       -- counter State 1 (max 8)
consulting_turns      INT       -- counter State 2 (max 10)
consulting_turns      INT       -- counter State 2 (max 10)
closing_turns         INT       -- counter State 3 (max 10)
candidate_products    JSONB     -- SP candidates khi search ra nhiều kết quả (xóa sau khi chọn)
ai_mode               VARCHAR   -- 'AI' | 'HUMAN'
```

Migrations đã chạy trực tiếp trên DB đang chạy:
```sql
-- Phase 7+8 (đã chạy, không cần chạy lại)
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS product_variants JSONB DEFAULT '{}';
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS variant_confirmed BOOLEAN DEFAULT false;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS consulting_turns INTEGER DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS profile_confirm_asked BOOLEAN DEFAULT false;
ALTER TABLE chat_orders ADD COLUMN IF NOT EXISTS product_variants JSONB;
ALTER TABLE ai_page_settings ADD COLUMN IF NOT EXISTS niche VARCHAR(100);
ALTER TABLE ai_page_settings ADD COLUMN IF NOT EXISTS reply_style TEXT;
```

---

## Thiết kế quan trọng cần hiểu

### Worker — batching & lock
- Delay **7s** trước khi xử lý → gom nhiều tin nhắn liên tiếp
- `getUnrepliedCustomerMessages` → lấy TẤT CẢ tin khách chưa được AI reply
- In-memory `_processing` Set → tránh 2 job cùng session chạy song song

### Nguyên tắc Worker vs LLM (áp dụng cả State 2 và State 3)
LLM lo: văn phong, tâm lý, warmup, extract thông tin từ tin nhắn
Worker lo: tính toán routing chính xác, không nhờ LLM

**State 0 — tìm SP (2-stage retrieval):**
- Stage 1: Qdrant vector search top 5 (threshold 0.20)
- Stage 2: LLM `/rerank-products` chọn SP phù hợp nhất từ candidates
- confidence=high → 1 SP → confirm ngay + set intent "Muốn Mua"
- confidence=medium → nhiều SP → gửi tất cả có ảnh + quick_replies hỏi chọn → lưu `candidate_products`
- confidence=low → không tìm thấy → hỏi lại
- Session idle >3 ngày → auto reset state về 0 khi khách nhắn lại

**State 2 — variants:**
- Worker tính `missing = required_variants - keys(current_variants)` → pass `missing_variants` + `is_complete`
- LLM hỏi **TẤT CẢ** missing variants trong 1 câu (không hỏi từng cái 1 lượt)
- Worker set `variant_confirmed` khi `is_complete && confirmed_variants`
- Timing bug nhỏ: worker tính missing trước khi LLM extract xong tin hiện tại → mất 1 turn. Chấp nhận.

**State 3 — thông tin giao hàng (webview form):**
- Vào State 3 → gửi webview button 1 lần (`profileConfirmAsked = false` → true)
- Khách tap button → mở form HTML trong Messenger, pre-fill profile cũ
- Form hiển thị: tên SP + giá (locked) + variants (editable) + name/phone/address
- Submit → `form.js` validate → save profile + update variants → gửi confirmation summary vào chat
- Khách nhắn "OK" → worker tạo đơn → HUMAN mode
- **Escape hatch**: nếu `product_hint` khác SP hiện tại → reset toàn bộ, về State 0

### Crawl & Embed
- `crawlWorker.js` dùng **dòng đầu tiên của post** làm `product_name` trong Qdrant (không dùng `extracted_product_name` của LLM có thể bị rút ngắn)
- Re-crawl **luôn re-embed** kể cả post đã có trong DB → Qdrant luôn sync
- LLM extraction prompt yêu cầu tên SP đầy đủ, không rút ngắn
- Nếu Qdrant bị xóa thủ công → chạy lại crawl là đủ (không cần script thủ công)

---

## Lệnh hay dùng khi test

```bash
# Xoá session test
docker compose exec backend node -e "
const { pool } = require('./db/migrate');
pool.query('DELETE FROM chat_sessions').then(r => { console.log('Deleted', r.rowCount); process.exit(0); });
"

# Xem tin nhắn session mới nhất
docker compose exec backend node -e "
const { pool } = require('./db/migrate');
pool.query(\`SELECT s.id, s.intent, s.product_confirmed, s.variant_confirmed,
  s.consulting_turns, s.identified_product->>'name' AS product, s.product_variants
  FROM chat_sessions s ORDER BY s.last_message_at DESC LIMIT 1\`).then(async r => {
  const s = r.rows[0]; console.log('SESSION:', JSON.stringify(s));
  const msgs = await pool.query(\`SELECT sender_type, content FROM chat_messages
    WHERE session_id = '\${s.id}' ORDER BY created_at ASC\`);
  msgs.rows.forEach((m,i) => console.log(i+1+'.','['+m.sender_type+']',m.content?.slice(0,200)));
  process.exit(0);
});
"
```

---

## Files quan trọng

| File | Vai trò |
|---|---|
| `Logic-Feature.md/CHAT_FEATURE.md` | Design doc đầy đủ — **đọc trước** |
| `Logic-Feature.md/msg_intel_update.md` | Ý tưởng nâng cấp sales script |
| `backend/workers/chatWorker.js` | AI pipeline chính — 4 states + rerank |
| `backend/workers/crawlWorker.js` | Crawl FB posts + embed Qdrant |
| `backend/routes/form.js` | Webview form giao hàng (State 3) |
| `backend/db/chatDB.js` | DB layer cho chat |
| `backend/queues/chatQueue.js` | BullMQ queue, delay 7s |
| `ai-service/app/routers/chat.py` | AI endpoints (bao gồm /rerank-products) |
| `ai-service/app/services/chat_llm_service.py` | LLM prompts + functions |
| `ai-service/app/services/llm_service.py` | LLM extraction cho crawl |
| `frontend/src/pages/ChatPage.jsx` | UI chat 3 cột |
| `frontend/src/components/chat/CustomerPanel.jsx` | Panel phải — info + stage badge + đơn |
| `frontend/vite.config.js` | Proxy config (forward /form, /api... sang backend) |

---

## ✅ ĐÃ HOẠT ĐỘNG (2026-05-15) — CHƯA COMMIT

Flow đầy đủ đã test xong qua Messenger thật:
`tìm SP → rerank → confirm → tư vấn + variants → webview form → confirm → tạo đơn`

### Tất cả files đã thay đổi (chưa commit)

**Backend:**
- `backend/routes/form.js` — NEW: webview form, pre-fill, submit, giá fallback từ DB
- `backend/utils/fbSendApi.js` — `sendWebviewButton`, `sendQuickReplies`
- `backend/server.js` — đăng ký `/form` route
- `backend/workers/chatWorker.js` — 2-stage search, candidates, escape hatch, session reset 3 ngày, intent auto-set
- `backend/workers/crawlWorker.js` — firstLine làm product_name, luôn re-embed, full name
- `backend/db/chatDB.js` — thêm `candidate_products`, `variantConfirmed`, `profileConfirmAsked` vào `getSessionsByUser`; `productVariants` vào `getOrderBySession`
- `backend/db/schema.sql` — thêm column `candidate_products JSONB`

**AI Service:**
- `ai-service/app/routers/chat.py` — thêm `/rerank-products`, `/consult`, `/detect-variants`, `/consult-state3`, `/detect-niche`
- `ai-service/app/services/chat_llm_service.py` — rerank_products, prompt hỏi all variants 1 lần
- `ai-service/app/services/llm_service.py` — prompt extract tên SP đầy đủ

**Frontend:**
- `frontend/vite.config.js` — thêm `/form` vào proxy
- `frontend/src/components/chat/CustomerPanel.jsx` — stage badge (5 giai đoạn), `productVariants` trong ChotTab

**Config đã có:**
- `APP_URL=https://unemerged-paroxytonic-leda.ngrok-free.dev` ✅
- Whitelist domain Messenger ✅ (set qua Graph API)
- ngrok tunnel port **5173**, `LIMIT_CLOSING = 10`

---

## Pending — việc cần làm tiếp

1. **Commit** toàn bộ: `feat: state machine 4 states + webview form + 2-stage search`
2. **Cron auto-crawl** — dùng `node-cron`, crawl định kỳ bài đăng mới
3. **Niche filter** — State 0 check product_hint có khớp ngách fanpage không (tránh tư vấn SP không bán)
4. **Niche detection** — tự động detect sau crawl, lưu vào `ai_page_settings.niche`
5. **Merge về main**
