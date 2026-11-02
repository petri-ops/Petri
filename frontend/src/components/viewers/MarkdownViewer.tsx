import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import styles from './MarkdownViewer.module.css';

// BLOCK-334 P2 Slice A — Markdown 唯一 viewer：合并 MarkdownResultViewer（产物 URL 取数）
// 与 WorkspaceFilePreview 内联 ReactMarkdown（已取文本 + TOC/链接宿主化）。两宿主此前
// 插件集不同（文件侧 highlight+sanitize、壳侧裸 remark-gfm），统一为 gfm + highlight +
// sanitize：raw HTML 仍一律不渲染为元素（无 rehype-raw，XSS 安全默认不变）。
// 外观类名由宿主注入（className 默认回退本模块），样式归并留后续切片。

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ['className']],
    span: [...(defaultSchema.attributes?.code || []), ['className']],
    div: [...(defaultSchema.attributes?.div || []), ['className']],
  },
};

export type MarkdownViewerSource =
  | { kind: 'text'; text: string }
  | { kind: 'url'; url: string };

export function MarkdownViewer({
  source,
  name,
  className,
  bodyRef,
  components,
  testId = 'markdown-viewer',
}: {
  source: MarkdownViewerSource;
  name: string;
  /** 宿主注入外观类（如文件预览的 TOC gutter 容器）；缺省用本模块中性化样式。 */
  className?: string;
  /** 宿主持有正文 ref（文件预览 TOC 跳转查 h1-h3 用）。 */
  bodyRef?: React.Ref<HTMLDivElement>;
  /** 宿主注入的渲染映射（相对链接 → 打开文件等）。 */
  components?: React.ComponentProps<typeof ReactMarkdown>['components'];
  testId?: string;
}): React.ReactElement {
  // state 携带其取数来源的 url：切换产物时由渲染期派生「陈旧 → 加载中」，
  // effect 内不做同步 setState（react-hooks set-state-in-effect 禁级联渲染）。
  const [loaded, setLoaded] = useState<{ url: string; text: string | null; error: string | null }>(() => (
    source.kind === 'url' ? { url: source.url, text: null, error: null } : { url: '', text: source.text, error: null }
  ));
  const current = source.kind === 'text' ? { text: source.text, error: null as string | null } : (loaded.url === source.url ? loaded : null);

  useEffect(() => {
    if (source.kind !== 'url') return undefined;
    let cancelled = false;
    if (!source.url) return undefined;
    fetch(source.url)
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.text();
      })
      .then((body) => {
        if (!cancelled) setLoaded({ url: source.url, text: body, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoaded({ url: source.url, text: null, error: (e as Error).message || '读取 Markdown 文件失败' });
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (current?.error) {
    return (
      <div className={styles.markdownError} data-testid="markdown-error" role="alert">
        <strong>Markdown 读取失败</strong>
        <span>{current.error}</span>
      </div>
    );
  }
  if (current === null || current.text === null) {
    return <div className={styles.markdownLoading}>加载 Markdown…</div>;
  }
  return (
    <div
      ref={bodyRef}
      className={className ?? styles.markdownBody}
      data-testid={testId}
      aria-label={`Markdown 预览：${name}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, [rehypeSanitize, sanitizeSchema]]}
        components={components}
      >
        {current.text}
      </ReactMarkdown>
    </div>
  );
}
