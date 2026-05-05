import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,        // bind to 0.0.0.0 so phones/other devices on LAN can reach it
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  preview: {
    host: true,        // same for the production preview server
    port: 5173,
  },
});
