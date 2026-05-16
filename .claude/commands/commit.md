---
name: commit
description: Stage và commit local, không push
---

Chuẩn bị commit local (KHÔNG push):

1. Chạy `git status` và `git diff` — xem thay đổi thực tế
2. Nhóm các files theo tính năng / layer (backend / ai-service / frontend)
3. Đề xuất commit message theo convention của project:

   **Subject line:** `<type>: <mô tả ngắn tiếng Việt>`
   - Types: `feat:` / `fix:` / `docs:` / `chore:`
   - Ví dụ: `feat: liveWorker classify comment + reply m.me link`

   **Body:** nhóm theo từng file path, mỗi file liệt kê bullet points giải thích
   thay đổi + lý do (what + why), bao gồm context trước/sau nếu có:

   ```
   path/to/file.js
   - Thay đổi 1 — lý do / trước vs sau
   - Thay đổi 2 — lý do

   path/to/other.py
   - Thay đổi — lý do
   ```

4. Hỏi xác nhận trước khi thực hiện
5. Stage files phù hợp và commit local — KHÔNG chạy git push
