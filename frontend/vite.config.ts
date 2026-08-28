import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import path from 'path';
import fs from 'fs';

// BioF3 桌面版原生前端 — Vite SPA
// 脱离 Docusaurus，纯客户端渲染，无 SSG/hydration
// 阶段 2：MDX 原生渲染 docs（替代 iframe）；blog 已从桌面端移除

// 从 md/mdx 源码提取标题：frontmatter title → 正文第一个 H1 → 文件名兜底
function extractDocTitle(source: string, fallbackId: string): string {
  const fm = source.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const m = fm[1].match(/^title:\s*(.+)$/m);
    if (m) return m[1].trim().replace(/^['"]|['"]$/g, '');
  }
  // 去掉 frontmatter 后再找 H1，避免 frontmatter 里误匹配
  const body = source.replace(/^---\n[\s\S]*?\n---/, '');
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return fallbackId;
}

// 从 frontmatter 提取 sidebar_position（默认 999 排末尾）
function extractSidebarPosition(source: string): number {
  const fm = source.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return 999;
  const m = fm[1].match(/^sidebar_position:\s*(\d+(?:\.\d+)?)/m);
  return m ? parseFloat(m[1]) : 999;
}

// 虚拟模块：build 时扫描 docs/ 生成完整 sidebar 树
// - 分类：docs/<cat>/_category_.json 的 label + position（无 _category_ 则用目录名，position 999）
// - 文章：frontmatter title / 正文 H1 当标题，sidebar_position 排序
// - 跳过 _ 前缀文件（_contributing / _meta-spec 等 Docusaurus 约定的隐藏页）
// - 根目录散落的文章（如 intro.md）归到 position 最小的"入门"分类
function docsSidebarPlugin() {
  const virtualId = 'virtual:biof3-docs-sidebar';
  const resolvedId = '\0' + virtualId;
  return {
    name: 'biof3-docs-sidebar',
    resolveId(id: string) {
      if (id === virtualId) return resolvedId;
    },
    load(id: string) {
      if (id !== resolvedId) return;
      const docsDir = path.resolve(__dirname, '..', '..', 'docs');
      interface DocItem {
        id: string;
        title: string;
        position: number;
      }
      interface DocCategory {
        id: string;
        label: string;
        position: number;
        items: DocItem[];
      }
      // 分仓后 docs/ 可能不在本仓（教程内容已移至 tutorials 仓）。
      // 构建时找不到 docs 目录则返回空树，docs 页仅靠运行时 content-plugin 提供内容。
      if (!fs.existsSync(docsDir)) {
        return 'export default { root: [], categories: [] };';
      }
      // 非组学教程目录（工程/运维内部文档），不进 sidebar 也不编译
      const EXCLUDED_DIRS = ['dev', 'ops'];
      // docs 根目录下的工程/运维文档（非组学教程），同样排除
      const EXCLUDED_ROOT_FILES = [
        'ARCH-api-worker.md',
        'architecture-target.md',
        'ops-c3-acceptance.md',
        'ops-pg-cutover-runbook.md',
        'ops-phase-b.md',
        'ops-phase-cd-roadmap.md',
        'ops-platform-api-split.md',
        'ops-postgres-migration.md',
      ];
      const isExcluded = (dir: string) => EXCLUDED_DIRS.includes(dir);
      const isExcludedRoot = (file: string) => EXCLUDED_ROOT_FILES.includes(file);
      const categories: DocCategory[] = [];

      // 根目录散落的文章（intro.md 等）
      const rootItems: DocItem[] = [];
      for (const f of fs.readdirSync(docsDir).filter((f) => /^[\w-]+\.(md|mdx)$/.test(f))) {
        if (f.startsWith('_') || isExcludedRoot(f)) continue;
        const raw = fs.readFileSync(path.join(docsDir, f), 'utf-8');
        const docId = f.replace(/\.(md|mdx)$/, '');
        rootItems.push({
          id: docId,
          title: extractDocTitle(raw, docId),
          position: extractSidebarPosition(raw),
        });
      }

      // 各子目录
      for (const dir of fs
        .readdirSync(docsDir)
        .filter(
          (d) =>
            fs.statSync(path.join(docsDir, d)).isDirectory() && !d.startsWith('.') && !isExcluded(d)
        )) {
        const dirPath = path.join(docsDir, dir);
        // 分类元数据
        const catPath = path.join(dirPath, '_category_.json');
        let label = dir;
        let catPos = 999;
        if (fs.existsSync(catPath)) {
          try {
            const cat = JSON.parse(fs.readFileSync(catPath, 'utf-8'));
            label = cat.label || dir;
            catPos = typeof cat.position === 'number' ? cat.position : 999;
          } catch {
            /* 用默认 */
          }
        }
        const items: DocItem[] = [];
        for (const f of fs.readdirSync(dirPath).filter((f) => /\.mdx?$/.test(f))) {
          if (f.startsWith('_')) continue; // 跳过 _meta 等隐藏页
          const raw = fs.readFileSync(path.join(dirPath, f), 'utf-8');
          const docId = `${dir}/${f.replace(/\.(md|mdx)$/, '').replace(/\/index$/, '')}`;
          items.push({
            id: docId,
            title: extractDocTitle(raw, docId),
            position: extractSidebarPosition(raw),
          });
        }
        items.sort((a, b) => a.position - b.position);
        if (items.length > 0) categories.push({ id: dir, label, position: catPos, items });
      }

      // 根文章归到 position 最小的分类前（作为独立"入门"组）
      const tree = {
        root: rootItems.sort((a, b) => a.position - b.position),
        categories: categories.sort((a, b) => a.position - b.position),
      };
      return `export default ${JSON.stringify(tree)};`;
    },
  };
}

export default defineConfig({
  plugins: [
    docsSidebarPlugin(),
    // MDX 插件必须在 react 之前，让 .mdx/.md 能被转成 JSX
    mdx({
      // GFM 表格/删除线/任务列表 + frontmatter 识别剥离（否则 ---...--- 被当正文渲染）
      remarkPlugins: [remarkGfm, remarkFrontmatter],
      // 代码高亮 + 安全 sanitize
      rehypePlugins: [rehypeHighlight, rehypeSanitize],
      // provider 注入自定义组件（DownloadButton/TryOnline 等）
      providerImportSource: '@mdx-js/react',
    }),
    react(),
  ],
  // 桌面端通过本地 HTTP 根路径托管。使用绝对根路径可保证
  // /project/:id 等深层路由直接刷新时仍从 /assets 加载资源。
  base: '/',
  // 静态资源根：指向 desktop 仓根 static/，让 docs/blog 里的 /img/... 路径
  // 直接解析到 static/img/...（Docusaurus 的 static 目录约定）
  // 分仓后 frontend/ 在 desktop/frontend/（一层深），只需往上一层到 desktop/
  publicDir: path.resolve(__dirname, '..', 'static'),
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
      // Copilot 等组件从 Web 版原样移植，import '@site/src/...' 整体映射到桌面版 src
      '@site/src': path.resolve(__dirname, 'src'),
      // CopilotChat 用 useBaseUrl（Docusaurus），桌面版 SPA 无 baseUrl，mock 成恒等
      '@docusaurus/useBaseUrl': path.resolve(__dirname, 'src/lib/useBaseUrl-mock.ts'),
      // 双前端收敛（agent-led 阶段2 Task1）：Copilot 纯逻辑层共享包
      // 去 submodule 后：@biof3/shared 内嵌在 desktop 仓根 core/packages/shared-copilot
      '@biof3/shared': path.resolve(__dirname, '..', 'core', 'packages', 'shared-copilot'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  optimizeDeps: {
    entries: ['./src/main.tsx'],
  },
  server: {
    port: 3000,
    strictPort: true,
    warmup: {
      clientFiles: [
        './index.html',
        './src/main.tsx',
      ],
    },
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
