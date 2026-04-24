classify_intent là bước đầu tiên chạy cho mọi tin nhắn, trước khi xử lý bất kỳ state nào.
                                                                                                   
  Input: tin nhắn mới nhất của khách (1 tin, không dùng history)                                      
  Output:                                                                                          
  {
    "has_product_signal": true/false,
    "product_hint": "áo sweater" | null,
    "message_intent": "buying|asking|confirming|joking|other",
    "product_feedback": "confirmed|denied|none"
  }

  Từng field nghĩa là gì:

  ┌────────────────────┬─────────────────────────────────────────────────────────┐
  │       Field        │                       Giải thích                        │
  ├────────────────────┼─────────────────────────────────────────────────────────┤
  │ has_product_signal │ Tin nhắn có nhắc đến tên SP / loại hàng / gửi ảnh không │
  ├────────────────────┼─────────────────────────────────────────────────────────┤
  │ product_hint       │ Cụm từ ngắn nhất để search SP trong Qdrant              │
  ├────────────────────┼─────────────────────────────────────────────────────────┤
  │ message_intent     │ Ý định tổng quát của tin nhắn                           │
  ├────────────────────┼─────────────────────────────────────────────────────────┤
  │ product_feedback   │ Khách đang phản hồi về SP AI vừa giới thiệu không       │
  └────────────────────┴─────────────────────────────────────────────────────────┘

  message_intent chi tiết:
  - buying — hỏi giá, muốn mua, hỏi còn hàng
  - asking — hỏi thêm về SP, chất lượng, so sánh
  - confirming — đồng ý, ok, đúng rồi, cho đặt
  - joking — chào hỏi, spam, không liên quan hàng
  - other — không rõ ý định

  product_feedback chi tiết:
  - confirmed — "đúng rồi", "phải", "ok SP đó"
  - denied — "không phải", "sai", "khác"
  - none — không phải phản hồi về SP nào

  ---
  Cách các state dùng nó:

  STATE 0 dùng has_product_signal + product_hint:
  - true → search Qdrant, tìm SP
  - false + joking → probe
  - false + khác → hỏi tên/ảnh SP

  STATE 1 dùng product_feedback + has_product_signal + product_hint:
  - confirmed hoặc message_intent=confirming → khoá SP, vào State 2
  - denied → tìm SP mới hoặc về State 0
  - product_hint khác SP hiện tại → tìm SP mới

  STATE 2 hiện tại bỏ qua classify_intent hoàn toàn — đây là bug thiết kế. Đúng ra phải dùng:      
  - product_feedback=denied → khách không muốn SP này nữa → về State 1
  - has_product_signal với SP khác → khách đổi ý → về State 0
  - message_intent=confirming + có đơn → xác nhận đơn
  - Còn lại → mới đi vào vùng thu thập info



---------------------------------------------

khi đang ở giai đoạn lấy thông tin khách hàng để tạo đơn 
-> thì llm vẫn nắm intent để sẵn sàng trả lời stage khác cho customer
             
  Vấn đề cốt lõi: STATE 2 hiện tại bỏ qua classify_intent — nhưng classify_intent đã chạy rồi và có   đầy đủ thông tin về ý định khách. Cần dùng nó làm gate trước khi extract info.                  
                                                                                                   
  Luồng đúng cho STATE 2:

  classify_intent (đã chạy từ đầu)
          ↓
  ┌───────────────────────────────────────────────────┐
  │ Gate 1 — Khách đổi ý về SP?                       │
  │  product_feedback = denied                         │
  │  → reset product_confirmed = false → về STATE 1   │
  │                                                    │
  │  has_product_signal + product_hint khác SP cũ     │
  │  → tìm SP mới → về STATE 0/1                      │
  └───────────────────────────────────────────────────┘
          ↓ (không đổi SP)
  ┌───────────────────────────────────────────────────┐
  │ Gate 2 — Khách xác nhận đơn?                      │
  │  message_intent = confirming + order tồn tại       │
  │  → markConfirmed → HUMAN mode → done              │
  └───────────────────────────────────────────────────┘
          ↓ (chưa có đơn, chưa đổi SP)
  ┌───────────────────────────────────────────────────┐
  │ VÙNG THU THẬP INFO — nhiệm vụ chính               │
  │                                                    │
  │  1. Lookup customer_profiles (PSID + page_id)     │
  │     Có sẵn → pre-fill, hỏi "Thông tin cũ đúng k?" │
  │                                                    │
  │  2. Extract từ tin nhắn MỚI NHẤT (1 LLM call)     │
  │     → {name|null, phone|null, address|null}        │
  │     merge vào pending fields                       │
  │                                                    │
  │  3. Validate:                                      │
  │     phone: regex /^(0|\+84)[0-9]{8,10}$/          │
  │     name: ≥ 2 ký tự                               │
  │     address: ≥ 10 ký tự                           │
  │                                                    │
  │  4. Đủ cả 3 valid                                 │
  │     → upsert customer_profiles                    │
  │     → gửi confirmation summary → tạo đơn          │
  │                                                    │
  │  5. Còn thiếu → hỏi đúng field thiếu              │
  │     → closing_turns++                             │
  └───────────────────────────────────────────────────┘

  Tại sao liền mạch với hệ thống:
  - classify_intent đã là bước đầu của MỌI state — STATE 2 chỉ thêm xử lý sau gate
  - Khách đổi ý về SP giữa chừng → hệ thống hiểu và quay về STATE 1/0 tự nhiên
  - Khách điền info bình thường → đi thẳng vào vùng thu thập, không đụng tới SP logic
  - customer_profiles là bộ nhớ dài hạn, hoạt động song song, không làm phức tạp state machine 
