/**
 * DocsFrame — docs 内容 iframe 过渡方案
 *
 * 阶段 2 前的过渡：用 iframe 嵌入 Docusaurus build 产物（:3003）。
 * Docusaurus build 已由 main.js 的 docs-server 启动。
 *
 * 阶段 2 将替换为 @mdx-js 原生渲染，消除 iframe。
 */

import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const DOCS_BASE = 'http://localhost:3003/BioF3';

export default function DocsFrame(): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  // /docs/intro → docs/intro
  const docsPath = location.pathname.replace(/^\/docs/, '') || '/intro';
  const src = `${DOCS_BASE}/docs${docsPath}`;

  // 监听 iframe 内部导航，同步到 SPA 路由（让 dock/导航面板高亮正确）
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== 'http://localhost:3003') return;
      if (e.data?.type === 'biof3:docs-nav' && e.data?.path) {
        navigate(e.data.path);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate]);

  return (
    <div className="biof3-docs-frame-wrap">
      {!loaded && (
        <div className="biof3-docs-frame-loading">
          <span>文档加载中…</span>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={src}
        title="BioF3 文档"
        className="biof3-docs-frame"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
