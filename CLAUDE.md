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
docker compose restart worker   # restart worker riêng
docker compose restart backend
docker compose restart frontend
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
Crawl bài đăng Facebook → LLM extract → embed vào Qdrant. Không còn product layer, dùng thẳng posts + Qdrant.

### 2. AI Chat (`/chat` — ChatPage)
AI tự động chat + chốt đơn qua Facebook Messenger. **Đây là tính năng đang phát triển.**

### 3. Cài đặt (`/settings` — SettingsPage)
Toggle AI per fanpage + active hours.

---

## Branch hiện tại: `chat-interface`

### Đã commit
- Phase 1–7: toàn bộ chat feature (DB, webhook, worker, UI)
- `6e8f59d` — style frontend: ConversationList `w-80`, CustomerPanel `w-96`, bubble `text-base`

### Chưa commit (uncommitted changes)
Các file sau chứa logic Phase 7 (State Machine) + fix State 2:
- `backend/workers/chatWorker.js` — **file quan trọng nhất**
- `backend/db/chatDB.js`
- `backend/db/schema.sql`
- `backend/queues/chatQueue.js`
- `backend/routes/chat.js`
- `ai-service/app/routers/chat.py`
- `ai-service/app/services/chat_llm_service.py`

**Việc tiếp theo: commit backend Phase 7 sau khi test xong.**

---

## AI Chat — State Machine (chatWorker.js)

Logic xử lý tin nhắn theo 3 state. Đọc `CHAT_FEATURE.md` để hiểu toàn bộ design.

```
STATE 0 — Chưa có SP (max 5 lượt)
  has_product_signal → search Qdrant → lưu SP → State 1
  joking → probe
  other → hỏi tên/ảnh SP

STATE 1 — Có SP, chưa confirm (max 8 lượt)
  confirmed → productConfirmed=true → State 2
  denied + SP mới → tìm SP mới
  denied + không SP → về State 0

STATE 2 — SP đã khoá, kịch bản chốt (max 5 lượt)
  Gate 1: product_feedback=denied → về State 1
  Gate 2: confirming + order tồn tại → đóng đơn → HUMAN mode
  Default: thu thập tên/SĐT/địa chỉ
    → Có profile cũ + chưa hỏi → hiện info cũ, hỏi xác nhận (profile_confirm_asked)
    → Extract từ tin nhắn mới nhất → merge → validate → tạo đơn hoặc hỏi thiếu
```

Đọc `CUSTOMER_INFO_PROCESS.md` để hiểu chi tiết State 2.

---

## DB Schema quan trọng (chat)

```
chat_sessions        — trạng thái từng cuộc hội thoại
  identified_product   JSONB     — SP đang hỏi
  product_confirmed    BOOLEAN   — khách đã confirm SP chưa
  no_product_turns     INT       — đếm lượt State 0 (max 5)
  unconfirmed_turns    INT       — đếm lượt State 1 (max 8)
  closing_turns        INT       — đếm lượt State 2 (max 5)
  profile_confirm_asked BOOLEAN  — đã hỏi xác nhận thông tin cũ chưa
  ai_mode              VARCHAR   — 'AI' | 'HUMAN'

chat_messages        — lịch sử tin nhắn
chat_orders          — đơn hàng AI chốt (status: PENDING_REVIEW | CONFIRMED | CANCELLED)
customer_profiles    — hồ sơ khách theo PSID (tái dùng khi quay lại)
ai_page_settings     — cấu hình AI per fanpage
session_tags         — tag thủ công
```

Migration đã chạy trực tiếp trên DB (không cần chạy lại):
```sql
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS profile_confirm_asked BOOLEAN DEFAULT false;
```

---

## Lệnh hay dùng khi test

```bash
# Xoá hết session để test lại từ đầu
docker compose exec backend node -e "
const { pool } = require('./db/migrate');
pool.query('DELETE FROM chat_sessions').then(r => { console.log('Deleted', r.rowCount); process.exit(0); });
"

# Xem log worker real-time
docker compose logs -f worker
```

---

## Files quan trọng cần biết

| File | Vai trò |
|---|---|
| `CHAT_FEATURE.md` | Design doc đầy đủ tính năng chat |
| `CUSTOMER_INFO_PROCESS.md` | Logic State 2 — thu thập thông tin khách |
| `backend/workers/chatWorker.js` | AI pipeline chính |
| `backend/db/chatDB.js` | DB layer cho chat |
| `frontend/src/pages/ChatPage.jsx` | UI chat 3 cột |
| `frontend/src/components/chat/ChatView.jsx` | Cột giữa — thread tin nhắn |
| `frontend/src/components/chat/CustomerPanel.jsx` | Cột phải — thông tin khách + đơn hàng |
| `ai-service/app/routers/chat.py` | AI endpoints cho chat |
| `ai-service/app/services/chat_llm_service.py` | LLM functions |

---

## Pending sau khi test xong

1. Commit backend Phase 7 (các file chưa commit ở trên)
2. Cron auto-crawl bài đăng mới (dùng `node-cron`)
