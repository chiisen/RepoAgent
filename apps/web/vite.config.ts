import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 勿用 public/：那裡是 Express fallback 的 index.html，複製進 dist 會蓋掉 React 建置產物
  publicDir: 'static',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
