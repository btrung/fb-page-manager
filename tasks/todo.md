# Todo

## chat-interface — fix & cải thiện

- [ ] Niche filter — State 0 reject product_hint không khớp ngách fanpage (đã có schema, chưa code logic)
- [ ] Niche detection — auto detect ngách sau crawl → lưu `ai_page_settings.niche`
- [ ] Cron auto-crawl — `node-cron`, crawl bài đăng mới định kỳ
- [ ] State 2 timing bug — worker tính missing trước khi LLM extract tin hiện tại → mất 1 turn
- [ ] User test — cho người dùng thật test, collect bugs

## livestream-reply — đang làm

- [ ] Phase 1 — DB migration: `live_comment_replies` + `livestream_ai_enabled` + `livestream_cta`
- [ ] Phase 2 — `liveQueue.js` + `liveWorker.js`: classify comment → reply kèm Messenger Ref URL
- [ ] Phase 3 — Webhook route `/webhook/live` nhận comment events từ Facebook
- [ ] Phase 4 — `chatWorker.js`: handle `referral.ref` → auto-tag + skip State 0
- [ ] Phase 5 — API endpoints: stats + comment list cho UI
- [ ] Phase 6b — Wire API thật vào LivestreamPage (thay mock data)
- [ ] Phase 7 — Test end-to-end: comment → AI reply → khách inbox → chốt đơn
