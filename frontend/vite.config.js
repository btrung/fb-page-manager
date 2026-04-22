import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['unemerged-paroxytonic-leda.ngrok-free.dev'],
    proxy: {
      '/auth': {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: false,
      },
      '/webhook': {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: false,
      },
      '/sync': {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
