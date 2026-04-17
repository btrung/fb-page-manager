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

  getProducts: ({ limit = 50, offset = 0, search = '' } = {}) =>
    api.get('/api/intelligence/products', { params: { limit, offset, search } }),

  getPosts: ({ pageId, saleOnly = false, limit = 50, offset = 0 } = {}) =>
    api.get('/api/intelligence/posts', { params: { pageId, saleOnly, limit, offset } }),

  getLogs: (pageId, limit = 20) =>
    api.get('/api/intelligence/logs', { params: { pageId, limit } }),

  getDebugDb: () =>
    api.get('/api/intelligence/debug/db'),

  retryEmbeddings: () =>
    api.post('/api/intelligence/retry-embeddings'),
};

export default api;
