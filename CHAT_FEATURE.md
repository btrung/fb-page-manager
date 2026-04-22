# AI Chat Feature — FB Page Manager

> **Mục tiêu:** Giao diện chat đơn giản hơn Pancake, tập trung vào 1 việc duy nhất: dùng AI chốt đơn nhanh với hot customer nhắn tin vào fanpage. Không spam token LLM vào cold customer.

---

## 🧠 Triết lý thiết kế

| Pancake Chat (Ví dụ như Pancake nhưng đừng ghi trên Frontend) | Chat này |
|---|---|
| Đầy đủ tính năng CRM | Chỉ tập trung chốt đơn |
| AI optional | AI là trung tâm |
| Quản lý nhiều kênh | Chỉ FB Messenger |
| Tag thủ công | Tag tự động theo intent |
| Không có bộ lọc intent | Intent filter là cốt lõi |

**Nguyên tắc:**
- Customer nhắn vào fanpage = hot data → phải tận dụng
- Không có intent mua → AI probe 1 lần, nếu vẫn không rõ → chuyển HUMAN mode
- Đã xác định intent → truy vấn DB + Qdrant → reply ngắn, có ảnh, có hook
- AI không ăn → chuyển HUMAN mode (người vào tư vấn tiếp), không dùng cooldown thời gian
- Kịch bản AI chỉ có 1: tìm sản phẩm → đưa nhanh → hỏi thông tin → chốt đơn

---

## 🔄 Kịch bản AI (Sales Script)

```
Khách nhắn tin
    │
    ▼
[Intent Detection] ← phân tích toàn bộ session hiện tại
    │
    ├─ COLD / SPAM → thử probe 1 lần → nếu vẫn cold → chuyển HUMAN mode (không dùng cooldown thời gian)
    │
    ├─ BUYING / CONSULTING ──────────────────────────────────────────┐
    │                                                                 │
    ▼                                                                 ▼
[Tìm sản phẩm]                                              [Khách đưa tên/ảnh SP]
Qdrant semantic search                                      → tìm ngay, skip probe
(text: post_embeddings / ảnh: product_images)
    │
    ▼
[Reply lần 1: Giới thiệu SP]
- Text ngắn (≤3 dòng) + ảnh sản phẩm
- Giá + chương trình hiện tại
- Hook: "Anh/chị muốn đặt không ạ?"
    │
    ├─ Khách hỏi thêm → tiếp tục tư vấn (tối đa 3 turns)
    │
    ├─ Khách đồng ý → hỏi: Tên + SĐT + Địa chỉ → tag CLOSING
    │
    └─ Khách im lặng / không quan tâm sau 2 lần → tag HUMAN_NEEDED → dừng AI
```

---

## 🏷️ Hệ thống Tag & Điều khiển AI

### 1. Intent Tag — AI tự xác định, người dùng có thể override

Mục đích: **báo cho user biết AI đang đánh giá vị khách này như thế nào.** User có thể tự tay đổi intent để điều hướng hành vi AI (ví dụ: đổi `Khách Đùa` → `Muốn Mua` để AI bắt đầu tư vấn ngay).

| Intent | Màu | Ý nghĩa | Hành động AI |
|---|---|---|---|
| `Muốn Mua` | 🟢 Xanh | Muốn mua, hỏi giá, đặt hàng | Reply ngay, tìm SP |
| `Đang Tư Vấn` | 🔵 Xanh dương | Hỏi thông tin SP, so sánh | Tư vấn, dẫn dắt |
| `Khách Đùa` | ⚪ Xám | Hỏi linh tinh, không rõ ý định mua | Gửi probe 1 câu ngắn để kéo vào hội thoại |
| `Không Nhu Cầu` | 🔴 Đỏ | AI hỏi 3 lần không xác định được sản phẩm | Chuyển HUMAN mode — AI dừng hẳn, người tư vấn tiếp |
| `Đang Chốt` | 🟡 Vàng | Đang lấy thông tin để chốt | Hỏi tên/SĐT/địa chỉ |
| `Đã Chốt` | 🟣 Tím | Đã chốt xong | Lưu đơn, AI dừng |
| `Dừng` | 🟠 Cam | Khách dứt khoát không có nhu cầu / yêu cầu dừng | Chuyển HUMAN mode — AI dừng hẳn, người tư vấn tiếp |

