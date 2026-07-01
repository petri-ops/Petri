import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// BioF3 桌面版原生前端 — Vite SPA
// 脱离 Docusaurus，纯客户端渲染，无 SSG/hydration
export default defineConfig({
  plugins: [react()],
  // Electron 通过本地 HTTP 服务器加载（file:// 下 BrowserRouter 不工作）
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    // 桌面版不需要 sourcemap 进产物（开发时 dev server 有）
    sourcemap: false,
    // chunk 分割优化 Electron 加载
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
