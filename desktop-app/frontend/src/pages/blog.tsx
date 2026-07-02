/**
 * BlogPage — 桌面版 blog 原生渲染（阶段 2）
 *
 * 列表页：/blog 显示所有文章卡片
 * 详情页：/blog/<slug> 渲染对应 mdx
 * 复用 docs 的 MDX 渲染管线（vite.config.ts 的 mdx 插件）。
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MDXProvider } from '@mdx-js/react';
import { mdxComponents } from '@/components/mdx';
import blogMetas from 'virtual:biof3-blog-meta';
import 'highlight.js/styles/github.css';
import '@/styles/docs.css';

// 详情页用编译后组件（走 mdx 插件）
const blogModules = import.meta.glob('/../../blog/**/*.{md,mdx}');

interface BlogMeta {
  slug: string;
  title: string;
  date: string;
  authors: string[];
  tags: string[];
  description: string;
}

// 文件名 → blogId：2024-05-06-welcome-to-biof3.md → welcome-to-biof3
function pathToBlogId(p: string): string {
  const file = p.replace(/^.*\/blog\//, '').replace(/\.(md|mdx)$/, '');
  // 去掉日期前缀 YYYY-MM-DD-
  return file.replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

export default function BlogPage(): React.ReactElement {
  const params = useParams();
  const blogSlug = params['*'];

  // 详情页
  if (blogSlug) {
    return <BlogDetail slug={blogSlug} />;
  }
  // 列表页
  return <BlogList />;
}

function BlogList(): React.ReactElement {
  // blogMetas 来自 build 时扫描的虚拟模块，已按日期降序排好
  const posts = blogMetas as BlogMeta[];

  return (
    <div className="biof3-docs-layout">
      <main className="biof3-docs-main">
        <div className="biof3-blog-list">
          <h1 className="biof3-docs-title">BioF3 博客</h1>
          {posts.length === 0 && <div className="biof3-docs-loading">暂无文章</div>}
          {posts.length > 0 && (
            <div className="biof3-blog-cards">
              {posts.map((post) => (
                <Link key={post.slug} to={`/blog/${post.slug}`} className="biof3-blog-card">
                  <div className="biof3-blog-card-title">{post.title}</div>
                  {post.description && (
                    <div className="biof3-blog-card-desc">{post.description}</div>
                  )}
                  <div className="biof3-blog-card-meta">
                    {post.date && <span className="biof3-blog-card-date">{post.date}</span>}
                    {post.tags.length > 0 && (
                      <span className="biof3-blog-card-tags">
                        {post.tags.slice(0, 3).map((t) => (
                          <span key={t} className="biof3-blog-tag">
                            {t}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function BlogDetail({ slug }: { slug: string }): React.ReactElement {
  const [Content, setContent] = useState<React.ComponentType | null>(null);
  const [title, setTitle] = useState('');
  const [toc, setToc] = useState<{ id: string; text: string; level: 2 | 3 }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTitle('');
    setToc([]);

    // 匹配 slug（文件名去日期前缀后 === slug，或 frontmatter slug 字段）
    const globKey = Object.keys(blogModules).find((k) => pathToBlogId(k) === slug);

    if (!globKey) {
      setError('文章不存在: ' + slug);
      setLoading(false);
      return;
    }

    const loader = blogModules[globKey] as () => Promise<{ default: React.ComponentType }>;
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
  }, [slug]);

  // 渲染后从 DOM 提取 H1（页面标题）+ H2/H3（右侧 TOC），与 docs 详情页一致
  useEffect(() => {
    if (loading || error) return;
    const root = document.querySelector('.biof3-docs-content');
    if (!root) return;

    const h1 = root.querySelector('h1');
    if (h1) setTitle(h1.textContent || '');

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

  // 从 blogMetas 找当前文章的元数据（标题兜底，万一 H1 没有）
  const meta = (blogMetas as BlogMeta[]).find((m) => m.slug === slug);
  const pageTitle = title || meta?.title || slug;

  return (
    <div className="biof3-docs-layout">
      <main className="biof3-docs-main">
        <Link to="/blog" className="biof3-docs-back-link">
          ← 返回博客列表
        </Link>
        {loading && <div className="biof3-docs-loading">加载中…</div>}
        {error && <div className="biof3-docs-error">{error}</div>}
        {!loading && !error && Content && (
          <div className="biof3-docs-body">
            {pageTitle && <h1 className="biof3-docs-title">{pageTitle}</h1>}
            {/* 文章元信息：日期 + 标签 */}
            {meta && (meta.date || meta.tags.length > 0) && (
              <div className="biof3-blog-meta">
                {meta.date && <span className="biof3-blog-meta-date">{meta.date}</span>}
                {meta.tags.length > 0 && (
                  <span className="biof3-blog-meta-tags">
                    {meta.tags.slice(0, 5).map((t) => (
                      <span key={t} className="biof3-blog-tag">
                        {t}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            )}
            <article className="biof3-docs-content markdown-body">
              <MDXProvider components={mdxComponents}>
                <Content />
              </MDXProvider>
            </article>
            {/* 右侧 TOC（H2/H3 大纲，与 docs 一致） */}
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
