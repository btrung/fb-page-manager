# Livestream Reply Feature

Branch: `livestream-reply` (tách từ `chat-interface`)

---

## Mục tiêu

Khi fanpage đang livestream → AI tự động monitor comment → phát hiện người có intent mua → reply công khai trên comment kèm link nhắn tin vào fanpage → khi họ inbox, AI chat tự động chốt đơn (dùng lại engine chat hiện tại).

---

## Facebook có cho phép không?

**Có.** API hỗ trợ đầy đủ:
- Đọc comment live qua webhook field `feed` (comment events on live post)
- Reply comment công khai: `POST /{comment-id}/comments`
- Không vi phạm policy — đây là public reply, không phải spam DM

**Permissions cần thêm:** `pages_manage_posts` (có thể đã có), `pages_read_user_content`

---

## Kiến trúc tổng thể

```
Facebook Live comment
    ↓
Webhook POST /webhook/live  (giống /webhook/chat)
    ↓
liveQueue (BullMQ, delay 2-3s)
    ↓
liveWorker.js
  1. Check page có bật livestream_ai_enabled không
  2. LLM classify comment → buying intent?
  3. Nếu có → POST reply lên comment (kèm Messenger Ref URL)
  4. Lưu DB live_comment_replies (tránh reply 2 lần)
  ↓
Khách tap link → inbox fanpage
    ↓
chatWorker.js (hiện tại) nhận referral.ref
  → auto-tag session "nguồn: livestream"
  → pre-fill product_hint từ ref → skip State 0
```

---

## Messenger Ref URL — cách track Livestream → DM

**Vấn đề:** Facebook User ID (comment) ≠ PSID (Messenger) → không link trực tiếp được.

**Giải pháp:** Dùng `m.me` link có `ref` parameter.

```
AI reply comment:
"Anh/chị nhắn tin qua link này để em tư vấn ngay nhé!
👉 m.me/TenPage?ref=live_AoThunDo"
```

Khi khách tap link → mở Messenger → webhook gửi về:
```json
{ "referral": { "ref": "live_AoThunDo", "source": "SHORTLINK" } }
```

chatWorker nhận `referral.ref`:
- Auto-tag session: `nguồn: livestream`
- Extract product hint từ ref → nhảy thẳng State 1 (bỏ qua State 0 tìm SP)
- Khách không cần nhắn lại tên SP

**Format ref:** `live_{product_hint_slug}` — ví dụ `live_ao-thun-do`, `live_vay-hoa`

---

## DB thay đổi

### Bảng mới: `live_comment_replies`
```sql
CREATE TABLE live_comment_replies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id        VARCHAR UNIQUE NOT NULL,  -- FB comment ID
  live_video_id     VARCHAR NOT NULL,
  page_id           VARCHAR NOT NULL,
  commenter_name    VARCHAR,
  content           TEXT,            -- nội dung comment gốc
  product_hint      VARCHAR,         -- SP detect được từ comment
  ref_slug          VARCHAR,         -- slug dùng trong ref URL
  replied_at        TIMESTAMP DEFAULT NOW()
);
```

### Thêm vào `ai_page_settings`
```sql
ALTER TABLE ai_page_settings
  ADD COLUMN IF NOT EXISTS livestream_ai_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS livestream_cta TEXT;  -- câu reply tùy chỉnh
```

---

## Backend — Files cần tạo/sửa

### Mới: `backend/queues/liveQueue.js`
- BullMQ queue "live", delay 2s

### Mới: `backend/workers/liveWorker.js`
```
processliveJob:
1. Lấy comment từ job data
2. Check livestream_ai_enabled cho page
3. Gọi LLM /classify-intent (reuse)
4. Nếu buying intent:
   a. Extract product_hint từ comment (LLM hoặc keyword)
   b. Tạo ref_slug từ product_hint
   c. Build reply text từ livestream_cta + m.me link
   d. POST lên Facebook comment API
   e. Lưu vào live_comment_replies
```

### Sửa: `backend/routes/sync.js` hoặc route mới `/webhook/live`
- Nhận comment events từ Facebook webhook
- Filter: chỉ xử lý comment trên live video posts
- Đẩy vào liveQueue

