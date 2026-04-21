# Test Scenario: Post Embedding vào Qdrant

**Tính năng:** Sau khi crawl bài bán hàng, text post phải được embed bằng MiniLM-L12-v2 và lưu vào Qdrant collection `post_embeddings`.

---

## Cần chuẩn bị trước

- Docker đang chạy: `docker compose up -d`
- AI service healthy: `GET http://localhost:8000/health`
- Có `page_id` và `user_id` thật để dùng bên dưới

---

## Scenario 1: Full flow — delete → crawl → check Qdrant

### Bước 1: Xoá data cũ
Xoá toàn bộ data của user trong Qdrant (cả 2 collections) và PostgreSQL:

```
DELETE http://localhost:5000/api/intelligence/data/{user_id}
```

Verify Qdrant sạch:
```
GET http://localhost:6333/collections/post_embeddings/points/count
→ result.count == 0
```

### Bước 2: Crawl page
Trigger crawl để fetch posts từ Facebook:

```
POST http://localhost:5000/api/intelligence/crawl
Body: { "pageId": "<page_id>" }
```

Theo dõi SSE hoặc chờ job complete.

### Bước 3: Check Qdrant có data chưa
```
GET http://localhost:6333/collections/post_embeddings/points/count
→ result.count > 0
```

### Bước 4: Verify metadata đúng
Scroll một vài points và kiểm tra payload có đủ fields:

```
POST http://localhost:6333/collections/post_embeddings/points/scroll
Body: {
  "limit": 5,
  "with_payload": true,
  "with_vector": false
}
```

Mỗi point phải có:
- `user_id` ✓
- `page_id` ✓
- `post_id` ✓
- `product_name` ✓ (nếu là sale post)
- `product_id` ✓
- `is_sale_post: true` ✓
- `current_price` ✓ (nếu LLM extract được)

---

## Ghi chú
- Text embed là **fire-and-forget** — crawl xong không có nghĩa là embed xong ngay, chờ thêm vài giây
- Chỉ embed các post có `is_sale_post != false`
- Nếu count vẫn = 0 sau 30s → check log ai-service: `docker compose logs ai-service`
