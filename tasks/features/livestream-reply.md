# Livestream Reply

## Làm gì
AI monitor comment khi fanpage đang live → phát hiện buying intent → reply công khai kèm m.me link → khi khách inbox, chat engine hiện tại tự chốt đơn (skip State 0).

## Flow hiện tại

*Feature chưa code. Đây là design được duyệt.*

```
Facebook Live comment
    ↓
Webhook POST /webhook/live
    ↓
liveQueue (BullMQ, delay 2-3s)
    ↓
liveWorker.js
  1. Check livestream_ai_enabled cho page
  2. LLM classify → buying intent?
  3. Có intent → extract product_hint → tạo ref_slug → build reply + m.me link
  4. POST reply lên Facebook comment API
  5. Lưu live_comment_replies (dedup: 1 comment chỉ reply 1 lần)
    ↓
Khách tap link → inbox fanpage
    ↓
chatWorker.js nhận referral.ref (bắt đầu "live_")
  → auto-tag session "nguồn: livestream"
  → set identified_product từ product_hint trong ref
  → set intent "Muốn Mua"
  → skip State 0, vào State 1
```

### Messenger Ref URL
```
AI reply comment:
"Chị nhắn vào page để em tư vấn ngay nhé! 👉 m.me/TenPage?ref=live_ao-thun-do"

Khi khách tap → webhook gửi về:
{ "referral": { "ref": "live_ao-thun-do", "source": "SHORTLINK" } }
```
Format ref: `live_{product_hint_slug}` — ví dụ `live_ao-thun-do`, `live_vay-hoa`

## UI Design

### Layout — 3 cột cố định (kiểu email client)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  🧠 AI Học    💬 Hội Thoại    📺 Livestream    ⚙️ Cài đặt               │
├─────────────────────────────────────────────────────────────────────────┤
│  📺 Livestream                    [Page: Cửa hàng ABC ▾]                │
├──────────────────┬──────────────────────────────┬───────────────────────┤
│  PHIÊN LIVE      │  COMMENTS                    │  DETAIL               │
│  (20%)           │  (45%)                       │  (35%)                │
└──────────────────┴──────────────────────────────┴───────────────────────┘
```

### Cột trái — Phiên Live
```
┌──────────────────┐
│ 🔴 Live 16/5     │  ← đang live
│  💬47  🛍️12  📥3 │  ← total / intent / inbox
├──────────────────┤
│ ✅ Live 14/5     │  ← đã kết thúc
│  💬23  🛍️8   📥1 │
├──────────────────┤
│ [⚙️ Cài đặt AI]  │  ← mở modal
└──────────────────┘
```
- Session tự tạo khi nhận comment đầu tiên
- `🔴` đang live, `✅` đã kết thúc
- Badge: tổng comment / có intent / đã inbox

### Cột giữa — Comment Feed

**Filter tabs** (default: 🛍️ Intent):
```
[Tất cả 47]  [🛍️ Intent 12]  [📥 Đã inbox 3]  [⚠️ Lỗi]
```
- `⚠️ Lỗi` chỉ hiện khi có comment AI detect được nhưng reply thất bại

**Stats bar** (gắn với session đang chọn):
```
💬 47 comment  │  🛍️ 12 intent (26%)  │  ✅ 11/12 đã reply  │  📥 3 inbox  │  🛒 1 đơn
```

**Comment card:**
```
👤 Nguyễn Văn A  •  2m
"áo đỏ size M giá bao nhiêu vậy shop ơi"
┌─ AI reply ──────────────────────────┐
│ Chị nhắn vào page để em tư vấn nhé! │
│ 👉 m.me/page?ref=live_ao-do         │
└─────────────────────────────────────┘
✅ Đã reply  •  📥 Đã inbox
```

**Hành vi filter:**
| Filter | Comment hiển thị | AI reply |
|---|---|---|
| Tất cả | Mọi comment | Thu gọn 1 dòng |
| 🛍️ Intent | Chỉ buying intent | Mở full |
| 📥 Đã inbox | Chỉ đã vào DM | Mở full + link hội thoại |
| ⚠️ Lỗi | AI reply thất bại | Mở full + nút retry |

### Cột phải — Detail (khi click comment)
```
👤 Nguyễn Văn A  •  2 phút trước

"áo đỏ size M giá bao nhiêu vậy shop ơi"

