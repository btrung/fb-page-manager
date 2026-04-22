import axios from 'axios';

// Dev: Vite proxy → localhost:5000
// Prod: cùng origin với backend (Render serve luôn frontend)
const api = axios.create({
  baseURL: '/',
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (
      err.response?.status === 401 &&
      !window.location.pathname.startsWith('/login') &&
      !err.config?.url?.includes('/auth/me')
    ) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const authApi = {
  getMe: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
};

export const pagesApi = {
  getPages: () => api.get('/api/pages'),
  getPosts: (pageId) => api.get(`/api/pages/${pageId}/posts`),
  checkDb: (pageId) => api.get(`/api/db/pages/${pageId}`),
  dbSummary: () => api.get('/api/db/summary'),
  analyzePosts: (pageId, posts) =>
    api.post(`/api/pages/${pageId}/analyze`, { posts }),
};

export const intelligenceApi = {
  triggerCrawl: (pageId, limit = 500) =>
    api.post('/api/intelligence/crawl', { pageId, limit }),

  getJobStatus: (jobId) =>
    api.get(`/api/intelligence/status/${jobId}`),

  getSummary: () =>
    api.get('/api/intelligence/summary'),

  getPosts: ({ pageId, saleOnly = false, limit = 50, offset = 0 } = {}) =>
    api.get('/api/intelligence/posts', { params: { pageId, saleOnly, limit, offset } }),

  getLogs: (pageId, limit = 20) =>
    api.get('/api/intelligence/logs', { params: { pageId, limit } }),

  getDebugDb: () =>
    api.get('/api/intelligence/debug/db'),

  retryEmbeddings: () =>
    api.post('/api/intelligence/retry-embeddings'),

  deleteAllData: () =>
    api.delete('/api/intelligence/data'),
};

export const chatApi = {
  getSessions: (params) => api.get('/api/chat/sessions', { params }),
  getMessages: (sessionId) => api.get(`/api/chat/sessions/${sessionId}/messages`),
  sendMessage: (sessionId, content) =>
    api.post(`/api/chat/sessions/${sessionId}/messages`, { content }),
  setAiMode: (sessionId, aiMode) =>
    api.post(`/api/chat/sessions/${sessionId}/ai-mode`, { aiMode }),
  setIntent: (sessionId, intent) =>
    api.post(`/api/chat/sessions/${sessionId}/intent`, { intent }),
  addTag: (sessionId, tag) =>
    api.post(`/api/chat/sessions/${sessionId}/tags`, { tag }),
  removeTag: (sessionId, tag) =>
    api.delete(`/api/chat/sessions/${sessionId}/tags/${encodeURIComponent(tag)}`),
  updateOrder: (orderId, status) =>
    api.put(`/api/chat/orders/${orderId}`, { status }),
  getSettings: () => api.get('/api/chat/settings'),
  updateSettings: (pageId, data) => api.put(`/api/chat/settings/${pageId}`, data),
};

export default api;