### Sửa: `backend/workers/chatWorker.js`
- Khi tạo session mới, check xem message event có `referral.ref` không
- Nếu ref bắt đầu bằng `live_`:
  - Tag session "nguồn: livestream"
  - Set `identifiedProduct` từ product_hint trong ref
  - Set intent "Muốn Mua"
  - Bỏ qua State 0, vào State 1 ngay

### Sửa: `backend/routes/chat.js`
- API cho livestream tab: lấy danh sách comment đã reply, stats

---

## AI Service — Endpoints cần thêm

Reuse `/chat/classify-intent` (đã có) — không cần thêm endpoint mới.

Cân nhắc thêm endpoint nhẹ để extract product hint từ comment nếu classify không đủ.

---

## UI — Livestream Tab

**Header mới trong Navbar:** `[🧠 AI Học] [💬 Hội Thoại] [📺 Livestream] [⚙️ Cài đặt]`
Route: `/livestream`

### Layout — 3 cột cố định (kiểu email client)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🧠 AI Học    💬 Hội Thoại    📺 Livestream    ⚙️ Cài đặt                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  📺 Livestream          [Page: Cửa hàng ABC ▾]                              │
├──────────────────┬──────────────────────────────┬───────────────────────────┤
│  PHIÊN LIVE      │  COMMENTS                    │  DETAIL                   │
│  (20%)           │  (45%)                       │  (35%)                    │
│                  │                              │                           │
│ 🔴 Live 16/5    │  [Tất cả 47][🛍️ Intent 12]  │  👤 Nguyễn Văn A          │
│  💬47 🛍️12 📥3  │              [📥 Inbox 3]    │  2 phút trước             │
│                  │  ──────────────────────────  │                           │
│ ✅ Live 14/5    │  👤 Nguyễn Văn A  •  2m      │  "áo đỏ size M giá bao    │
│  💬23 🛍️8  📥1  │  "áo đỏ size M giá bao..."  │   nhiêu vậy shop ơi"      │
│                  │  ┌─ AI reply ──────────────┐ │                           │
│ ✅ Live 12/5    │  │ Chị nhắn vào page để em │ │  ── AI Reply ──────────── │
│  💬31 🛍️5  📥2  │  │ tư vấn ngay nhé! 👉    │ │  "Chị nhắn vào page để   │
│                  │  │ m.me/page?ref=live_ao.. │ │   em tư vấn ngay nhé!    │
│                  │  └─────────────────────────┘ │   👉 m.me/page?ref=       │
│                  │  ✅ Đã reply  •  📥 Đã inbox │       live_ao-thun-do"    │
│                  │  ──────────────────────────  │                           │
│                  │  👤 Trần Thị B  •  5m        │  ── Hành trình ─────────  │
│                  │  "shop còn hàng k, muốn..."  │  📥 Đã vào inbox          │
│                  │  ┌─ AI reply ──────────────┐ │  💬 Đang chat  (3 tin)    │
│                  │  │ Chị nhắn vào page để em │ │  🛒 Chưa đặt đơn          │
│                  │  │ tư vấn ngay nhé! 👉    │ │                           │
│                  │  │ m.me/page?ref=live_vay. │ │  [💬 Xem hội thoại →]    │
│                  │  └─────────────────────────┘ │                           │
│                  │  ✅ Đã reply  •  🚫 Chưa inbox│                          │
│                  │  ──────────────────────────  │                           │
│                  │  👤 Lê Văn C  •  8m          │                           │
│                  │  "bao nhiêu tiền 1 cái vậy" │                           │
│                  │  ┌─ AI reply ──────────────┐ │                           │
│                  │  │ Anh nhắn vào page để em │ │                           │
│                  │  │ báo giá nhé! 👉 m.me/.. │ │                           │
│                  │  └─────────────────────────┘ │                           │
│                  │  ✅ Đã reply  •  🚫 Chưa inbox│                          │
│  ─────────────── │                              │                           │
│  [⚙️ Cài đặt AI] │                              │                           │
└──────────────────┴──────────────────────────────┴───────────────────────────┘
```

### Cột trái — Phiên Live
- Webhook tự tạo session khi nhận comment đầu tiên → tự xuất hiện, không cần nhập tay
- Badge mỗi session: tổng comment `💬` / có intent `🛍️` / đã vào inbox `📥`
- `🔴` = đang live, `✅` = live đã kết thúc
- Nút `⚙️ Cài đặt AI` ở dưới cột → mở modal

### Cột giữa — Comment Feed
- 3 tab filter: `Tất cả` / `🛍️ Intent mua` / `📥 Inbox`
- **Filter `🛍️ Intent mua` là chính** — xem nhanh toàn bộ comment có intent + AI đã rep gì
- AI reply **luôn mở full** khi ở filter Intent / Inbox, thu gọn 1 dòng ở filter Tất cả
- Status mỗi card: `✅ Đã reply` + `📥 Đã inbox` / `🚫 Chưa inbox` / `⏳ Đang xử lý`

### Hành vi filter chi tiết

| Filter | Comment hiển thị | AI reply |
|---|---|---|
| `Tất cả` | Mọi comment | Thu gọn 1 dòng preview |
| `🛍️ Intent mua` | Chỉ có buying intent | **Mở full** để review nhanh |
| `📥 Inbox` | Chỉ đã convert sang DM | Mở full + link hội thoại |

### Cột phải — Detail (khi click 1 comment)
- Comment gốc đầy đủ
- AI reply full text
- **Hành trình**: `📥 Đã inbox` → `💬 Đang chat (N tin)` → `🛒 Đặt đơn / Chưa`
- Button `[💬 Xem hội thoại →]` → chuyển sang ChatPage, filter sẵn session đó

### Modal Cài đặt AI
```
┌─────────────────────────────────────┐
│  ⚙️ Cài đặt Livestream AI    [✕]   │
│                                     │
│  AI Monitor comments                │
│  ○────────────────● Bật             │
│                                     │
│  Câu reply mẫu:                     │
│  ┌─────────────────────────────┐    │
│  │ {tên} nhắn vào page để em  │    │
│  │ tư vấn ngay nhé! 👉 {link} │    │
│  └─────────────────────────────┘    │
│  * {tên} = tên khách, {link} = m.me │
│                                     │
│              [Lưu]                  │
└─────────────────────────────────────┘
```

### Frontend files cần tạo
- `frontend/src/pages/LivestreamPage.jsx` — layout 3 cột chính
- `frontend/src/components/livestream/LiveSessionList.jsx` — cột trái, danh sách phiên live
- `frontend/src/components/livestream/CommentFeed.jsx` — cột giữa, comment + filter tabs
- `frontend/src/components/livestream/CommentDetail.jsx` — cột phải, detail + hành trình
- `frontend/src/components/livestream/LiveSettingsModal.jsx` — modal cài đặt AI

---

## Thứ tự implement (khi quay lại)

```
1. DB migration — thêm live_comment_replies + 2 columns ai_page_settings
2. liveQueue.js + liveWorker.js (classify + reply)
3. Webhook route nhận live comment events
4. Test webhook với Facebook Live thật
5. chatWorker.js — handle referral.ref từ m.me link
6. API endpoints cho UI (stats, comment list)
7. Frontend: LivestreamPage + CommentFeed + LiveSettings
8. Test flow đầy đủ: comment → AI reply → khách inbox → chốt đơn
```

---

## Git branch strategy

```
main              ──── stable (chưa merge)
chat-interface    ──────────────── đang fix + user test (deploy từ đây)
                                        \
livestream-reply  ────────────────────── đang dev (branch này)
```

- Fix bug chat → commit vào `chat-interface`
- Fix bug livestream → commit vào `livestream-reply`
- Sync định kỳ: `git merge chat-interface` vào `livestream-reply` khi chat có fix lớn
- Khi cả 2 ổn → merge `livestream-reply` vào `chat-interface` → merge vào `main`

---

## Notes để nhớ

- `m.me/TenPage` — lấy page username từ Facebook Graph API: `GET /me?fields=username`
- Page username có thể null (page mới) → fallback dùng `m.me/{page_id}`
- Rate limit reply comment: không có hard limit nhưng tránh reply quá nhanh liên tiếp
- 1 comment chỉ reply 1 lần (check `live_comment_replies` trước khi reply)
