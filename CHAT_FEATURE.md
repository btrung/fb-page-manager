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

AI chạy theo **state machine 3 trạng thái**, mỗi tin nhắn đến phân tích **tin nhắn mới nhất** (không dùng history).

```
Khách nhắn tin
    │
    ▼
[Classify tin nhắn mới nhất] — 1 LLM call, trả về:
  has_product_signal, product_hint, message_intent, product_feedback
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ STATE 0 — Chưa biết SP (max 5 lượt)                            │
│                                                                 │
│  has_product_signal = true → search Qdrant → lưu SP → State 1  │
│  joking              → probe redirect 1 câu                     │
│  other               → hỏi tên/ảnh SP                          │
│  ● 5 lượt không tìm được SP → DỪNG → HUMAN mode                │
└─────────────────────────────────────────────────────────────────┘
    │ SP tìm được
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ STATE 1 — Có SP, chưa khoá (max 8 lượt)                        │
│                                                                 │
│  Gửi ảnh SP + hỏi "Có phải SP anh/chị đang tìm không?"         │
│  confirmed → product_confirmed = true → State 2                 │
│  denied + SP mới → tìm SP mới, reset counter                   │
│  denied + không có SP mới → xoá SP, về State 0                 │
│  SP hint khác → tìm SP mới, reset counter                      │
│  ● 8 lượt chưa khoá → DỪNG → HUMAN mode                        │
└─────────────────────────────────────────────────────────────────┘
    │ SP đã khoá
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ STATE 2 — Kịch bản chốt đơn (max 5 lượt)                       │
│                                                                 │
│  [Gate 1 — classify_intent]                                     │
│  product_feedback=denied → reset product_confirmed → State 1    │
│  has_product_signal + SP khác → tìm SP mới → State 0           │
│  confirming + order tồn tại → xác nhận đơn → HUMAN mode        │
│                                                                 │
│  [Thu thập info — default path]                                 │
│  Lookup customer_profiles (PSID) → pre-fill nếu có sẵn         │
│  Extract từ tin nhắn MỚI NHẤT → merge → validate               │
│  Thiếu/sai field → hỏi đúng field đó → closing_turns++         │
│  Đủ cả 3 valid → upsert profile → gửi xác nhận → tạo đơn      │
│  ● 5 lượt chưa đủ info → DỪNG → HUMAN mode                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🏷️ Hệ thống Tag & Điều khiển AI

### 1. Intent Tag — chỉ dùng để hiển thị UI, user có thể override

AI routing **không** dựa vào intent tag nữa — routing dựa vào `identified_product` + `productConfirmed` (state machine). Intent tag chỉ để user theo dõi trạng thái trên màn hình.

| Intent | Màu | Ý nghĩa | AI set khi nào |
|---|---|---|---|
| `Đang Chốt` | 🟡 Vàng | Đang ở State 2 — kịch bản chốt | AI set khi khách confirm SP |
| `Đã Chốt` | 🟣 Tím | Đơn đã xác nhận | AI set khi khách confirm đơn |
| *(các intent khác)* | — | Hiển thị tham khảo | User tự override nếu muốn |

**Điều kiện AI tự chuyển HUMAN mode:**
- `no_product_turns >= 5` — 5 lượt không tìm được SP
- `unconfirmed_turns >= 8` — 8 lượt có SP nhưng khách chưa confirm
- `closing_turns >= 5` — 5 lượt đang chốt nhưng thiếu tên/SĐT/địa chỉ
- **Bật lại AI mode trên UI → AI xử lý ngay tin chưa trả lời, không cooldown**

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
id                UUID PRIMARY KEY
page_id           VARCHAR
user_id           UUID FK users
customer_psid     VARCHAR         -- FB Page-Scoped ID của khách
customer_name     VARCHAR
customer_avatar   VARCHAR
intent            VARCHAR         -- chỉ để hiển thị UI: Đang Chốt | Đã Chốt | ...
intent_updated_at TIMESTAMP
ai_mode           VARCHAR DEFAULT 'AI'  -- 'AI' | 'HUMAN'
ai_turn_count     INT DEFAULT 0   -- tổng lượt AI đã reply
last_message_at   TIMESTAMP
created_at        TIMESTAMP
-- State machine fields
identified_product  JSONB     -- {name, query, price, image_url, content} | null
customer_mood       VARCHAR   -- positive|neutral|negative|urgent
product_confirmed   BOOLEAN DEFAULT false  -- khách đã khoá SP chưa
no_product_turns    INT DEFAULT 0  -- lượt AI reply ở State 0 (max 5)
unconfirmed_turns   INT DEFAULT 0  -- lượt AI reply ở State 1 (max 8)
closing_turns       INT DEFAULT 0  -- lượt AI reply ở State 2 (max 5)
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
id           UUID PRIMARY KEY
user_id      UUID FK users
page_id      VARCHAR
ai_enabled   BOOLEAN DEFAULT false
active_hours JSONB    -- null = 24/7, hoặc {mon:{enabled,start,end}, tue:...}
reply_style  TEXT     -- giọng điệu AI, user tự viết. vd: "Thân thiện, xưng em, không emoji"
created_at   TIMESTAMP
updated_at   TIMESTAMP
UNIQUE(user_id, page_id)
```

