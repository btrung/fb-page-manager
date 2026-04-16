# Deploy lên Render.com

## Bước 1 — Push code lên GitHub

```bash
git add .
git commit -m "add docker + render deployment"
git push
```

## Bước 2 — Deploy lên Render

1. Vào https://dashboard.render.com
2. Chọn **New → Blueprint**
3. Connect repo GitHub → Render tự đọc `render.yaml` và tạo 3 services

## Bước 3 — Điền Environment Variables

Sau khi services tạo xong, vào từng service điền:

### ai-chat-backend
| Key | Value |
|---|---|
| `FACEBOOK_APP_ID` | App ID từ Facebook Developers |
| `FACEBOOK_APP_SECRET` | App Secret từ Facebook Developers |
| `FACEBOOK_CALLBACK_URL` | `https://fb-page-manager.onrender.com/auth/facebook/callback` |
| `FRONTEND_URL` | `https://fb-page-manager.onrender.com` |
| `AI_SERVICE_URL` | `https://fb-page-manager-ai.onrender.com` |

> `SESSION_SECRET` và `REDIS_URL` tự động — không cần điền

### ai-chat-ai-service
| Key | Value |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key |

## Bước 4 — Cập nhật Facebook App

Vào https://developers.facebook.com → App của bạn → **Facebook Login → Settings**

Thêm vào **Valid OAuth Redirect URIs**:
```
https://fb-page-manager.onrender.com/auth/facebook/callback
```

## Bước 5 — Test

Mở `https://fb-page-manager.onrender.com` → đăng nhập Facebook

---

## Lưu ý quan trọng

- **Cold start**: Free tier tắt sau 15 phút không dùng → lần đầu mở sẽ chờ ~30 giây
- **ChromaDB**: Dữ liệu vector bị mất khi service restart (free tier không có persistent disk)
- **Tên service**: Nếu đổi tên service trong `render.yaml`, các URL sẽ thay đổi theo
