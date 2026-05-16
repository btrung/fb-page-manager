---
name: review
description: Review toàn bộ thay đổi trên branch hiện tại trước khi commit
---

Đọc CLAUDE.md để nắm context. Sau đó review toàn bộ thay đổi trên branch hiện tại:

1. Chạy `git diff main...HEAD` — xem diff so với main
2. Chạy `git status` — xem files chưa stage
3. Đọc từng file thay đổi, đánh giá:
   - Logic có đúng với design trong CLAUDE.md không
   - Có bug hoặc edge case bỏ sót không
   - Docker service nào cần restart sau khi deploy (worker / backend / ai-service)
4. Báo cáo tổng kết:
   - ✅ ổn — có thể commit
   - ⚠️ cần xem lại — liệt kê vấn đề cụ thể
   - ❌ có vấn đề — mô tả bug / logic sai