**Điều kiện chuyển HUMAN mode (AI tự động chuyển, không dùng cooldown thời gian):**
- `Khách Đùa` → AI đã probe nhưng khách vẫn không xác định sản phẩm sau nhiều lần → `Không Nhu Cầu` → HUMAN mode
- `Không Nhu Cầu` → AI hỏi ≥ 3 lần mà khách cứ không tập trung xác định sản phẩm → chuyển HUMAN mode ngay
- `Dừng` → khách dứt khoát không muốn mua / yêu cầu dừng → chuyển HUMAN mode ngay
- AI reply ≥ 10 lượt mà chưa tiến triển → chuyển HUMAN mode ngay
- **Khi người bật lại AI mode trên UI → AI hoạt động bình thường ngay, không cần đợi, không cooldown**

### 2. AI Mode Tag — song song với Intent, dùng để điều khiển AI

Mỗi conversation luôn có **1 trong 2 trạng thái** này, hiển thị rõ trên UI:

| Mode | Ý nghĩa | Ai set |
|---|---|---|
| `🤖 AI Hoạt Động` | AI đang tự động tư vấn | Mặc định nếu fanpage được cấp quyền AI |
| `👤 Người Tư Vấn` | AI tạm dừng, người dùng tự chat | User toggle thủ công, hoặc khi AI tự set `Dừng` |

**Quy tắc điều khiển:**
- User toggle `AI Hoạt Động` → `Người Tư Vấn`: AI dừng ngay, không reply dù có tin nhắn mới
- User toggle `Người Tư Vấn` → `AI Hoạt Động`: AI kiểm tra ngay nếu có tin nhắn chưa trả lời → xử lý luôn, không cần đợi khách nhắn thêm
- Khi AI tự set `Dừng` (hết turn): tự động chuyển sang `Người Tư Vấn` + alert user

### 3. Tags thủ công — người dùng tự tạo, tự gắn, AI không đụng vào

Người dùng tự quản lý hoàn toàn trên UI. Có 2 mẫu gợi ý sẵn:

- `đã chốt` — đơn đã xác nhận
- `saler chị Hai` — conversation này giao cho chị Hai tự chat với khách
- `sắp gửi hàng` — user duyệt mess này AI chốt đúng, và sắp gửi hàng

---

## 🗄️ Database Schema (thêm mới)

### Bảng `chat_sessions`
```sql
id              UUID PRIMARY KEY
page_id         VARCHAR
user_id         UUID FK users
customer_psid   VARCHAR         -- FB Page-Scoped ID của khách
customer_name   VARCHAR
customer_avatar VARCHAR
intent          VARCHAR         -- Muốn Mua | Đang Tư Vấn | Khách Đùa | Không Nhu Cầu | Đang Chốt | Đã Chốt | Dừng
intent_updated_at TIMESTAMP
ai_mode         VARCHAR DEFAULT 'AI'  -- 'AI' = AI Hoạt Động | 'HUMAN' = Người Tư Vấn
cooldown_until  TIMESTAMP       -- null nếu không trong cooldown
ai_turn_count   INT DEFAULT 0   -- số lần AI đã reply trong session này
last_message_at TIMESTAMP
created_at      TIMESTAMP
```

### Bảng `chat_messages`
```sql
id                      UUID PRIMARY KEY
session_id              UUID FK chat_sessions
sender_type             VARCHAR         -- 'customer' | 'ai' | 'human'
content                 TEXT
attachments             JSONB           -- [{type: 'image', url: '...'}]
intent_at_time          VARCHAR         -- intent tại thời điểm gửi
is_confirmation_summary BOOLEAN DEFAULT false  -- tin AI tổng kết đơn hàng hỏi xác nhận
is_customer_confirmed   BOOLEAN DEFAULT false  -- tin khách reply ok/xác nhận cuối cùng
fb_message_id           VARCHAR UNIQUE
created_at              TIMESTAMP
```

