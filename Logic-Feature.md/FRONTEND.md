# Frontend — FB Page Manager

> Tài liệu này mô tả toàn bộ cấu trúc frontend: navigation, các trang, routes, và trạng thái hiện tại. Đọc file này trước khi làm bất kỳ thay đổi nào về UI/routing.

---

## 🗺️ Navigation tổng quan

App có **Navbar cố định ở trên** với 3 tab chính sau khi đăng nhập:

```
┌─────────────────────────────────────────────────────────────┐
│  FB Page Manager  │ [🧠 AI Học] [💬 Hội Thoại] [⚙️ Cài đặt] │  👤 User  [Đăng xuất]
└─────────────────────────────────────────────────────────────┘
```

| Tab | Route | Trang | Trạng thái |
|---|---|---|---|
| **🧠 AI Học** | `/dashboard` → `/pages/:pageId/intelligence` | Dashboard chọn fanpage → IntelligencePage | ✅ Đã có |
| **💬 Hội Thoại** | `/chat` | ChatPage | 🔨 Đang làm (branch: chat-interface) |
| **⚙️ Cài đặt** | `/settings` | SettingsPage | 🔨 Đang làm (branch: chat-interface) |

**Lưu ý:** Navbar hiện tại (`Navbar.jsx`) chỉ có logo + user + logout. Cần thêm 3 tab trên khi làm chat-interface.

---

## 📄 Các trang hiện tại

### LoginPage — `/login`
- **File:** `frontend/src/pages/LoginPage.jsx`
- **Mô tả:** Đăng nhập bằng Facebook OAuth
- **Trạng thái:** ✅ Hoàn chỉnh

---

### DashboardPage — `/dashboard`
- **File:** `frontend/src/pages/DashboardPage.jsx`
- **Mô tả:** Hiển thị danh sách fanpage của user. Mỗi fanpage là 1 `PageCard`. Từ đây điều hướng vào Posts hoặc AI Học của từng page.
- **Components dùng:** `PageCard.jsx`
- **Điều hướng đến:**
  - `/pages/:pageId/posts` — xem bài đăng
  - `/pages/:pageId/intelligence` — AI Học fanpage
- **Trạng thái:** ✅ Hoàn chỉnh

---

### PostsPage — `/pages/:pageId/posts`
- **File:** `frontend/src/pages/PostsPage.jsx`
- **Mô tả:** Hiển thị danh sách bài đăng của 1 fanpage cụ thể
- **Components dùng:** `PostCard.jsx`
- **Trạng thái:** ✅ Hoàn chỉnh

---

### IntelligencePage — `/pages/:pageId/intelligence`
- **File:** `frontend/src/pages/IntelligencePage.jsx`
- **Mô tả:** Trang "AI Học Fanpage" — trigger crawl posts, hiển thị trạng thái học, AILevelBadge
- **Features:**
  - `AILevelBadge`: hiển thị cấp độ AI theo số bài đã học (🦴→🪨→🧑→🚀→👽)
  - Nút **"🧠 AI Học Fanpage"**: crawl 500 posts mới
  - Nút **"🔄 AI Học Lại"**: xóa data + crawl lại tự động
  - Easter egg **"🪨 Hốc Đá"**: animation chạy qua các cấp độ
  - SSE cho job status realtime
- **Trạng thái:** ✅ Hoàn chỉnh

---

## 📄 Các trang đang làm (branch: chat-interface)

### ChatPage — `/chat`
- **File:** `frontend/src/pages/ChatPage.jsx` *(chưa tạo)*
- **Mô tả:** Giao diện hội thoại AI — inbox tất cả tin nhắn từ tất cả fanpage
- **Layout:** 3 cột (Conversation List | Chat View | Customer Panel)
- **Components cần tạo:**
  - `ConversationList.jsx` — danh sách hội thoại + filter intent + sort
  - `ChatView.jsx` — khung chat + intent badge + AI Mode toggle
  - `CustomerPanel.jsx` — 2 tab: Thông tin khách / Đã Chốt
- **Chi tiết:** Xem `CHAT_FEATURE.md`
- **Trạng thái:** 🔨 Đang thiết kế

---

### SettingsPage — `/settings`
- **File:** `frontend/src/pages/SettingsPage.jsx` *(chưa tạo)*
- **Mô tả:** Cài đặt toàn hệ thống. Hiện tại có 1 sub-section:
  - **Cài đặt AI Chat:** bật/tắt AI per fanpage + cấu hình khung giờ hoạt động
- **Components cần tạo:**
  - `ChatSettingsPage.jsx` (hoặc section bên trong SettingsPage)
- **Có thể mở rộng sau:** cài đặt tài khoản, thông báo, v.v.
- **Chi tiết AI Chat settings:** Xem `CHAT_FEATURE.md` → mục Settings Page
- **Trạng thái:** 🔨 Đang thiết kế

---

## 🗂️ Cấu trúc file hiện tại

```
frontend/src/
├── App.jsx                      — Routes chính
├── main.jsx                     — Entry point
├── context/
│   └── AuthContext.jsx          — Facebook OAuth session
├── components/
│   ├── Navbar.jsx               — Header navigation (cần thêm 3 tabs)
│   ├── LoadingSpinner.jsx
│   ├── PostCard.jsx             — Card bài đăng
│   └── PageCard.jsx             — Card fanpage
└── pages/
    ├── LoginPage.jsx
    ├── DashboardPage.jsx
    ├── PostsPage.jsx
    └── IntelligencePage.jsx
```

### Sau khi hoàn thành chat-interface:
```
frontend/src/
├── ...
├── components/
│   ├── Navbar.jsx               — Có thêm 3 tab: AI Học / Hội Thoại / Cài đặt
│   └── chat/
│       ├── ConversationList.jsx
│       ├── ChatView.jsx
│       └── CustomerPanel.jsx
└── pages/
    ├── ...
    ├── ChatPage.jsx             — /chat
    └── SettingsPage.jsx         — /settings
```

---

## 🔀 Routes (App.jsx)

### Hiện tại
| Route | Component | Auth |
|---|---|---|
| `/` | → redirect `/dashboard` | — |
| `/login` | `LoginPage` | Public only |
| `/dashboard` | `DashboardPage` | Private |
| `/pages/:pageId/posts` | `PostsPage` | Private |
| `/pages/:pageId/intelligence` | `IntelligencePage` | Private |
| `*` | → redirect `/` | — |

### Sau chat-interface
| Route | Component | Auth |
|---|---|---|
| `/chat` | `ChatPage` | Private |
| `/settings` | `SettingsPage` | Private |

---

## 🎨 Design System

- **Framework:** React + Vite
- **Styling:** Tailwind CSS
- **Color chính:** `facebook-blue` (custom Tailwind color)
- **Font:** mặc định system font
- **Icons:** emoji (không dùng icon library)
- **Responsive:** chưa tối ưu mobile — hiện tại desktop-first
