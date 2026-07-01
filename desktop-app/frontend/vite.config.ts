import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import remarkAdmonitions from 'remark-admonitions';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import path from 'path';

// BioF3 桌面版原生前端 — Vite SPA
// 脱离 Docusaurus，纯客户端渲染，无 SSG/hydration
// 阶段 2：MDX 原生渲染 docs/blog（替代 iframe）
export default defineConfig({
  plugins: [
    // MDX 插件必须在 react 之前，让 .mdx/.md 能被转成 JSX
    mdx({
      // GFM 表格/删除线/任务列表 + admonitions（:::note :::tip :::warning）
      remarkPlugins: [remarkGfm, remarkAdmonitions],
      // 代码高亮 + 安全 sanitize
      rehypePlugins: [rehypeHighlight, rehypeSanitize],
      // provider 注入自定义组件（DownloadButton/TryOnline 等）
      providerImportSource: '@mdx-js/react',
    }),
    react(),
  ],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // docs mdx 里 import '@site/src/components/DownloadButton' 等
      // 映射到桌面版移植的版本（去 Docusaurus 依赖）
      '@site/src/components/DownloadButton': path.resolve(
        __dirname,
        'src/components/mdx/DownloadButton'
      ),
      '@site/src/components/TryOnline': path.resolve(__dirname, 'src/components/mdx/TryOnline'),
      '@site/src/components/FigInline': path.resolve(__dirname, 'src/components/mdx/FigInline'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
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
