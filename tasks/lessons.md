# Lessons

## 2026-05-15 — crawlWorker: dùng extracted_product_name bị rút ngắn
LLM extraction rút ngắn tên SP ("Áo thun thể thao" thay vì tên đầy đủ trên post).
Cách đúng: lấy dòng đầu tiên của post làm `product_name` trong Qdrant.
Áp dụng: mọi chỗ dùng tên SP từ crawl — không tin LLM extract cho tên SP.

## 2026-05-15 — crawlWorker: skip post cũ → Qdrant out of sync
Re-crawl skip post đã có trong DB → Qdrant thiếu/sai sau khi xóa collection thủ công.
Cách đúng: luôn re-embed kể cả post đã có → Qdrant luôn sync với DB.
Áp dụng: nếu Qdrant bị xóa thủ công → chạy lại crawl là đủ, không cần script riêng.

## 2026-05-15 — State 2: timing bug mất 1 turn
Worker tính `missing_variants` trước khi LLM extract xong tin nhắn hiện tại → LLM thấy `is_complete=false` dù khách vừa cung cấp đủ → mất 1 turn.
Chấp nhận tạm. Fix đúng: tính missing sau khi merge extracted_variants vào session trước.
