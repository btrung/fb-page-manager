# Todo

## chat-interface — fix & cải thiện

- [ ] Niche filter — State 0 reject product_hint không khớp ngách fanpage (đã có schema, chưa code logic)
- [ ] Niche detection — auto detect ngách sau crawl → lưu `ai_page_settings.niche`
- [ ] Cron auto-crawl — `node-cron`, crawl bài đăng mới định kỳ
- [ ] State 2 timing bug — worker tính missing trước khi LLM extract tin hiện tại → mất 1 turn
- [ ] User test — cho người dùng thật test, collect bugs

### 3 conversation types (Phase 7 — đã code)
- [x] Schema + migration
- [x] `classify_intent`: thêm conversation_type, buy_candidate, frustration_level
- [x] `chatWorker.js`: routing support/general/buying + last_product_hint + fast-track + reset 24h
- [x] AI endpoint `/chat/handle-support` + `/chat/handle-general`
- [x] Settings UI: thêm textarea `page_policy` vào SettingsPage

## livestream-reply — chưa code

- [ ] DB migration: `live_comment_replies` + `livestream_ai_enabled` + `livestream_cta`
- [ ] `liveQueue.js` + `liveWorker.js`: classify comment → reply kèm Messenger Ref URL
- [ ] Webhook route `/webhook/live` nhận comment events từ Facebook
- [ ] `chatWorker.js`: handle `referral.ref` → auto-tag + skip State 0
- [ ] API: GET stats + comment list cho UI
- [ ] Frontend: `LivestreamPage.jsx` + `LiveSessionList` + `CommentFeed` + `CommentDetail` + `LiveSettingsModal`
- [ ] Test end-to-end: comment → AI reply → khách inbox → chốt đơn
