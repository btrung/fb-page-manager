# AI Chat

## Làm gì
AI tự động tư vấn + chốt đơn qua Facebook Messenger. Chỉ xử lý hot customer (đã nhắn vào fanpage). 3 conversation types xử lý toàn bộ tình huống khách: support → general → buying, chuyển sang buying mượt khi có tín hiệu.

## Flow hiện tại

### Session reset
- Idle >24h → `ai_mode = 'AI'` + tất cả counters về 0 + `last_product_hint = null`
- Idle >3 ngày → thêm reset toàn bộ state machine (identified_product, variants...)

### Classify (chạy đầu tiên mọi tin nhắn)
1 LLM call `/chat/classify-intent`:
- Input: message + has_image + **current_state** (state0/1/2/3) + **recent_messages** (5 tin gần nhất)
- Output:
```
{
  has_product_signal, product_hint, message_intent, product_feedback,
  conversation_type: "buying|support|general",
  buy_candidate: string|null,     -- SP khách muốn mua (khác SP đang phàn nàn)
  frustration_level: "high|medium|low"
}
```
Worker:
- `switchHint = buy_candidate || product_hint` — hint tốt nhất khi đổi SP
- `buy_candidate != null` → override `conversation_type = 'buying'` (bypass support routing)
- Lưu `switchHint` vào `last_product_hint` session

---

### conversation_type = support (max 5 lượt)
Khách phàn nàn về SP đã mua / chất lượng / dịch vụ.

LLM call `/chat/handle-support`:
- Input: message, product_hint, reply_style
- Output: `{reply, frustration_level, cta_included}`

Routing:
- `frustration=high` → reply thuần support, không CTA
- `frustration=medium/low` → reply support + gentle CTA chuyển hướng mua
- `support_turns >= 5` → HUMAN mode

### conversation_type = general (max 5 lượt)
Khách hỏi chính sách: bảo hành, vận chuyển, đổi trả... không liên quan SP cụ thể.

LLM call `/chat/handle-general`:
- Input: message, page_policy, niche
- Output: `{reply}`
- `general_turns >= 5` → HUMAN mode

### conversation_type = buying → Fast-track + State machine

**Fast-track khi chuyển từ support/general sang buying:**
- Có `last_product_hint` + `buy_candidate` → Qdrant search
- confidence=high → **State 1 trực tiếp** (bỏ qua State 0)
- confidence=medium/low → State 0 bình thường

---

### State 0 — Tìm SP (max 5 lượt)
1. Check niche: `product_hint` không khớp `ai_page_settings.niche` → từ chối lịch sự → `no_product_turns++`
2. `has_product_signal` + khớp niche:
   - Stage 1: Qdrant vector search top 5 (threshold 0.20)
   - Stage 2: LLM `/rerank-products` chọn SP phù hợp nhất
   - confidence=high → 1 SP → confirm ngay + set intent "Muốn Mua" → State 1
   - confidence=medium → gửi tất cả có ảnh + quick_replies → lưu `candidate_products` → State 1
   - confidence=low → hỏi lại → `no_product_turns++`
3. joking → `/chat/generate-probe` redirect → `no_product_turns++`
4. other → hỏi tên/ảnh SP → `no_product_turns++`
- `no_product_turns >= 5` → HUMAN mode

### State 1 — Xác nhận SP (max 8 lượt)
- confirmed → `product_confirmed=true` → gửi closing script (ảnh + giá + ưu điểm + hỏi all variants) → State 2
- denied + có SP mới → tìm SP mới, reset `unconfirmed_turns`
- denied + không SP → xóa SP, về State 0
- `product_hint` khác SP hiện tại → tìm SP mới, reset `unconfirmed_turns`
- còn lại → gửi lại ảnh SP + hỏi confirm → `unconfirmed_turns++`
- `unconfirmed_turns >= 8` → HUMAN mode

### State 2 — Tư vấn + Variants (max 10 lượt)
Worker tính (deterministic):
- `missing = required_variants - keys(current_variants)`
- `is_complete = missing.length === 0`

LLM call `/chat/consult`:
- Input: combined_messages, product, niche, current_variants, missing_variants, is_complete, conversation_history(6 tin), reply_style
- Output: `{updated_variants, confirmed_variants, exit, new_product_hint, reply}`

Routing:
- `new_product_hint` → về State 0
- `exit=true` → HUMAN mode
- `is_complete && confirmed_variants` → `variant_confirmed=true` → State 3
- còn lại → `consulting_turns++`
- `consulting_turns >= 10` → HUMAN mode

### State 3 — Webview Form giao hàng (max 10 lượt)
1. Vào State 3 lần đầu (`profileConfirmAsked=false`) → gửi webview button 1 lần
2. Khách tap → form HTML trong Messenger, pre-fill profile cũ: tên SP + giá (locked) + variants (editable) + name/phone/address
3. Submit → validate → save `customer_profiles` + update variants → gửi confirmation summary vào chat
4. Khách nhắn "OK" → `/chat/generate-confirmation` check → `createOrder` → HUMAN mode
5. Escape hatch: `product_hint` khác SP hiện tại → reset toàn bộ → State 0
- `closing_turns >= 10` → HUMAN mode

