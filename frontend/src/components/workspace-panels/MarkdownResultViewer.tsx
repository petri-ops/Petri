import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './MarkdownResultViewer.module.css';

/**
 * BLOCK-142（成果面切片 E·renderer 补课）— Markdown 产物 viewer。
 *
 * 契约（plan §1.1）：fetch 产物 URL 文本 → react-markdown ^9 渲染；
 * remarkPlugins 仅 [remark-gfm]（GFM 表格/删除线/任务列表），**不加 rehype-raw**
 * —— raw HTML 一律不渲染为元素（无 innerHTML 注入面，XSS 安全默认）；
 * 文本获取失败如实显示错误，不假渲染空壳。样式只走 --petri-* token。
 */
export function MarkdownResultViewer({ url, name }: { url: string; name: string }): React.ReactElement {
  // state 携带其取数来源的 url：切换产物时由渲染期派生「陈旧 → 加载中」，
  // effect 内不做同步 setState（react-hooks set-state-in-effect 禁级联渲染），
  // 语义不变：url 变化即回加载态并重新取数。
  const [loaded, setLoaded] = useState<{ url: string; text: string | null; error: string | null }>(() => ({
    url,
    text: null,
    error: null,
  }));
  const current = loaded.url === url ? loaded : null;

  useEffect(() => {
    let cancelled = false;
    if (!url) return undefined;
    fetch(url)
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.text();
      })
      .then((body) => {
        if (!cancelled) setLoaded({ url, text: body, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoaded({ url, text: null, error: (e as Error).message || '读取 Markdown 文件失败' });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

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
    <div className={styles.markdownBody} data-testid="markdown-viewer" aria-label={`Markdown 预览：${name}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{current.text}</ReactMarkdown>
    </div>
  );
}
