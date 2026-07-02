/**
 * DocsPage — 桌面版 docs 原生渲染（阶段 2，替代 iframe）
 *
 * 用 Vite import.meta.glob 收集项目根 docs/ 下的所有 .md/.mdx，
 * 按路由 /docs/<path> 动态加载对应文件，用 @mdx-js/react 渲染。
 *
 * sidebar 目录树由 frontmatter 的 sidebar_position 自动生成。
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MDXProvider } from '@mdx-js/react';
import { mdxComponents } from '@/components/mdx';
import docsSidebar from 'virtual:biof3-docs-sidebar';
import 'highlight.js/styles/github.css';
import '@/styles/docs.css';

// 详情页用编译后组件（走 mdx 插件）
// 负向 pattern 排除非组学教程：dev/ops 目录 + 根目录工程文档
const docModules = import.meta.glob([
  '/../../docs/**/*.{md,mdx}',
  '!/../../docs/dev/**',
  '!/../../docs/ops/**',
  '!/../../docs/ARCH-api-worker.md',
  '!/../../docs/architecture-target.md',
  '!/../../docs/ops-c3-acceptance.md',
  '!/../../docs/ops-pg-cutover-runbook.md',
  '!/../../docs/ops-phase-b.md',
  '!/../../docs/ops-phase-cd-roadmap.md',
  '!/../../docs/ops-platform-api-split.md',
  '!/../../docs/ops-postgres-migration.md',
]);

// 路径 → docId：/docs/single-cell/module01.md → single-cell/module01
function pathToDocId(p: string): string {
  return p
    .replace(/^.*\/docs\//, '')
    .replace(/\.(md|mdx)$/, '')
    .replace(/\/index$/, '');
}

interface DocItem {
  id: string;
  title: string;
  position: number;
}
interface DocsSidebarTree {
  root: DocItem[];
  categories: { id: string; label: string; position: number; items: DocItem[] }[];
}

export default function DocsPage(): React.ReactElement {
  const params = useParams();
  const docPath = params['*'] || 'intro';
  const [Content, setContent] = useState<React.ComponentType | null>(null);
  const [title, setTitle] = useState('');
  const [toc, setToc] = useState<{ id: string; text: string; level: 2 | 3 }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 加载对应 doc 的 mdx
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // 尝试匹配 docPath（支持 docs/intro, docs/single-cell/module01）
    const globKey = Object.keys(docModules).find((k) => pathToDocId(k) === docPath);

    if (!globKey) {
      setError('文档不存在: ' + docPath);
      setLoading(false);
      return;
    }

    const loader = docModules[globKey] as () => Promise<{ default: React.ComponentType }>;
    loader()
      .then((mod) => {
        if (cancelled) return;
        setContent(() => mod.default);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError('加载失败: ' + (e instanceof Error ? e.message : String(e)));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [docPath]);

  // 渲染后从 DOM 提取 H1（页面标题）+ H2/H3（右侧 TOC）
  useEffect(() => {
    if (loading || error) return;
    const root = document.querySelector('.biof3-docs-content');
    if (!root) return;

    // H1 当页面标题（提到正文流之外单独渲染）
    const h1 = root.querySelector('h1');
    if (h1) setTitle(h1.textContent || '');

    // H2/H3 当右侧 TOC，给每个标题注入 id 供锚点跳转
    const headings = Array.from(root.querySelectorAll('h2, h3')) as HTMLHeadingElement[];
    const tocItems: { id: string; text: string; level: 2 | 3 }[] = [];
    headings.forEach((h, i) => {
      if (!h.id) h.id = `toc-${i}`;
      tocItems.push({
        id: h.id,
        text: h.textContent || '',
        level: (h.tagName === 'H2' ? 2 : 3) as 2 | 3,
      });
    });
    setToc(tocItems);
  }, [loading, error, Content]);

  // sidebar：build 时虚拟模块生成（分类按 position、文章按 sidebar_position，标题取 H1/title）
  const sidebar = docsSidebar as DocsSidebarTree;

  return (
    <div className="biof3-docs-layout">
      {/* 左侧 sidebar */}
      <aside className="biof3-docs-sidebar">
        <nav>
          {sidebar.root.length > 0 && (
            <div className="biof3-docs-sidebar-cat">
              {sidebar.root.map((item) => (
                <Link
                  key={item.id}
                  to={`/docs/${item.id}`}
                  className={`biof3-docs-sidebar-item ${docPath === item.id ? 'active' : ''}`}
                >
                  {item.title}
                </Link>
              ))}
            </div>
          )}
          {sidebar.categories.map((cat) => (
            <div key={cat.id} className="biof3-docs-sidebar-cat">
              <div className="biof3-docs-sidebar-cat-label">{cat.label}</div>
              {cat.items.map((item) => (
                <Link
                  key={item.id}
                  to={`/docs/${item.id}`}
                  className={`biof3-docs-sidebar-item ${docPath === item.id ? 'active' : ''}`}
                >
                  {item.title}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* 主内容 */}
      <main className="biof3-docs-main">
        {loading && <div className="biof3-docs-loading">加载中…</div>}
        {error && <div className="biof3-docs-error">{error}</div>}
        {!loading && !error && Content && (
          <div className="biof3-docs-body">
            {/* 页面标题（H1 从正文提到此处单独渲染，与 Web 版一致） */}
            {title && <h1 className="biof3-docs-title">{title}</h1>}
            <article className="biof3-docs-content markdown-body">
              <MDXProvider components={mdxComponents}>
                <Content />
              </MDXProvider>
            </article>
            {/* 右侧 TOC（H2/H3 大纲，对齐 Web 版 .theme-doc-toc-desktop） */}
            {toc.length > 0 && (
              <aside className="biof3-docs-toc">
                <div className="biof3-docs-toc-label">本页目录</div>
                <nav>
                  {toc.map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className={`biof3-docs-toc-item biof3-docs-toc-level-${item.level}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document
                          .getElementById(item.id)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                    >
                      {item.text}
                    </a>
                  ))}
                </nav>
              </aside>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