### Bảng `session_tags`
```sql
id          UUID PRIMARY KEY
session_id  UUID FK chat_sessions
tag         VARCHAR
created_at  TIMESTAMP
UNIQUE(session_id, tag)
```

### Bảng `ai_page_settings` (cấu hình AI per fanpage)
```sql
id              UUID PRIMARY KEY
user_id         UUID FK users
page_id         VARCHAR
ai_enabled      BOOLEAN DEFAULT false   -- bật/tắt AI cho toàn bộ fanpage này
active_hours    JSONB                   -- null = 24/7, có giá trị = giới hạn khung giờ
                                        -- vd: {"start": "08:00", "end": "22:00", "timezone": "Asia/Ho_Chi_Minh"}
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(user_id, page_id)
```

### Bảng `chat_orders` (đơn giản, lưu khi chốt)
```sql
id                              UUID PRIMARY KEY
session_id                      UUID FK chat_sessions
customer_name                   VARCHAR
phone                           VARCHAR
address                         TEXT
product_name                    VARCHAR
note                            TEXT
status                          VARCHAR DEFAULT 'PENDING_REVIEW'  -- PENDING_REVIEW | CONFIRMED | CANCELLED
confirmation_summary_msg_id     UUID FK chat_messages  -- tin AI hỏi xác nhận
customer_confirmed_msg_id       UUID FK chat_messages  -- tin khách reply ok
customer_confirmed_at           TIMESTAMP              -- thời điểm khách xác nhận
created_at                      TIMESTAMP
```

---

## ⚙️ Luồng kỹ thuật

### 1. Nhận tin nhắn (Webhook)
```
Facebook Messenger Webhook → POST /api/chat/webhook
→ Verify token khi setup
→ Mỗi message event:
   1. Tìm/tạo chat_session theo customer_psid + page_id
   2. Lưu message vào chat_messages
   3. Đẩy vào queue: chatQueue (BullMQ)
```

### 2. Chat Worker (BullMQ)
```
chatQueue job:
1. Load session + lịch sử 20 tin nhắn gần nhất
2. Kiểm tra ai_page_settings:
   - ai_enabled = false → skip toàn bộ fanpage
   - active_hours có giá trị → kiểm tra giờ hiện tại (timezone) → ngoài khung giờ thì skip
3. Kiểm tra session.ai_mode:
   - ai_mode = 'HUMAN' → skip (người tư vấn đang cầm)
4. Nếu ai_turn_count >= 10 → chuyển HUMAN mode → skip (không dùng cooldown thời gian)
5. Gọi Intent Classifier (Groq) với context session
6. Update intent vào DB
7. Nếu intent = Không Nhu Cầu hoặc Dừng:
   → chuyển ai_mode = 'HUMAN' ngay lập tức (không cooldown)
   → AI dừng hẳn cho đến khi người bật lại AI mode thủ công
8. Nếu intent = Khách Đùa:
   → Gửi probe 1 câu ngắn để kéo khách vào hội thoại, tiếp tục AI
9. Nếu intent = Muốn Mua / Đang Tư Vấn:
   a. Nếu có ảnh → Qdrant image search (product_images)
   b. Nếu có text → Qdrant text search (post_embeddings), lấy top 3
   c. Gọi Reply Generator (Groq) → reply ngắn + ảnh SP đầu tiên (nếu có)
   d. Gửi reply qua Facebook Send API
   e. Tăng ai_turn_count
10. Nếu intent = Đang Chốt:
    - Thiếu tên/SĐT/địa chỉ → hỏi thêm thông tin còn thiếu
    - Đủ thông tin → gửi tin xác nhận tổng kết (is_confirmation_summary = true)
11. Nếu intent = Đã Xác Nhận (khách reply ok):
    - Tạo chat_order với status = PENDING_REVIEW
    - Set intent = Đã Chốt, ai_mode = HUMAN
```

