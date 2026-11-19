import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // ใช้ไฟล์ใน ../shared ร่วมกับเซิร์ฟเวอร์
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:3000',
      '/app-config.js': 'http://localhost:3000',
    },
  },
});
