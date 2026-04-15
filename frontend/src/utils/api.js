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

export default api;