### 2b. AI Mode Activation (khi user bật lại AI Hoạt Động)
```
Trigger: user toggle ai_mode → 'AI' cho 1 conversation
→ Kiểm tra tin nhắn gần nhất của khách
→ Nếu có tin nhắn chưa được AI trả lời → đẩy job vào chatQueue ngay
→ Worker xử lý bình thường như tin nhắn mới
```

### 3. Gửi tin nhắn (Send API)
```
POST https://graph.facebook.com/v19.0/me/messages
Authorization: Bearer {page_access_token}
Body: { recipient: { id: psid }, message: { text, attachment } }
```

---

## 🧭 Vị trí trong Navigation

Tính năng này nằm ở tab **"💬 Hội Thoại"** trên Navbar chính. Xem cấu trúc navigation đầy đủ tại `FRONTEND.md`.

```
Navbar: [🧠 AI Học]  [💬 Hội Thoại ← đây]  [⚙️ Cài đặt]
Route:  /chat
```

Phần **Cài đặt AI Chat** (bật/tắt AI per fanpage + khung giờ) nằm trong tab **"⚙️ Cài đặt"** → route `/settings`.

---

## 🖥️ UI Layout (ChatPage.jsx)

### Trạng thái thông thường (đang tư vấn)
```
┌─────────────────────────────────────────────────────────────────┐
│ Header: "AI Chat" | Page selector dropdown | AI On/Off global  │
├──────────────────┬──────────────────────────┬───────────────────┤
│ CONVERSATION     │ CHAT VIEW                │ CUSTOMER INFO     │
│ LIST             │                          │                   │
│                  │ [Customer Name]          │ Name: Nguyễn A    │
│ 🔴 Nguyễn A     │ 🟢 Muốn Mua              │ PSID: xxx         │
│ "cho hỏi giá..." │ ─────────────────        │                   │
│ 2m ago           │ Khách: cho hỏi giá       │ Intent:           │
│                  │ túi da màu đen           │ 🟢 Muốn Mua       │
│ 🟠 Trần B       │                          │                   │
│ "Cần Hỗ Trợ"    │ AI: Dạ, bên em có        │ Tags:             │
│ 5m ago           │ [ảnh túi] Túi Da Thật    │ [hot] [new]  [+]  │
│                  │ chỉ 850k, đang có KM     │                   │
│ ⚪ Lê C         │ giảm thêm 10%...         │ AI Replies: 2/5   │
│ "hôm nay có..."  │                          │                   │
│ 10m ago          │ Khách: ok giá đó đc      │ [Tắt AI]          │
│                  │ không                    │ [Gắn Tag]         │
│ [Search...]      │                          │ [Xem Đơn]         │
│ [Filter intent]  │ [Type message...]  [Send]│                   │
└──────────────────┴──────────────────────────┴───────────────────┘
```

### Panel phải — 2 tab chuyển qua lại

Panel bên phải luôn có **2 tab nhỏ ở trên**. Tab nào đang active thì gạch dưới:

```
┌───────────────────────────────────┐
│  [👤 Thông tin khách] [🟣 Đã Chốt]│
├───────────────────────────────────┤
│  ... nội dung tab đang chọn ...   │
└───────────────────────────────────┘
```

**Quy tắc tab mặc định khi click vào conversation:**
- Session chưa có `AI_CLOSED` → mở tab **Thông tin khách** sẵn
- Session có `AI_CLOSED` → mở tab **Đã Chốt** sẵn (user thấy bằng chứng ngay), vẫn có thể nhấn sang Thông tin khách bất cứ lúc nào

---

#### Tab 1: Thông tin khách
```
┌───────────────────────────────────┐
│  [👤 Thông tin khách] [🟣 Đã Chốt]│  ← tab này đang active (gạch dưới)
├───────────────────────────────────┤
│  Name: Nguyễn A                   │
│  PSID: xxx                        │
│                                   │
│  Intent:  🟢 Muốn Mua  [Đổi]     │
│  AI Mode: 🤖 AI Hoạt Động  [Đổi] │
│                                   │
│  Tags:                            │
│  [đã chốt] [saler chị Hai]  [+]  │
│                                   │
│  AI Replies: 2/5                  │
│                                   │
│  [Gắn Tag]                        │
└───────────────────────────────────┘
```

