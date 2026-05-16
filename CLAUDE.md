# CLAUDE.md — FB Page Manager

Đọc file này trước khi làm bất kỳ việc gì.

---

## Stack

| Layer | Tech | Port |
|---|---|---|
| Frontend | React + Vite + Tailwind | 5173 |
| Backend | Node.js / Express | 5000 |
| AI Service | Python FastAPI | 8000 |
| DB | PostgreSQL (pgvector) | 5432 |
| Queue | Redis + BullMQ | 6379 |
| Vector DB | Qdrant | 6333 |

Chạy bằng Docker Compose. Worker là container riêng (`fb-page-manager-worker-1`).

```bash
docker compose up -d
docker compose restart worker
docker compose restart backend
docker compose up -d --build ai-service
docker compose logs -f worker
```

---

## LLM & Embedding

- **LLM:** Groq (`llama-3.3-70b-versatile`) — key: `GROQ_API_KEY`
- **Text embed:** paraphrase-multilingual-MiniLM-L12-v2 (384d, local CPU)
- **Image embed:** CLIP ViT-B/32 (512d, local CPU)
- **Qdrant collections:** `post_embeddings` (384d text) + `product_images` (512d image)

---

## Tính năng

| Feature | Route | Trạng thái | Design doc |
|---|---|---|---|
| AI Học Fanpage | `/` | Hoạt động | — |
| AI Chat | `/chat` | Hoạt động, đang user test | `tasks/features/chat.md` |
| Cài đặt | `/settings` | Hoạt động | — |
| Livestream Reply | `/livestream` | Đang thiết kế | `tasks/features/livestream-reply.md` |

---

## Git

```
main              ──── stable (chưa merge gì mới)
chat-interface    ──── đang user test + fix bugs
livestream-reply  ──── đang phát triển (branch này)
```

- Fix chat → commit `chat-interface`
- Code livestream → commit `livestream-reply`
- Sync: `git merge chat-interface` vào `livestream-reply` khi chat có fix lớn
- Merge vào `main` sau khi cả 2 ổn định

---

## Quản lý task

| File | Nội dung |
|---|---|
| `tasks/todo.md` | Việc cần làm, đang dở ở đâu |
| `tasks/changelog.md` | Lịch sử hoàn thành theo version |
| `tasks/lessons.md` | Lỗi đã gặp toàn project + cách đúng |
| `tasks/features/chat.md` | Logic AI Chat hiện tại |
| `tasks/features/livestream-reply.md` | Logic Livestream Reply hiện tại |
| `tasks/features/frontend.md` | Navigation, routes, file structure frontend |

---

## Files quan trọng

| File | Vai trò |
|---|---|
| `backend/workers/chatWorker.js` | AI pipeline chính — 4 states |
| `backend/workers/crawlWorker.js` | Crawl FB posts + embed Qdrant |
| `backend/routes/form.js` | Webview form giao hàng (State 3) |
| `backend/db/chatDB.js` | DB layer cho chat |
| `backend/queues/chatQueue.js` | BullMQ queue, delay 7s |
| `ai-service/app/routers/chat.py` | AI endpoints |
| `ai-service/app/services/chat_llm_service.py` | LLM prompts + functions |
| `ai-service/app/services/llm_service.py` | LLM extraction cho crawl |
| `frontend/src/pages/ChatPage.jsx` | UI chat 3 cột |
| `frontend/src/components/chat/CustomerPanel.jsx` | Panel phải — stage badge + đơn |
| `frontend/vite.config.js` | Proxy config |

---

## Lệnh test

```bash
# Xóa session test
docker compose exec backend node -e "
const { pool } = require('./db/migrate');
pool.query('DELETE FROM chat_sessions').then(r => { console.log('Deleted', r.rowCount); process.exit(0); });
"

# Xem session mới nhất
docker compose exec backend node -e "
const { pool } = require('./db/migrate');
pool.query(\`SELECT s.id, s.intent, s.product_confirmed, s.variant_confirmed,
  s.consulting_turns, s.identified_product->>'name' AS product, s.product_variants
  FROM chat_sessions s ORDER BY s.last_message_at DESC LIMIT 1\`).then(async r => {
  const s = r.rows[0]; console.log('SESSION:', JSON.stringify(s));
  const msgs = await pool.query(\`SELECT sender_type, content FROM chat_messages
    WHERE session_id = '\${s.id}' ORDER BY created_at ASC\`);
  msgs.rows.forEach((m,i) => console.log(i+1+'.','['+m.sender_type+']',m.content?.slice(0,200)));
  process.exit(0);
});
"
```
