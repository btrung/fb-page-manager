# Frontend

## Làm gì
Toàn bộ cấu trúc UI: navigation, routes, các trang, trạng thái hiện tại. Đọc trước khi làm bất kỳ thay đổi UI/routing nào.

## Flow hiện tại

### Navigation — Navbar cố định ở trên

```
┌────────────────────────────────────────────────────────────────────┐
│  FB Page Manager  │ [🧠 AI Học] [💬 Hội Thoại] [📺 Livestream] [⚙️ Cài đặt] │  👤 [Đăng xuất]
└────────────────────────────────────────────────────────────────────┘
```

| Tab | Route | Trang | Trạng thái |
|---|---|---|---|
| 🧠 AI Học | `/pages/:pageId/intelligence` | IntelligencePage | ✅ Hoàn chỉnh |
| 💬 Hội Thoại | `/chat` | ChatPage | ✅ Hoạt động, đang user test |
| 📺 Livestream | `/livestream` | LivestreamPage | 🔨 Chưa code |
| ⚙️ Cài đặt | `/settings` | SettingsPage | ✅ Hoạt động |

### Routes

| Route | Component | Auth |
|---|---|---|
| `/` | → redirect `/dashboard` | — |
| `/login` | LoginPage | Public only |
| `/dashboard` | DashboardPage | Private |
| `/pages/:pageId/posts` | PostsPage | Private |
| `/pages/:pageId/intelligence` | IntelligencePage | Private |
| `/chat` | ChatPage | Private |
| `/settings` | SettingsPage | Private |
| `/livestream` | LivestreamPage | Private (chưa tạo) |
| `*` | → redirect `/` | — |

### File structure hiện tại

```
frontend/src/
├── App.jsx
├── main.jsx
├── context/
│   └── AuthContext.jsx          — Facebook OAuth session
├── components/
│   ├── Navbar.jsx               — 4 tabs: AI Học / Hội Thoại / Livestream / Cài đặt
│   ├── LoadingSpinner.jsx
│   ├── PostCard.jsx
│   ├── PageCard.jsx
│   └── chat/
│       ├── ConversationList.jsx — danh sách hội thoại + filter + sort
│       ├── ChatView.jsx         — khung chat + AI Mode toggle
│       └── CustomerPanel.jsx    — 2 tab: Thông tin khách / Đã Chốt + stage badge
└── pages/
    ├── LoginPage.jsx
    ├── DashboardPage.jsx
    ├── PostsPage.jsx
    ├── IntelligencePage.jsx
    ├── ChatPage.jsx             — layout 3 cột
    └── SettingsPage.jsx         — toggle AI + active hours per fanpage
```

### File structure sau khi xong Livestream

```
frontend/src/
├── ...
├── components/
│   └── livestream/
│       ├── LiveSessionList.jsx  — cột trái: danh sách phiên live
│       ├── CommentFeed.jsx      — cột giữa: comment + filter tabs
│       ├── CommentDetail.jsx    — cột phải: detail + hành trình khách
│       └── LiveSettingsModal.jsx — modal cài đặt AI
└── pages/
    └── LivestreamPage.jsx       — layout 3 cột
```

## Schema / Config

### Design system
- **Framework:** React + Vite
- **Styling:** Tailwind CSS
- **Color chính:** `facebook-blue` (custom Tailwind)
- **Icons:** emoji (không dùng icon library)
- **Responsive:** desktop-first, chưa tối ưu mobile

### Proxy (vite.config.js)
Forward `/api`, `/form`, `/webhook` → backend port 5000

## Edge cases

- `CustomerPanel.jsx` có 2 tab: "Thông tin khách" (luôn có) + "Đã Chốt" (chỉ hiện khi session có `AI_CLOSED`)
  - Mặc định mở tab "Đã Chốt" nếu session đã chốt
- Stage badge trong CustomerPanel: 5 giai đoạn theo state machine chat
- ConversationList sort: `Dừng` lên đầu → `Muốn Mua/Đang Tư Vấn` → `Khách Đùa` → `Không Nhu Cầu`
- Real-time update: SSE hoặc polling 3s
- Notification badge đỏ trên tab 💬: đếm session `Dừng`, poll 15s

## Nâng cấp tiếp theo

- LivestreamPage + 4 components (xem `tasks/features/livestream-reply.md`)
- Tối ưu responsive mobile