### Worker principles
- Delay 7s trước khi xử lý → gom nhiều tin nhắn liên tiếp
- `getUnrepliedCustomerMessages` → lấy TẤT CẢ tin khách chưa được AI reply
- In-memory `_processing` Set → tránh 2 job cùng session chạy song song
- LLM lo: văn phong, tâm lý, extract từ tin nhắn
- Worker lo: routing chính xác (deterministic), không nhờ LLM quyết định

## Kế hoạch triển khai

- [x] Phase 1 — DB schema + Webhook nhận tin nhắn + chatQueue
- [x] Phase 2 — chatWorker cơ bản + Product search + FB Send API
- [x] Phase 3 — Chat UI (ChatPage 3 cột + ConversationList + ChatView + CustomerPanel)
- [x] Phase 4 — Settings Page (toggle AI + active hours per fanpage)
- [x] Phase 5 — State machine 4 states + 2-stage retrieval (Qdrant → LLM rerank)
- [x] Phase 6 — Webview form giao hàng (State 3 redesign, thay LLM collect trực tiếp)
- [x] Phase 7 — 3 conversation types (support/general/buying) + fast-track + session reset 24h
- [ ] Phase 8 — Niche filter + auto-detect ngách sau crawl
- [ ] Phase 9 — Cron auto-crawl định kỳ

## Schema / Config

### chat_sessions (fields quan trọng)
```sql
identified_product    JSONB     -- {name, query, price, image_url, content, required_variants}
product_confirmed     BOOLEAN   -- State 1 confirmed
product_variants      JSONB     -- variants đang thu thập {size:M, màu:xanh}
variant_confirmed     BOOLEAN   -- State 2 xong → State 3
no_product_turns      INT       -- counter State 0 (max 5)
unconfirmed_turns     INT       -- counter State 1 (max 8)
consulting_turns      INT       -- counter State 2 (max 10)
closing_turns         INT       -- counter State 3 (max 10)
candidate_products    JSONB     -- SP candidates khi rerank=medium (xóa sau khi chọn)
ai_mode               VARCHAR   -- 'AI' | 'HUMAN'
-- Phase 7 (chưa migrate)
support_turns         INT       -- counter support mode (max 5)
general_turns         INT       -- counter general mode (max 5)
last_product_hint     VARCHAR   -- SP hint gần nhất từ classify, dùng fast-track
```

### ai_page_settings (fields quan trọng)
```sql
ai_enabled    BOOLEAN
active_hours  JSONB     -- null = 24/7, {mon:{enabled,start,end}, ...}
reply_style   TEXT      -- giọng điệu AI, user tự viết
niche         VARCHAR   -- ngách fanpage (tự detect sau crawl)
page_policy   TEXT      -- chính sách bảo hành, vận chuyển... (Phase 7, chưa migrate)
```

### LLM Endpoints
| Endpoint | Dùng khi |
|---|---|
| `/chat/classify-intent` | Mọi tin nhắn — phân loại intent + conversation_type |
| `/chat/handle-support` | conversation_type=support — bảo vệ SP + detect frustration |
| `/chat/handle-general` | conversation_type=general — trả lời từ page_policy |
| `/chat/rerank-products` | State 0 — chọn SP phù hợp nhất từ top 5 |
| `/chat/generate-product-confirm` | State 0/1 — hỏi xác nhận SP |
| `/chat/generate-probe` | State 0 — redirect khách đùa |
| `/chat/generate-closing` | State 1→2 — opening message hỏi all variants |
| `/chat/detect-variants` | Khi tìm SP — xác định required_variants |
| `/chat/consult` | State 2 — tư vấn + fill variants |
| `/chat/generate-confirmation` | State 3 — check/tạo summary xác nhận đơn |
| `/chat/detect-niche` | Sau crawl — xác định ngách fanpage |

## Edge cases

- **Tên SP từ crawl**: dùng dòng đầu tiên của post, không dùng LLM extract (bị rút ngắn) — xem `lessons.md`
- **Re-crawl**: luôn re-embed kể cả post đã có → Qdrant luôn sync — xem `lessons.md`
- **candidate_products**: lưu khi confidence=medium, xóa sau khi khách chọn SP
- **AI mode activation**: user bật lại AI → worker push job ngay cho tin chưa trả lời, không cần đợi
- **Qdrant bị xóa thủ công**: chạy lại crawl là đủ
- **State 2 timing bug**: worker tính missing trước khi LLM extract tin hiện tại → mất 1 turn — xem `lessons.md`
- **buy_candidate vs product_hint**: support mode dùng `buy_candidate` để fast-track, không dùng `product_hint` (tránh nhầm SP đang phàn nàn với SP muốn mua)

## Nâng cấp tiếp theo

- **3 conversation types** (Phase 7 — ✅ đã code) — support/general/buying + fast-track + session reset 24h
- Niche filter — State 0 reject product_hint không khớp ngách (đã có schema `niche`, chưa code logic check)
- State 2 timing bug fix — tính missing sau khi merge extracted_variants trước khi pass vào LLM
