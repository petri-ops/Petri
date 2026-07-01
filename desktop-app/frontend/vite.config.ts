import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import path from 'path';
import fs from 'fs';

// BioF3 桌面版原生前端 — Vite SPA
// 脱离 Docusaurus，纯客户端渲染，无 SSG/hydration
// 阶段 2：MDX 原生渲染 docs/blog（替代 iframe）

// 解析单篇 blog frontmatter（build 时跑，Node 环境）
function parseBlogFrontmatter(source: string, fallbackSlug: string, fallbackDate = '') {
  const meta = {
    slug: fallbackSlug,
    title: fallbackSlug,
    date: fallbackDate,
    authors: [] as string[],
    tags: [] as string[],
    description: '',
  };
  const fm = source.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return meta;
  const body = fm[1];
  const get = (key: string): string => {
    const m = body.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
  };
  meta.slug = get('slug') || fallbackSlug;
  meta.title = get('title') || fallbackSlug;
  meta.date = get('date') || fallbackDate;
  meta.description = get('description');
  const authorsMatch = body.match(/^authors:\s*\[([^\]]*)\]/m);
  if (authorsMatch)
    meta.authors = authorsMatch[1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
  const tagsMatch = body.match(/^tags:\s*\[([^\]]*)\]/m);
  if (tagsMatch) meta.tags = tagsMatch[1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
  return meta;
}

// 虚拟模块：build 时扫描 blog/ 目录，导出所有文章元数据（避免 ?raw 与 mdx 插件冲突）
function blogMetaPlugin() {
  const virtualId = 'virtual:biof3-blog-meta';
  const resolvedId = '\0' + virtualId;
  return {
    name: 'biof3-blog-meta',
    resolveId(id: string) {
      if (id === virtualId) return resolvedId;
    },
    load(id: string) {
      if (id !== resolvedId) return;
      const blogDir = path.resolve(__dirname, '..', '..', 'blog');
      const files = fs.readdirSync(blogDir).filter((f) => /\.mdx?$/.test(f));
      const metas = files
        .map((f) => {
          const raw = fs.readFileSync(path.join(blogDir, f), 'utf-8');
          const dateMatch = f.match(/^(\d{4}-\d{2}-\d{2})-/);
          const fallbackSlug = f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.(md|mdx)$/, '');
          return parseBlogFrontmatter(raw, fallbackSlug, dateMatch?.[1] || '');
        })
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return `export default ${JSON.stringify(metas)};`;
    },
  };
}

export default defineConfig({
  plugins: [
    blogMetaPlugin(),
    // MDX 插件必须在 react 之前，让 .mdx/.md 能被转成 JSX
    mdx({
      // GFM 表格/删除线/任务列表
      remarkPlugins: [remarkGfm],
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
    // docs/ 和 blog/ 在仓库根（frontend 的上上层），需放行 dev 模式 HTTP 访问
    // 否则浏览器懒加载 MDX 时被 403 Restricted 拦截
    fs: {
      allow: [
        // frontend 自身
        __dirname,
        // 仓库根（docs/ + blog/ 所在）
        path.resolve(__dirname, '..', '..'),
      ],
    },
  },
});
