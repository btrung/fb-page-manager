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
closing_turns         INT       -- counter State 3 (max 5)
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

**State 2 — variants:**
- Worker tính `missing = required_variants - keys(current_variants)` → pass `missing_variants` + `is_complete`
- LLM nhận → hỏi đúng `missing[0]`, không hỏi lại cái đã có
- Worker set `variant_confirmed` khi `is_complete && confirmed_variants`

**State 3 — thông tin giao hàng:**
- Worker tính `missing_fields` từ profile hiện tại (validate: phone regex, name≥2, addr≥10)
- Pass `missing_fields` + `all_fields_valid` cho LLM
- LLM nhận → hỏi đúng field thiếu, không hỏi lại cái đã valid
- Đủ 3 trường → worker gửi summary (chưa tạo đơn)
- Khách confirm → worker tạo đơn với data cuối cùng

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
| `Logic-Feature.md/CUSTOMER_INFO_PROCESS.md` | Chi tiết State 3 |
| `Logic-Feature.md/msg_intel_update.md` | Ý tưởng nâng cấp sales script |
| `backend/workers/chatWorker.js` | AI pipeline chính — 4 states |
| `backend/db/chatDB.js` | DB layer cho chat |
| `backend/queues/chatQueue.js` | BullMQ queue, delay 7s |
| `ai-service/app/routers/chat.py` | AI endpoints |
| `ai-service/app/services/chat_llm_service.py` | LLM prompts + functions |
| `frontend/src/pages/ChatPage.jsx` | UI chat 3 cột |
| `frontend/src/components/chat/ChatView.jsx` | Thread tin nhắn |
| `frontend/src/components/chat/CustomerPanel.jsx` | Panel phải — info + đơn |

---

## ⚠️ VẤN ĐỀ ĐANG CẦN GIẢI QUYẾT (2026-04-24)

### Root cause đã xác định
Kiến trúc hiện tại dùng "worker tính trước → LLM nhận cứng" có **timing bug**:

```
Turn N: khách nói "xanh lá"
  Worker đọc DB: current_variants = {size: M}  (chưa có màu)
  Worker tính:   missing = ["màu"]
  Pass LLM:      missing_variants = ["màu"], is_complete = false
  LLM extract:   {màu: xanh lá}  ← đúng
  LLM reply:     "Anh/chị muốn size nào?"  ← SAI (vì is_complete=false, rule bảo hỏi missing[0])
  DB save:       {size:M, màu:xanh lá}  ← saved đúng

Turn N+1: DB đã có đủ → worker thấy missing=[] → OK
→ Mất 1 turn vô ích, UX kém
```

**Vấn đề thứ 2:** Khi khách "đổi địa chỉ" mà profile đã đầy đủ → `all_fields_valid=true` → LLM gửi summary lại thay vì hỏi địa chỉ mới.

### Giải pháp đã đồng ý
**Quay về LLM quyết định** — bỏ `missing_variants`/`is_complete`/`missing_fields`/`all_fields_valid` khỏi worker. LLM nhận đủ context và tự quyết:

```
Input cho /consult (State 2):
  - latest_message (hoặc combined)
  - current_variants  ← LLM tự biết cái nào đã có
  - required_variants ← LLM tự biết cần hỏi gì
  - conversation_history (6 tin)
  - product info + niche

Input cho /consult-state3 (State 3):
  - latest_message
  - existing_profile  ← LLM tự biết cái nào valid
  - product + variants
```

### Nhiệm vụ cụ thể khi quay lại

**Bước 1 — Đơn giản hóa worker:**
- Bỏ `missing_variants`, `is_complete` khỏi consult State 2 call
- Bỏ `missing_fields`, `all_fields_valid` khỏi consult-state3 call
- Worker chỉ dùng output của LLM để route (confirmed_variants, exit, new_product_hint, order_confirmed)

**Bước 2 — Viết lại prompt /consult (State 2) chất lượng cao:**
- Pass `current_variants` + `required_variants` rõ ràng
- Rule: "Đọc current_variants. Nếu field đã có → KHÔNG hỏi lại. Hỏi field còn thiếu."
- Rule: "Khi current_variants đủ required_variants → tóm tắt + hỏi xác nhận"
- Rule: "Chỉ dùng giá trị variant từ post content, không bịa"
- Giữ nguyên: warmup/closing modes, handling complaints, persuasion

**Bước 3 — Viết lại prompt /consult-state3 (State 3) chất lượng cao:**
- Pass `existing_profile` đầy đủ
- Rule: "Đọc existing_profile. Extract từ tin nhắn. Hỏi field còn thiếu/invalid."
- Rule: "Nếu khách muốn đổi thứ gì → hỏi thứ đó, dù profile đã đầy đủ"
- Rule: "Khi đủ 3 field valid → tóm tắt + hỏi confirm"
- Giữ nguyên: cho đổi variants, gates (exit/new_product_hint)

**Bước 4 — Test:**
- Test State 2: không hỏi lại variant đã có, confirmed_variants set đúng
- Test State 3: đổi địa chỉ được, tạo đơn với data cuối cùng

**Bước 5 — Sau khi ổn:**
- Commit toàn bộ Phase 7+8
- Tích hợp niche detection vào crawl flow
- Cron auto-crawl

---

## Pending dài hạn

- Cron auto-crawl bài đăng mới định kỳ
- Niche detection chạy tự động sau crawl
- Merge về main
