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

### Layout
```
┌─────────────────────────────────────────────────────────┐
│ 📺 Livestream  [Page selector ▾]          🔴 ĐANG LIVE  │
├────────────────┬────────────────────────────────────────┤
│ CÀI ĐẶT (1/3) │ COMMENT FEED (2/3)                     │
│                │ [Tất cả] [🛍️ Mua hàng] [✅ Đã reply]  │
│ AI Monitor     │ ─────────────────────────────────────  │
│ [🟢 Bật]       │ 👤 Nguyễn A • 2m                      │
│                │ "áo đỏ size M giá bao nhiêu vậy shop"  │
│ CTA reply:     │ 🛍️ Buying intent • ✅ Đã reply         │
│ ┌────────────┐ │ ↳ AI: "Chị nhắn vào page để..."        │
│ │ Anh/chị   │ │                                         │
│ │ nhắn vào  │ │ 👤 Trần B • 5m                         │
│ │ page để   │ │ "shop còn hàng không"                   │
│ │ e tư vấn  │ │ 🛍️ Buying intent • ⏳ Đang xử lý       │
│ │ nhé! 👉   │ │                                         │
│ └────────────┘ │ 👤 Lê C • 8m                           │
│                │ "đẹp quá shop ơi"                      │
│ Stats hôm nay: │ ─ (không có intent mua)                │
│ 💬 47 comments │                                         │
│ 🛍️ 12 buying   │                                         │
│ ✅ 11 replied  │                                         │
│ 📥 3 đã inbox  │                                         │
└────────────────┴────────────────────────────────────────┘
```

### Frontend files cần tạo
- `frontend/src/pages/LivestreamPage.jsx` — layout chính
- `frontend/src/components/livestream/CommentFeed.jsx` — danh sách comment realtime
- `frontend/src/components/livestream/LiveSettings.jsx` — toggle + CTA textarea

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
