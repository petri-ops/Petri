import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from '../project-workspace.module.css';

/**
 * UI-400-1 — PDF 预览渲染（pdfjs-dist 本地渲染，零网络外部请求）。
 *
 * 背景：Electron 内置 PDF 查看器扩展自 33+ 依赖 chrome://resources，被扩展自身
 * CSP 拦截（script-src 'self'），<object>/<iframe> 永远空白（插件/沙箱/遮挡均排查过，
 * 结构性损坏）。pdfjs 是唯一可本地渲染的路径；动态 import 仅点开 PDF 时加载。
 * 依赖边界：pdfjs-dist 只在本文件出现，移除/替换只动这里（退出成本一层 wrapper）。
 *
 * BLOCK-219 Q6：每页 canvas 外面套一层 `data-page` 的定位盒子，供批注覆盖层挂载。
 * 覆盖层不是本组件的状态：它由 `renderPageOverlay(page)` 注入，经 portal 挂进页盒子
 * ——批注坐标因此天然是"页内相对"，不需要知道整页的滚动位置或缩放比例。
 * 缺省不传 overlay 时 DOM 结构多一层透明盒子，视觉与交互与既往一致。
 */

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;

export interface WorkspacePdfPreviewProps {
  url: string;
  name: string;
  /** 逐页渲染覆盖层（批注）；返回 null/undefined 即不挂载。 */
  renderPageOverlay?: (page: number) => React.ReactNode;
}

export function WorkspacePdfPreview({ url, name, renderPageOverlay }: WorkspacePdfPreviewProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [numPages, setNumPages] = useState(0);
  const [renderedPages, setRenderedPages] = useState(0);
  const [error, setError] = useState('');
  const [pageBoxes, setPageBoxes] = useState<Array<{ page: number; node: HTMLDivElement }>>([]);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container || !url) return;
    const wrappers: HTMLDivElement[] = [];

    void (async () => {
      let doc: PdfDoc | null = null;
      try {
        const pdfjs = await import('pdfjs-dist');
        const workerMod = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;

        doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) return;
        setNumPages(doc.numPages);
        setStatus('ready');

        const paneWidth = container.clientWidth || 640;
        for (let n = 1; n <= doc.numPages; n++) {
          if (cancelled) return;
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.max(0.4, Math.min(3, (paneWidth - 24) / base.width));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = styles.workspacePdfPage;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('canvas 2d context unavailable');
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          const wrapper = document.createElement('div');
          wrapper.className = styles.workspacePdfPageBox;
          wrapper.dataset.page = String(n);
          wrapper.appendChild(canvas);
          container.appendChild(wrapper);
          wrappers.push(wrapper);
          setPageBoxes((current) => [...current, { page: n, node: wrapper }]);
          setRenderedPages(n);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message || '未知错误');
          setStatus('error');
        }
      } finally {
        if (cancelled && doc) void doc.destroy();
      }
    })();

    return () => {
      cancelled = true;
      setPageBoxes([]);
      wrappers.forEach((wrapper) => wrapper.remove());
    };
  }, [url]);

  return (
    <div className={styles.workspacePdfScroll} data-testid="pdf-preview" aria-label={`PDF 预览：${name}`}>
      {status === 'loading' && <p className={styles.panelEmpty}>解析 PDF…</p>}
      {status === 'error' && <p className={styles.panelEmpty}>PDF 渲染失败：{error}</p>}
      {status === 'ready' && (
        <div className={styles.workspacePdfMeta} data-testid="pdf-progress">
          {renderedPages < numPages ? `渲染中 ${renderedPages}/${numPages} 页` : `共 ${numPages} 页`}
        </div>
      )}
      <div ref={containerRef} className={styles.workspacePdfPages} />
      {renderPageOverlay
        ? pageBoxes.map(({ page, node }) => createPortal(renderPageOverlay(page), node, `page-overlay-${page}`))
        : null}
    </div>
  );
}