#### Tab 2: Đã Chốt (tab này chỉ hiện khi session có `AI_CLOSED`)
```
┌───────────────────────────────────┐
│  [👤 Thông tin khách] [🟣 Đã Chốt]│  ← tab này đang active (gạch dưới)
├───────────────────────────────────┤
│  🟣 AI ĐÃ CHỐT ĐƠN                │
│  Chốt lúc: 14:32 — 22/04/2026    │
├───────────────────────────────────┤
│  📋 THÔNG TIN ĐƠN                 │
│  ─────────────────                │
│  👤 Tên:  Nguyễn Văn A            │
│  📞 SĐT:  0912 345 678            │
│  📍 Địa:  123 Lê Lợi, Q1, HCM    │
│  📦 SP:   Túi Da Đen size M       │
│  💰 Giá:  850.000đ (KM -10%)      │
├───────────────────────────────────┤
│  ✅ BẰNG CHỨNG XÁC NHẬN           │
│  ─────────────────                │
│  ┌─────────────────────────────┐  │
│  │ 🤖 AI — 14:30:12            │  │  ← nền xanh nhạt
│  │ "Dạ em xác nhận lại đơn ạ: │  │
│  │  📦 Túi Da Đen size M       │  │
│  │  💰 850k (KM -10%)          │  │
│  │  👤 Nguyễn Văn A            │  │
│  │  📞 0912 345 678            │  │
│  │  📍 123 Lê Lợi, Q1, HCM    │  │
│  │  Anh xác nhận đặt nhé ạ?✅" │  │
│  └─────────────────────────────┘  │
│                                   │
│  ┌─────────────────────────────┐  │
│  │ 👤 Khách — 14:31:47         │  │  ← nền xanh đậm + border nổi
│  │ "ok bạn ơi"                 │  │  ← bằng chứng chốt
│  └─────────────────────────────┘  │
│  ⏱ Khách xác nhận: 14:31:47      │  ← timestamp HH:mm:ss DD/MM/YYYY
├───────────────────────────────────┤
│  [✅ Xác nhận gửi hàng]           │
│  [✏️ Sửa thông tin]              │
│  [❌ Huỷ đơn]  [📋 Copy đơn]     │
└───────────────────────────────────┘
```

**Nguyên tắc tab Đã Chốt:**
- Tin AI tổng kết (`is_confirmation_summary = true`): nền xanh nhạt
- Tin khách xác nhận (`is_customer_confirmed = true`): nền xanh đậm + border nổi bật
- Timestamp đầy đủ `HH:mm:ss — DD/MM/YYYY` (không dùng "2 phút trước")
- Nội dung tab **bất biến** — snapshot tại thời điểm chốt, không thay đổi dù có tin nhắn mới

**Features UI:**
- Sort conversations: `Dừng` lên đầu, sau đó `Muốn Mua`/`Đang Tư Vấn`, rồi `Khách Đùa`, cuối là `Không Nhu Cầu`
- Filter theo intent + filter riêng `Đã Chốt chờ duyệt`
- Badge đếm: số hội thoại `Dừng` cần người vào / số đơn `Đã Chốt` chờ duyệt
- AI Mode toggle per conversation: `🤖 AI Hoạt Động` ↔ `👤 Người Tư Vấn`
- Gõ tin nhắn thủ công khi ở chế độ `Người Tư Vấn`
- Real-time update qua SSE hoặc polling 3s

---

## ⚙️ Settings Page (ChatSettingsPage.jsx)

Trang riêng để user cấu hình AI per fanpage. Truy cập từ menu hoặc nút Settings trên ChatPage.

