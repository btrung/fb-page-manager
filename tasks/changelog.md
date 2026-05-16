# Changelog

## v0.5 — 2026-05-16 — Auto subscribe webhook + role detection
- `backend/routes/api.js` — thêm `tasks` field khi fetch `/me/accounts`, detect role, subscribe webhook tự động chỉ cho ADMINISTRATOR
- `backend/db/schema.sql` — thêm cột `role VARCHAR(50)` vào `page_tokens`

## v0.4 — 2026-05-15 — Chat flow end-to-end hoạt động
Flow: tìm SP → rerank → confirm → tư vấn + variants → webview form → confirm → tạo đơn
Logic hiện tại: `tasks/features/chat.md`

- State 3 redesign: webview form thay thế LLM collect info trực tiếp
  `backend/routes/form.js` — form HTML trong Messenger, pre-fill profile cũ, giá locked
  `backend/utils/fbSendApi.js` — sendWebviewButton, sendQuickReplies
  `frontend/src/components/chat/CustomerPanel.jsx` — stage badge (5 giai đoạn)

- State 0 redesign: 2-stage retrieval (Qdrant → LLM rerank)
  `backend/workers/chatWorker.js` — candidate_products, escape hatch, session reset 3 ngày
  `ai-service/app/routers/chat.py` — /rerank-products, /consult, /detect-variants, /consult-state3
  `ai-service/app/services/chat_llm_service.py` — rerank_products, hỏi all variants trong 1 câu

- crawlWorker: firstLine làm product_name, luôn re-embed khi crawl lại
  `backend/workers/crawlWorker.js`
  `ai-service/app/services/llm_service.py` — prompt extract tên SP đầy đủ

## v0.3 — 2026-05 — Chat UI + Settings
- `frontend/src/pages/ChatPage.jsx` — layout 3 cột
- `frontend/src/pages/SettingsPage.jsx` — toggle AI + active hours per fanpage
- `frontend/src/components/chat/` — ConversationList, ChatView, CustomerPanel
- Notification badge, human override, active hours check

## v0.2 — 2026-05 — Webhook + Worker + Product Search
- `backend/workers/chatWorker.js` — pipeline chính
- `backend/db/chatDB.js`, `backend/queues/chatQueue.js`
- Webhook, chat API, FB Send API

## v0.1 — 2026-05 — DB + Crawl + Embed
- Schema: chat_sessions, chat_messages, session_tags, chat_orders, customer_profiles
- Crawl FB posts → LLM extract → embed Qdrant
- `backend/workers/crawlWorker.js`
