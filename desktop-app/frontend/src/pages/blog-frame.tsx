/**
 * BlogFrame — blog 内容 iframe 过渡方案（同 DocsFrame）
 */

import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const DOCS_BASE = 'http://localhost:3003/BioF3';

export default function BlogFrame(): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  const blogPath = location.pathname.replace(/^\/blog/, '') || '';
  const src = `${DOCS_BASE}/blog${blogPath}`;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== 'http://localhost:3003') return;
      if (e.data?.type === 'biof3:blog-nav' && e.data?.path) {
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
          <span>博客加载中…</span>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={src}
        title="BioF3 博客"
        className="biof3-docs-frame"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