```
┌──────────────────────────────────────────────────┐
│  ⚙️ Cài đặt AI Chat                             │
├──────────────────────────────────────────────────┤
│  FANPAGE CỦA BẠN                                 │
│  ─────────────────────────────────────────────   │
│  📄 Fanpage A                                    │
│     AI Chat:  [🟢 Đang bật]  ← toggle           │
│     Khung giờ: 08:00 – 22:00  [Sửa]             │
│                                                  │
│  📄 Fanpage B                                    │
│     AI Chat:  [⚪ Đang tắt]  ← toggle           │
│     Khung giờ: Cả ngày (24/7)  [Sửa]            │
│                                                  │
│  📄 Fanpage C                                    │
│     AI Chat:  [🟢 Đang bật]  ← toggle           │
│     Khung giờ: 07:00 – 23:00  [Sửa]             │
└──────────────────────────────────────────────────┘
```

**Quy tắc hoạt động:**
- Bật AI cho fanpage → AI bắt đầu dò tất cả tin nhắn mới của fanpage đó
- Tắt AI cho fanpage → toàn bộ conversation của fanpage đó chuyển `Người Tư Vấn`, AI không làm gì
- Khung giờ: nếu set thì AI chỉ reply trong giờ đó (timezone Asia/Ho_Chi_Minh), ngoài giờ bỏ qua
- Khung giờ = trống → AI hoạt động 24/7

---

## 📝 Prompt Templates

### Intent Classifier Prompt
```
Bạn là AI phân loại ý định mua hàng. Dựa vào lịch sử hội thoại sau,
xác định intent của khách hàng.

Trả về JSON: { "intent": "Muốn Mua|Đang Tư Vấn|Khách Đùa", "reason": "..." }

Quy tắc:
- Muốn Mua: hỏi giá, muốn mua, đặt hàng, hỏi còn hàng không
- Đang Tư Vấn: hỏi thông tin SP, so sánh, hỏi chất lượng, chưa rõ ý định mua
- Khách Đùa: chào hỏi thông thường, không liên quan đến sản phẩm, spam, hỏi linh tinh

Lịch sử hội thoại:
{conversation_history}
```

### Reply Generator Prompt
```
Bạn là nhân viên tư vấn bán hàng. Trả lời NGẮN GỌN (tối đa 3 câu).

Sản phẩm tìm được:
{product_context}

Tin nhắn khách: {customer_message}

Quy tắc:
- Giới thiệu SP với giá + khuyến mãi (nếu có)
- Kết thúc bằng câu hook ngắn (hỏi có muốn đặt không)
- KHÔNG dài dòng, KHÔNG giải thích nhiều
- Nếu đang hỏi thông tin để chốt: chỉ hỏi Tên + SĐT + Địa chỉ
```

### Probe Prompt (khi COLD)
```
Khách vừa nhắn: {message}
Hỏi 1 câu ngắn để tìm hiểu họ cần gì. Không quá 1 câu.
Ví dụ: "Anh/chị đang tìm sản phẩm gì vậy ạ?"
```

---

## 🛠️ Implementation Phases

### Phase 1 — Database & Webhook (1-2h)
- [ ] Migration: tạo bảng `ai_page_settings`, `chat_sessions`, `chat_messages`, `session_tags`, `chat_orders`
- [ ] `POST /api/chat/webhook` — nhận FB Messenger events
- [ ] `GET /api/chat/webhook` — verify webhook token
- [ ] `chatDB.js` — CRUD functions cho tất cả bảng trên

### Phase 2 — Chat Worker & Intent (2-3h)
- [ ] `chatQueue.js` — BullMQ queue mới
- [ ] `chatWorker.js` — worker xử lý logic chính (kiểm tra settings → ai_mode → cooldown → intent)
- [ ] `intentService.js` — gọi Groq classify intent, trả về intent + reason
- [ ] Cooldown logic theo `cooldown_until` trong DB
- [ ] AI Mode activation: khi user bật lại AI → trigger job cho tin nhắn chưa trả lời

