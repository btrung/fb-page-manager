# Lessons

## 2026-05-15 — crawlWorker: dùng extracted_product_name bị rút ngắn
LLM extraction rút ngắn tên SP ("Áo thun thể thao" thay vì tên đầy đủ trên post).
Cách đúng: lấy dòng đầu tiên của post làm `product_name` trong Qdrant.
Áp dụng: mọi chỗ dùng tên SP từ crawl — không tin LLM extract cho tên SP.

## 2026-05-15 — crawlWorker: skip post cũ → Qdrant out of sync
Re-crawl skip post đã có trong DB → Qdrant thiếu/sai sau khi xóa collection thủ công.
Cách đúng: luôn re-embed kể cả post đã có → Qdrant luôn sync với DB.
Áp dụng: nếu Qdrant bị xóa thủ công → chạy lại crawl là đủ, không cần script riêng.

## 2026-05-16 — page_tokens: Editor/Moderator không subscribe được webhook
Gọi `/subscribed_apps` với page access token của Editor/Moderator → lỗi permission.
Cách đúng: check field `tasks` từ `/me/accounts` — chỉ subscribe nếu `tasks` chứa `"MANAGE"` (= ADMINISTRATOR).
Áp dụng: lưu thêm cột `role` vào `page_tokens` để sau này biết page nào có full quyền.

## 2026-05-16 — classify_intent không có context → misclassify "đúng rồi" thành general
classify_intent ban đầu chỉ nhận 1 tin nhắn, không biết trạng thái session → "đúng rồi" trong State 1 bị classify là `conversation_type=general` thay vì `buying`.
Cách đúng: pass `current_state` + 5 tin nhắn gần nhất vào classify → LLM hiểu context, classify chính xác.
Áp dụng: mọi lần mở rộng classify, luôn cần truyền context state hiện tại.

## 2026-05-16 — buy_candidate bị classify là support → support routing intercept mất buying intent
Khách muốn đổi sang SP khác ("cho đổi sang SP B") trong State 3 → LLM classify `conversation_type=support` vì từ "đổi" → support routing intercept, escape hatch không chạy.
Cách đúng: nếu `buy_candidate != null` → override `conversation_type='buying'`, dùng `switchHint = buy_candidate || product_hint` cho tất cả escape hatches.
Áp dụng: khi classify trả `buy_candidate`, luôn treat là buying intent dù conversation_type là gì.

## 2026-05-15 — State 2: timing bug mất 1 turn
Worker tính `missing_variants` trước khi LLM extract xong tin nhắn hiện tại → LLM thấy `is_complete=false` dù khách vừa cung cấp đủ → mất 1 turn.
Chấp nhận tạm. Fix đúng: tính missing sau khi merge extracted_variants vào session trước.