── AI Reply ─────────────────────────────
"Chị nhắn vào page để em tư vấn ngay nhé!
 👉 m.me/page?ref=live_ao-do"

── Hành trình ───────────────────────────
📥 Đã vào inbox
💬 Đang chat  (3 tin)
🛒 Chưa đặt đơn

[💬 Xem hội thoại →]    ← link sang ChatPage
```

### Modal Cài đặt AI
```
┌──────────────────────────────────────┐
│  ⚙️ Cài đặt Livestream AI     [✕]   │
├──────────────────────────────────────┤
│  AI Monitor comments                 │
│  ○──────────────● Bật                │
│                                      │
│  Câu reply mẫu:                      │
│  ┌──────────────────────────────┐    │
│  │ {tên} nhắn vào page để em   │    │
│  │ tư vấn ngay nhé! 👉 {link}  │    │
│  └──────────────────────────────┘    │
│  * {tên} = tên khách  {link} = m.me  │
│                                      │
│                    [Lưu]             │
└──────────────────────────────────────┘
```

### Frontend files cần tạo
- `frontend/src/pages/LivestreamPage.jsx` — layout 3 cột + page selector
- `frontend/src/components/livestream/LiveSessionList.jsx` — cột trái
- `frontend/src/components/livestream/CommentFeed.jsx` — cột giữa + filter + stats bar
- `frontend/src/components/livestream/CommentDetail.jsx` — cột phải + hành trình
- `frontend/src/components/livestream/LiveSettingsModal.jsx` — modal cài đặt AI
- `Navbar.jsx` — thêm tab 📺 Livestream
- `App.jsx` — thêm route `/livestream`

---

## Kế hoạch triển khai

- [ ] Phase 1 — DB migration: `live_comment_replies` + `livestream_ai_enabled` + `livestream_cta`
- [ ] Phase 2 — `liveQueue.js` + `liveWorker.js`: classify comment → reply kèm m.me Ref URL
- [ ] Phase 3 — Webhook route `/webhook/live` nhận comment events từ Facebook
- [ ] Phase 4 — `chatWorker.js`: handle `referral.ref` → auto-tag + skip State 0
- [ ] Phase 5 — API endpoints: stats + comment list cho UI
- [ ] Phase 6 — Frontend: LivestreamPage + 4 components
- [ ] Phase 7 — Test end-to-end: comment → AI reply → khách inbox → chốt đơn

## Schema / Config

### Bảng mới: live_comment_replies
```sql
CREATE TABLE live_comment_replies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id     VARCHAR UNIQUE NOT NULL,  -- FB comment ID (dùng để dedup)
  live_video_id  VARCHAR NOT NULL,
  page_id        VARCHAR NOT NULL,
  commenter_name VARCHAR,
  content        TEXT,        -- comment gốc
  product_hint   VARCHAR,     -- SP detect được
  ref_slug       VARCHAR,     -- slug dùng trong m.me link
  replied_at     TIMESTAMP DEFAULT NOW()
);
```

### ai_page_settings — thêm 2 columns
```sql
ALTER TABLE ai_page_settings
  ADD COLUMN IF NOT EXISTS livestream_ai_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS livestream_cta TEXT;  -- câu reply tùy chỉnh, hỗ trợ {tên} và {link}
```

### Facebook Permissions cần thêm
- `pages_manage_posts` — để reply comment
- `pages_read_user_content` — để đọc comment

### AI Endpoint
Reuse `/chat/classify-intent` — không cần endpoint mới.

## Edge cases

- 1 comment chỉ reply 1 lần — check `live_comment_replies.comment_id` trước khi reply
- Page username có thể null → fallback `m.me/{page_id}` thay vì `m.me/{username}`
- Rate limit comment reply — tránh reply liên tiếp quá nhanh (delay queue đã giảm thiểu)
- `referral.ref` extract: `live_ao-thun-do` → slug → search Qdrant để set identified_product
- chatWorker nhận ref nhưng product không tìm thấy trong Qdrant → về State 0 bình thường

## Nâng cấp tiếp theo

- Auto-detect product chi tiết hơn từ nội dung comment (LLM extract, không chỉ slug)
- Stats realtime per phiên live: comment → intent → inbox → đặt đơn
- Multi-live support: nhiều phiên live song song trên cùng fanpage