### Phase 3 — Product Search & Reply (1-2h)
- [x] `utils/fbSendApi.js` — sendFbMessage, sendFbImage, sendFbImageWithCaption (reuse page_tokens)
- [x] Product search + reply: chatWorker gọi trực tiếp AI service `/chat/generate-reply` (text + image search trong Qdrant)
- [x] Gửi ảnh sản phẩm + caption reply qua FB Send API khi có image results
- [x] `chatProductSearch.js` / `replyGenerator.js` không cần — AI service đã xử lý tất cả

### Phase 4 — Chat UI (3-4h)
- [ ] `ChatPage.jsx` — layout 3 cột
- [ ] `ConversationList.jsx` — list + filter intent + AI Mode badge + sort (Dừng lên đầu)
- [ ] `ChatView.jsx` — tin nhắn + intent badge + AI Mode toggle per conversation
- [ ] `CustomerPanel.jsx` — 2 tab: "Thông tin khách" (luôn có) + "Đã Chốt" (chỉ hiện khi AI_CLOSED); mặc định chọn tab phù hợp theo trạng thái session
- [ ] Real-time: SSE hoặc polling 3s

### Phase 5 — Settings Page (1h)
- [x] `SettingsPage.jsx` — toggle AI per fanpage + active hours editor (theo ngày + giờ)
- [x] API: `GET/PUT /api/chat/settings/:pageId` (đã có từ Phase 1)
- [x] Route `/settings` + Navbar tab ⚙️ Cài đặt

### Phase 6 — Polish & Edge Cases (1h)
- [x] Notification badge đỏ trên tab 💬 Hội Thoại — đếm session `Dừng`, poll 15s
- [x] Human override: gõ tin nhắn khi AI mode → auto-switch sang HUMAN trước khi gửi + hint text
- [x] Ngoài khung giờ: chatWorker đã có `isWithinActiveHours` check (Phase 2)
- [ ] Test end-to-end với real Messenger (cần môi trường thật)

---

### Phase 7 — Message Intelligence (Lọc Tin Nhắn Thông Minh)

> Mục tiêu: AI **hiểu sâu** tin nhắn khách trước khi trả lời — xác định sản phẩm, đọc tâm trạng, cá nhân hóa reply. Đây là giai đoạn cốt lõi tạo ấn tượng đầu tiên với khách.

#### 7.1 Schema thêm mới

**`chat_sessions`** — thêm 3 field:
```sql
identified_product  JSONB     -- SP khách đang hỏi: {name, price, image_url, post_id} | null
customer_mood       VARCHAR   -- tâm trạng gần nhất: curious|excited|hesitant|annoyed|neutral
clarify_count       INT DEFAULT 0  -- số lần AI đã hỏi làm rõ SP nhưng chưa xác định được
```

**`ai_page_settings`** — thêm 1 field:
```sql
reply_style  TEXT  -- mô tả giọng điệu AI muốn dùng, do user tự viết
             -- vd: "Thân thiện, xưng em, không dùng nhiều emoji, tập trung vào giá trị SP"
```

#### 7.2 AI Pipeline mới (thay thế flow cũ ở Phase 2-3)

```
Tin nhắn khách đến
        │
        ▼
[BƯỚC 1 — LLM ANALYZE] — 1 call Groq duy nhất, trả về JSON:
  {
    intent:             "Muốn Mua|Đang Tư Vấn|Khách Đùa|...",
    mood:               "curious|excited|hesitant|annoyed|neutral",
    identified_product: "tên sản phẩm khách đang hỏi" | null,
    reason:             "lý do ngắn"
  }
  → Lưu intent + mood + identified_product vào session ngay
        │
        ▼
[BƯỚC 2 — ROUTING theo identified_product + intent]
        │
        ├─ identified_product = null VÀ intent = Muốn Mua/Đang Tư Vấn
        │     → clarify_count < 2: hỏi 1 câu lịch sự làm rõ SP
        │     → clarify_count >= 2: DỪNG → chuyển HUMAN mode
        │
        ├─ identified_product = null VÀ intent = Khách Đùa/Không Nhu Cầu/Dừng
        │     → xử lý theo điều kiện HUMAN mode cũ (Phase 6)
        │
        └─ identified_product != null
              → [BƯỚC 3 — PRODUCT ENRICHMENT]
```

