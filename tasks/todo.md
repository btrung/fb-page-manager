# Todo

## chat-interface — fix & cải thiện

- [ ] Niche filter — State 0 reject product_hint không khớp ngách fanpage (đã có schema, chưa code logic)
- [ ] Niche detection — auto detect ngách sau crawl → lưu `ai_page_settings.niche`
- [ ] Cron auto-crawl — `node-cron`, crawl bài đăng mới định kỳ
- [ ] State 2 timing bug — worker tính missing trước khi LLM extract tin hiện tại → mất 1 turn
- [ ] User test — cho người dùng thật test, collect bugs

### 3 conversation types (thiết kế xong, sẵn sàng code)
- [ ] Schema: thêm `page_policy` vào `ai_page_settings`, thêm `support_turns`, `general_turns`, `last_product_hint` vào `chat_sessions`
- [ ] `classify_intent`: thêm output `conversation_type`, `buy_candidate`, `frustration_level`
- [ ] `chatWorker.js`: routing theo conversation_type + cập nhật `last_product_hint` mỗi lượt
- [ ] AI endpoint `/chat/handle-support`: bảo vệ SP + detect frustration + CTA khi thích hợp
- [ ] AI endpoint `/chat/handle-general`: trả lời từ `page_policy`
- [ ] Fast-track buying: dùng `last_product_hint` → Qdrant → State 1 trực tiếp nếu high confidence
- [ ] Session reset 24h: `ai_mode = 'AI'` + tất cả counters + `last_product_hint = null`
- [ ] Settings UI: thêm textarea `page_policy` vào SettingsPage

## livestream-reply — chưa code

- [ ] DB migration: `live_comment_replies` + `livestream_ai_enabled` + `livestream_cta`
- [ ] `liveQueue.js` + `liveWorker.js`: classify comment → reply kèm Messenger Ref URL
- [ ] Webhook route `/webhook/live` nhận comment events từ Facebook
- [ ] `chatWorker.js`: handle `referral.ref` → auto-tag + skip State 0
- [ ] API: GET stats + comment list cho UI
- [ ] Frontend: `LivestreamPage.jsx` + `LiveSessionList` + `CommentFeed` + `CommentDetail` + `LiveSettingsModal`
- [ ] Test end-to-end: comment → AI reply → khách inbox → chốt đơn
