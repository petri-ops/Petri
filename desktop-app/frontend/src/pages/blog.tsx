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
      <main className="biof3-docs-main" style={{ maxWidth: 820 }}>
        <h1 style={{ fontSize: '1.9rem', marginBottom: 24 }}>BioF3 博客</h1>
        {posts.length === 0 && <div className="biof3-docs-loading">暂无文章</div>}
        {posts.length > 0 && (
          <div>
            {posts.map((post) => (
              <Link
                key={post.slug}
                to={`/blog/${post.slug}`}
                style={{
                  display: 'block',
                  padding: '16px 20px',
                  marginBottom: 12,
                  borderRadius: 10,
                  border: '1px solid var(--ifm-color-emphasis-200, #e2e8f0)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 4 }}>
                  {post.title}
                </div>
                {post.description && (
                  <div style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: 6 }}>
                    {post.description}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, fontSize: '0.78rem', color: '#94a3b8' }}>
                  {post.date && <span>{post.date}</span>}
                  {post.tags.length > 0 && <span>#{post.tags.slice(0, 3).join(' #')}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function BlogDetail({ slug }: { slug: string }): React.ReactElement {
  const [Content, setContent] = useState<React.ComponentType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

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

  return (
    <div className="biof3-docs-layout">
      <main className="biof3-docs-main">
        <Link
          to="/blog"
          style={{ display: 'inline-block', marginBottom: 16, color: 'var(--biof3-teal, #0f766e)' }}
        >
          ← 返回博客列表
        </Link>
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