#### 7.3 Product Enrichment (khi đã biết SP)

```
identified_product (tên SP từ LLM)
        │
        ▼
[Qdrant text search] — query = tên SP, filter user_id
  → Lấy: product_name, current_price, image_url (từ product_images collection)
        │
        ▼
[Optional: FB Profile crawl]
  GET /{customer_psid}?fields=name,picture&access_token={page_token}
  → Lấy: tên thật khách (nếu chưa có)
  → Dùng để cá nhân hóa: "Dạ chị Hoa ơi..."
        │
        ▼
[BƯỚC 4 — GENERATE REPLY] — Groq với đầy đủ context:
  System prompt bao gồm:
    - reply_style (từ ai_page_settings — user tự viết)
    - mood của khách → điều chỉnh tone
  User content:
    - Tin nhắn khách + lịch sử 5 tin gần nhất
    - SP: tên + giá + KM (nếu có)
    - Tên khách (nếu crawl được)
  → Reply ngắn gọn, đúng trọng tâm, đúng giọng điệu
        │
        ▼
[Gửi] — ảnh SP trước (nếu có) → text reply sau
```

#### 7.4 UI — CustomerPanel cập nhật (tab Thông tin khách)

```
┌──────────────────────────────────────────┐
│  🎯 SP đang hỏi                          │
│  Áo Thun Lạnh Thể Thao — 385.000đ       │  ← identified_product (realtime)
│  [xem ảnh]                               │
├──────────────────────────────────────────┤
│  😊 Tâm trạng: Tò mò (curious)          │  ← customer_mood (cập nhật mỗi tin)
├──────────────────────────────────────────┤
│  👤 Nguyễn Văn A                         │  ← tên từ FB profile (nếu crawl được)
│  PSID: xxx                               │
│  Intent: 🟢 Muốn Mua                    │
│  AI Mode: 🤖 AI Hoạt Động               │
└──────────────────────────────────────────┘
```

#### 7.5 Reply Style — Settings page

Thêm vào `SettingsPage.jsx` bên dưới mỗi fanpage card:
```
┌─────────────────────────────────────────────────┐
│  🗣️ Giọng điệu AI                               │
│  ┌─────────────────────────────────────────┐    │
│  │ Thân thiện, xưng em, gọi anh/chị,      │    │  ← textarea, user tự viết
│  │ không dùng nhiều emoji, tập trung       │    │
│  │ vào giá trị và tính năng sản phẩm      │    │
│  └─────────────────────────────────────────┘    │
│  [Lưu giọng điệu]                               │
└─────────────────────────────────────────────────┘
```

#### 7.6 Tóm tắt điều kiện DỪNG trong Phase 7

- `identified_product = null` + `clarify_count >= 2` + intent vẫn Muốn Mua/Đang Tư Vấn → **DỪNG → HUMAN mode**
- `identified_product = null` + intent = Không Nhu Cầu/Dừng/Khách Đùa → xử lý theo Phase 6
- `identified_product != null` → generate reply bình thường, không bao giờ DỪNG vì thiếu SP

---

## 🚫 Không làm (scope out)

- Không tích hợp Instagram / Zalo (chỉ FB Messenger)
- Không có CRM đầy đủ (không quản lý khách hàng lâu dài)
- Không có báo cáo / analytics
- Không tự động assign agent
- Không template tin nhắn thủ công (quick replies)
- Không bot training / fine-tuning

---

## 🔑 Yêu cầu kỹ thuật

- Facebook App cần permission: `pages_messaging`
- Webhook phải verify với `VERIFY_TOKEN` cố định
- Page Access Token đã có sẵn trong bảng `page_tokens`
- Tất cả AI call dùng Groq (đã có `GROQ_API_KEY`)
- Qdrant collections `post_embeddings` + `product_images` đã có sẵn
