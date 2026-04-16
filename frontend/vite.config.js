import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': {
        target: BACKEND_URL,
        changeOrigin: false,
        secure: false,
      },
      '/api': {
        target: BACKEND_URL,
        changeOrigin: false,
        secure: false,
      },
    },
  },
});