### Bảng `customer_profiles` (hồ sơ khách hàng — tra cứu theo PSID)
```sql
id              UUID PRIMARY KEY
customer_psid   VARCHAR         -- Facebook Page-Scoped ID (định danh chính)
page_id         VARCHAR         -- scope theo fanpage
name            VARCHAR
phone           VARCHAR
address         TEXT
note            TEXT            -- ghi chú đặc biệt: tầng, giờ nhận, dị ứng...
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(customer_psid, page_id)
```

> Lần đầu khách đặt → tạo mới. Lần sau khách quay lại → AI đọc lên, hỏi "Thông tin giao hàng vẫn như cũ không ạ?" → khách chỉ cần confirm hoặc sửa field nào thay đổi.

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
chatQueue job (delay 2s):
1. Guards: session không tồn tại / ai_mode=HUMAN / ai_disabled / ngoài khung giờ → skip
2. Lấy tin nhắn mới nhất của khách
3. Kiểm tra counter DỪNG:
   - !identifiedProduct && noProductTurns >= 5  → HUMAN mode
   - identifiedProduct && !confirmed && unconfirmedTurns >= 8 → HUMAN mode
   - identifiedProduct && confirmed && closingTurns >= 5 → HUMAN mode
4. Classify tin nhắn mới nhất (1 Groq call):
   → {has_product_signal, product_hint, message_intent, product_feedback}

STATE 0 — chưa có identified_product:
  - has_product_signal → search Qdrant → lưu {name,query,price,image_url,content} → State 1
    (gửi ảnh SP + hỏi confirm)
  - joking → probe redirect
  - other  → hỏi tên/ảnh SP
  → no_product_turns++

STATE 1 — có SP, chưa product_confirmed:
  - product_feedback=denied + SP mới → tìm SP mới, reset unconfirmed_turns
  - product_feedback=denied + không SP → xoá SP, về State 0, no_product_turns++
  - confirmed/confirming → product_confirmed=true, intent=Đang Chốt → State 2 (chốt ngay)
  - product_hint khác → tìm SP mới, reset unconfirmed_turns
  - còn lại → gửi lại ảnh SP + hỏi confirm, unconfirmed_turns++

STATE 2 — product_confirmed=true:
  [Gate 1 — classify_intent]
  - product_feedback=denied
    → reset product_confirmed=false → về STATE 1
  - has_product_signal=true + product_hint khác SP hiện tại
    → tìm SP mới → về STATE 0
  [Gate 2 — xác nhận đơn]
  - message_intent=confirming + order tồn tại
    → markCustomerConfirmed → intent=Đã Chốt → HUMAN mode
  [Thu thập info — default path]
  - Lookup customer_profiles (customerPsid + pageId)
    Có sẵn & chưa có order → gửi thông tin cũ, hỏi còn đúng không
  - Extract từ tin nhắn MỚI NHẤT (1 LLM call /extract-order-fields)
    → {name, phone, address} merge vào profile
  - Validate: phone regex, name ≥ 2, address ≥ 10
  - Đủ cả 3 valid → upsert customer_profiles
    → generate-confirmation → createOrder(PENDING_REVIEW)
  - Thiếu/invalid → hỏi đúng field còn thiếu → closing_turns++
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
Bạn là nhân viên tư vấn bán hàng. Trả lời NGẮN GỌN (2-3 câu).

Quy tắc BẮT BUỘC:
1. Câu 1: báo giá + 1 điểm nổi bật/chất lượng của sản phẩm (lấy từ mô tả, không bịa)
2. Câu 2 (nếu có KM): đề cập khuyến mãi
3. Câu cuối: 1 câu thuyết phục/tạo urgency — KHÔNG chỉ hỏi "anh muốn mua không?"
   Phải có lý do hành động: "hàng đang hot", "giới hạn", "giao ngay hôm nay", "còn mấy cái cuối"...

KHÔNG viết nhạt như "anh muốn mua không?" — phải có sức thuyết phục.
Xưng "em", gọi khách "anh/chị".
```

### Probe Prompt (khi Khách Đùa / off-topic)
```
KHÔNG đùa theo, KHÔNG trả lời off-topic.
Chỉ redirect 1-2 câu lịch sự về sản phẩm.
Ví dụ: "Dạ bên em chuyên tư vấn sản phẩm ạ, anh/chị đang cần tìm gì thì nhắn hoặc gửi ảnh để em hỗ trợ ngay nhé!"

Khách vừa nhắn: {message}
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

### Phase 7 — Message Intelligence (State Machine + Smart Closing)

> Mục tiêu: AI phân tích **tin nhắn mới nhất** (không dùng history) để xác định SP và chạy kịch bản chốt đơn tự động.

#### 7.1 Schema thêm mới

