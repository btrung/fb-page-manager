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
