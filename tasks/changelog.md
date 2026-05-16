# Changelog

## v0.8 — 2026-05-16 — Livestream UI Phase 6 (mock data)
- `frontend/src/pages/LivestreamPage.jsx` — layout 3 cột + mock data
- `frontend/src/components/livestream/` — LiveSessionList, CommentFeed, CommentDetail, LiveSettingsModal
- `frontend/src/components/Navbar.jsx` — thêm tab 📺 Livestream
- `frontend/src/App.jsx` — thêm route /livestream
- Chưa wire API, dùng mock data để review giao diện

## v0.7 — 2026-05-16 — Fix classify context + routing nhất quán mọi state

- `ai-service` — classify_intent nhận thêm `current_state` + `recent_messages` (5 tin) → LLM hiểu context, không misclassify "đúng rồi" thành general
- `chatWorker.js` — support/general routing áp dụng mọi state (không chỉ State 0)
- `chatWorker.js` — `buy_candidate` override `conversation_type='buying'` → bypass support routing khi khách muốn đổi SP
- `chatWorker.js` — `switchHint = buy_candidate || product_hint` dùng nhất quán ở State 1, 2, 3 escape hatches → về State 1 trực tiếp khi tìm được SP, chỉ State 0 khi không rõ

## v0.6 — 2026-05-16 — Phase 7: 3 conversation types + fast-track + session reset 24h
- `ai-service/app/services/chat_llm_service.py` — classify_intent thêm conversation_type/buy_candidate/frustration_level; handle_support; handle_general
- `ai-service/app/routers/chat.py` — thêm /handle-support, /handle-general
- `backend/workers/chatWorker.js` — routing support/general/buying; lưu last_product_hint; fast-track State 1; reset 24h
- `backend/db/chatDB.js` — thêm support_turns, general_turns, lastProductHint vào _SESSION_COLS + updateSessionIntelligence + incrementCounter; page_policy + niche vào getAiPageSettingsByPageId
- `backend/db/schema.sql` — migration Phase 7

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