**`chat_sessions`** — thêm fields:
```sql
identified_product  JSONB    -- {name, query, price, image_url, content} | null
customer_mood       VARCHAR  -- positive|neutral|negative|urgent
product_confirmed   BOOLEAN  -- khách đã xác nhận đúng SP này chưa
no_product_turns    INT      -- lượt AI reply khi chưa tìm được SP (max 5)
unconfirmed_turns   INT      -- lượt AI reply khi có SP nhưng chưa confirm (max 8)
closing_turns       INT      -- lượt AI reply khi đang chốt nhưng chưa đủ info (max 5)
```

**`ai_page_settings`** — thêm:
```sql
reply_style  TEXT  -- giọng điệu AI, user tự viết
```

#### 7.2 Phân tích đầu vào — chỉ dùng tin nhắn MỚI NHẤT

1 LLM call duy nhất, **không dùng history**:
```json
{
  "has_product_signal": true,
  "product_hint":       "áo thun lạnh",
  "message_intent":     "buying|asking|confirming|joking|other",
  "product_feedback":   "confirmed|denied|none"
}
```

#### 7.3 State Machine

```
STATE 0 — Chưa có identified_product (max 5 lượt)
    │
    ├─ has_product_signal = true → search Qdrant → lưu identified_product → State 1
    │   (lưu đầy đủ: name, query, price, image_url, content)
    │
    ├─ joking → probe redirect 1 câu → no_product_turns++
    └─ other  → hỏi tên/ảnh SP       → no_product_turns++
    ● no_product_turns >= 5 → DỪNG → HUMAN mode

STATE 1 — Có SP, chưa confirm (max 8 lượt)
    │
    ├─ product_feedback = denied + SP mới → tìm SP mới, reset unconfirmed_turns
    ├─ product_feedback = denied + không SP → xoá SP, về State 0
    ├─ product_feedback = confirmed / message_intent = confirming
    │     → product_confirmed = true → State 2 (chốt ngay)
    ├─ product_hint khác SP hiện tại → tìm SP mới, reset unconfirmed_turns
    └─ còn lại → gửi lại ảnh SP + hỏi confirm → unconfirmed_turns++
    ● unconfirmed_turns >= 8 → DỪNG → HUMAN mode

STATE 2 — SP đã khoá → Kịch bản chốt (max 5 lượt)
    │
    ├─ [Gate 1 — classify_intent, chạy trước mọi thứ]
    │   product_feedback=denied
    │     → reset product_confirmed=false → về STATE 1 (re-confirm SP)
    │   has_product_signal=true + product_hint khác SP hiện tại
    │     → tìm SP mới → về STATE 0
    │
    ├─ [Gate 2 — xác nhận đơn]
    │   message_intent=confirming + order tồn tại
    │     → markCustomerConfirmed → "Đã ghi nhận đơn" → intent=Đã Chốt → HUMAN mode
    │
    └─ [Thu thập info — default path khi không có gate nào trigger]
        │
        ├─ 1. Lookup customer_profiles (customer_psid + page_id)
        │     Có sẵn & chưa có order → gửi "Thông tin cũ: [tên] [sdt] [địa chỉ], vẫn đúng không ạ?"
        │
        ├─ 2. Extract từ tin nhắn MỚI NHẤT (1 LLM call riêng)
        │     → {name|null, phone|null, address|null}
        │     merge vào profile (field mới ghi đè field cũ)
        │
        ├─ 3. Validate từng field:
        │     phone   : regex /^(0|\+84)[0-9]{8,10}$/
        │     name    : ≥ 2 ký tự
        │     address : ≥ 10 ký tự
        │
        ├─ 4. Đủ cả 3 valid → upsert customer_profiles
        │     → gửi confirmation summary → createOrder(PENDING_REVIEW)
        │
        └─ 5. Thiếu / invalid → hỏi đúng field còn thiếu → closing_turns++
              Thiếu cả 3   → gửi closing script (hỏi tất cả)
              Thiếu name   → "Anh/chị cho em tên để ghi đơn với ạ!"
              Thiếu phone  → "Anh/chị cho em số điện thoại với ạ!"
              Thiếu addr   → "Anh/chị cho em địa chỉ giao hàng với ạ!"
              Sai phone    → "Số điện thoại chưa đúng định dạng, anh/chị kiểm tra lại với ạ!"

    ● closing_turns >= 5 → DỪNG → HUMAN mode
```

#### 7.4 Kịch bản chốt (format cố định)

```
[Ảnh SP — gửi trước]
[Tên SP] — [Giá]
• [Ưu điểm 1 từ mô tả]
• [Ưu điểm 2 từ mô tả]
[1 câu urgency: hàng hot / còn ít / giao ngay hôm nay...]
Anh/chị cho em xin tên, SĐT và địa chỉ để em chốt đơn ngay nhé! 📦
```

#### 7.5 Reply Style — Settings page

Textarea trong `SettingsPage.jsx` mỗi fanpage card — user tự viết phong cách.

#### 7.6 UI CustomerPanel

- `🎯 SP đang hỏi` / `✅ SP đã khoá` — realtime theo `identified_product` + `productConfirmed`
- Tâm trạng: positive/negative/urgent
- Counters: hiển thị tiến độ từng state (X/5, X/8, X/5), đỏ khi gần giới hạn

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
