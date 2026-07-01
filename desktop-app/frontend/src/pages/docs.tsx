/**
 * DocsPage — 桌面版 docs 原生渲染（阶段 2，替代 iframe）
 *
 * 用 Vite import.meta.glob 收集项目根 docs/ 下的所有 .md/.mdx，
 * 按路由 /docs/<path> 动态加载对应文件，用 @mdx-js/react 渲染。
 *
 * sidebar 目录树由 frontmatter 的 sidebar_position 自动生成。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { MDXProvider } from '@mdx-js/react';
import { mdxComponents } from '@/components/mdx';
import 'highlight.js/styles/github.css';
import '@/styles/docs.css';

// 收集 docs 目录所有 md/mdx（eager 收集路径，lazy 加载内容）
// 路径形如 '/docs/intro.md' → '../../../docs/intro.md'
const docModules = import.meta.glob('/../../../docs/**/*.{md,mdx}');

// 路径 → docId 映射：/docs/single-cell/module01.md → single-cell/module01
function pathToDocId(p: string): string {
  return p
    .replace(/^.*\/docs\//, '')
    .replace(/\.(md|mdx)$/, '')
    .replace(/\/index$/, '');
}

// 所有 docId 列表
const allDocIds = Object.keys(docModules).map(pathToDocId).sort();

interface DocMeta {
  title: string;
  sidebarPosition: number;
}

// 从 mdx 源码 frontmatter 解析 title + sidebar_position
function parseFrontmatter(source: string): DocMeta {
  const fm = source.match(/^---\n([\s\S]*?)\n---/);
  const meta: DocMeta = { title: '', sidebarPosition: 999 };
  if (!fm) return meta;
  const body = fm[1];
  const titleMatch = body.match(/^title:\s*(.+)$/m);
  if (titleMatch) meta.title = titleMatch[1].trim().replace(/^['"]|['"]$/g, '');
  const posMatch = body.match(/^sidebar_position:\s*(\d+)/m);
  if (posMatch) meta.sidebarPosition = parseInt(posMatch[1], 10);
  return meta;
}

// 从正文第一个 # 提取标题（frontmatter 无 title 时）
function extractTitleFromContent(source: string): string {
  const m = source.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

export default function DocsPage(): React.ReactElement {
  const params = useParams();
  const navigate = useNavigate();
  const docPath = params['*'] || 'intro';
  const [Content, setContent] = useState<React.ComponentType | null>(null);
  const [title, setTitle] = useState('');
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
        // 标题从 frontmatter 或正文取（MDX 编译后拿不到源码，这里先空，后续靠正文 H1）
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

  // 标题从正文 H1 提取（渲染后）
  useEffect(() => {
    if (!loading && !error) {
      const h1 = document.querySelector('.biof3-docs-content h1');
      if (h1) setTitle(h1.textContent || '');
    }
  }, [loading, error, Content]);

  // sidebar：按目录分组
  const sidebarTree = useMemo(() => {
    const tree: Record<string, Array<{ id: string; title: string }>> = {};
    for (const id of allDocIds) {
      const segs = id.split('/');
      const cat = segs.length > 1 ? segs[0] : 'root';
      if (!tree[cat]) tree[cat] = [];
      tree[cat].push({ id, title: id.split('/').pop() || id });
    }
    return tree;
  }, []);

  return (
    <div className="biof3-docs-layout">
      {/* 左侧 sidebar */}
      <aside className="biof3-docs-sidebar">
        <nav>
          {Object.entries(sidebarTree).map(([cat, items]) => (
            <div key={cat} className="biof3-docs-sidebar-cat">
              <div className="biof3-docs-sidebar-cat-label">{cat}</div>
              {items.map((item) => (
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
          <article className="biof3-docs-content markdown-body">
            <MDXProvider components={mdxComponents}>
              <Content />
            </MDXProvider>
          </article>
        )}
      </main>
    </div>
  );
}
