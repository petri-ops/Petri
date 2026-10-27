// ============================================================
// BrowserPanel — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 3124-3387 行），
// 零行为变化；主文件按既有惯例再导出保持 '@/pages/project-workspace' 导入路径兼容。
// ============================================================
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Icon } from '@/components/icons/Icon';
import { petriEvents, subscribePetriEvent } from '@/lib/events';
import { getBrowserViewportSize, isPetriLocalBrowserUrl, normalizeBrowserUrl } from '@/lib/browser-url';
import { useInvalidationStream } from '@/hooks/useInvalidationStream';
import {
  performBrowserAction,
  postActionResult,
  type BrowserActionParams,
  type WebviewActionBridge,
} from '@/lib/browser-action-bridge';
import styles from '../project-workspace.module.css';

// ============================================================
// BLOCK-105 §7 Batch-7 — Electron <webview> 最小形状（本组件实际使用的成员；
// 官方 webview TS 类型未入仓，此前 useRef<any> 是 no-unsafe-* 病根）。
// 事件对象按字段结构化定型；运行时防御（?. / typeof 守卫 / try-catch）保持原样。
// BLOCK-269 — 增 executeJavaScript/capturePage（连接器动作执行面）。
// ============================================================
interface WebviewEventLike {
  preventDefault?: () => void;
  title?: string;
  errorCode?: number | string;
  errorDescription?: string;
  url?: string;
  targetURL?: string;
}

interface WebviewLike extends HTMLElement {
  src: string;
  loadURL(url: string): void;
  getURL?(): string;
  getTitle?(): string;
  canGoBack?(): boolean;
  canGoForward?(): boolean;
  goBack(): void;
  goForward(): void;
  reload?(): void;
  executeJavaScript?(code: string): Promise<unknown>;
  capturePage?(): Promise<{ size?: { width?: number; height?: number } }>;
  addEventListener(type: string, listener: (event: WebviewEventLike) => void): void;
  removeEventListener(type: string, listener: (event: WebviewEventLike) => void): void;
}

export function BrowserPanel({
  initialUrl,
  onUrlChange,
  onNavigationStateChange,
  obscured = false,
}: {
  initialUrl: string;
  onUrlChange: (url: string) => void;
  onNavigationStateChange?: (state: { canGoBack: boolean; canGoForward: boolean }) => void;
  obscured?: boolean;
}): React.ReactElement {
  const startUrlRef = useRef(normalizeBrowserUrl(initialUrl));
  const hostRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<WebviewLike | null>(null);
  const [inputUrl, setInputUrl] = useState(() => normalizeBrowserUrl(initialUrl));
  const [frameUrl, setFrameUrl] = useState(() =>
    isPetriLocalBrowserUrl(startUrlRef.current) ? startUrlRef.current : ''
  );
  const [frameKey, setFrameKey] = useState(0);
  const [title, setTitle] = useState('浏览器');
  const [loading, setLoading] = useState(true);
  const [browserError, setBrowserError] = useState('');

  const syncWebviewViewport = useCallback(() => {
    const host = hostRef.current;
    const webview = webviewRef.current;
    if (!host || !webview) return;
    const bounds = host.getBoundingClientRect();
    const viewport = getBrowserViewportSize(bounds.width, bounds.height);
    if (!viewport) return;
    webview.style.setProperty('width', `${viewport.width}px`, 'important');
    webview.style.setProperty('height', `${viewport.height}px`, 'important');
  }, []);

  useEffect(() => {
    if (!webviewRef.current) return;
    webviewRef.current.style.visibility = obscured ? 'hidden' : 'visible';
    webviewRef.current.style.pointerEvents = obscured ? 'none' : 'auto';
    if (!obscured) {
      requestAnimationFrame(() => requestAnimationFrame(syncWebviewViewport));
    }
  }, [obscured, syncWebviewViewport]);

  const navigate = useCallback(
    (value: string) => {
      const nextUrl = normalizeBrowserUrl(value);
      startUrlRef.current = nextUrl;
      setInputUrl(nextUrl);
      onUrlChange(nextUrl);
      if (isPetriLocalBrowserUrl(nextUrl)) {
        setFrameUrl(nextUrl);
        setBrowserError('');
        setLoading(true);
        onNavigationStateChange?.({ canGoBack: false, canGoForward: false });
        return;
      }
      setFrameUrl('');
      if (webviewRef.current) {
        try {
          webviewRef.current.loadURL(nextUrl);
        } catch {
          webviewRef.current.src = nextUrl;
        }
      }
    },
    [onNavigationStateChange, onUrlChange]
  );

  useEffect(() => {
    const nextUrl = normalizeBrowserUrl(initialUrl);
    if (nextUrl !== startUrlRef.current) navigate(nextUrl);
  }, [initialUrl, navigate]);

  useEffect(() => {
    if (frameUrl) return;
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';

    const webview = document.createElement('webview') as WebviewLike;
    webview.style.border = '0';
    webview.style.display = 'flex';
    webview.setAttribute('partition', 'persist:petri-browser');
    // SEC-HARDEN — 撤掉 allowpopups（Electron 官方安全清单 #11：`<webview>` 不应允许
    // 自建窗口；默认立场就是不允许）。guest 的 window.open 因此不再生效；主进程
    // src/main/security-hardening.js 另在「每个 webContents」上装了 setWindowOpenHandler
    // 作为纵深防御（一律 deny，http(s) 交系统浏览器）。
    webview.src = startUrlRef.current;

    const syncState = () => {
      try {
        const current = typeof webview.getURL === 'function' ? webview.getURL() : webview.src;
        if (current) {
          startUrlRef.current = current;
          setInputUrl(current);
          onUrlChange(current);
        }
        if (typeof webview.getTitle === 'function') {
          setTitle(webview.getTitle() || '浏览器');
        }
        onNavigationStateChange?.({
          canGoBack: Boolean(webview.canGoBack?.()),
          canGoForward: Boolean(webview.canGoForward?.()),
        });
      } catch {
        /* noop */
      }
    };

    const onStart = () => {
      setLoading(true);
      setBrowserError('');
      webview.style.visibility = obscured ? 'hidden' : 'visible';
    };
    const onStop = () => {
      setLoading(false);
      syncWebviewViewport();
      syncState();
    };
    const onTitle = (event: WebviewEventLike) => {
      setTitle(String(event?.title || '浏览器'));
    };
    const onFail = (event: WebviewEventLike) => {
      if (Number(event?.errorCode) === -3) return;
      setLoading(false);
      setBrowserError(String(event?.errorDescription || '网页加载失败'));
      webview.style.visibility = 'hidden';
      onNavigationStateChange?.({ canGoBack: false, canGoForward: false });
    };
    const onNewWindow = (event: WebviewEventLike) => {
      event.preventDefault?.();
      const next = String(event?.url || event?.targetURL || '').trim();
      if (next) navigate(next);
    };

    webview.addEventListener('did-start-loading', onStart);
    webview.addEventListener('did-stop-loading', onStop);
    webview.addEventListener('did-navigate', onStop);
    webview.addEventListener('did-navigate-in-page', onStop);
    webview.addEventListener('page-title-updated', onTitle);
    webview.addEventListener('did-fail-load', onFail);
    webview.addEventListener('new-window', onNewWindow);

    host.appendChild(webview);
    webviewRef.current = webview;
    const resizeObserver = new ResizeObserver(syncWebviewViewport);
    resizeObserver.observe(host);
    const initialResizeFrame = requestAnimationFrame(syncWebviewViewport);
    window.addEventListener('resize', syncWebviewViewport);
    setTitle('浏览器');
    setLoading(true);

    return () => {
      try {
        webview.removeEventListener('did-start-loading', onStart);
        webview.removeEventListener('did-stop-loading', onStop);
        webview.removeEventListener('did-navigate', onStop);
        webview.removeEventListener('did-navigate-in-page', onStop);
        webview.removeEventListener('page-title-updated', onTitle);
        webview.removeEventListener('did-fail-load', onFail);
        webview.removeEventListener('new-window', onNewWindow);
      } catch {}
      cancelAnimationFrame(initialResizeFrame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncWebviewViewport);
      host.innerHTML = '';
      webviewRef.current = null;
      onNavigationStateChange?.({ canGoBack: false, canGoForward: false });
    };
  }, [frameUrl, navigate, onNavigationStateChange, onUrlChange, startUrlRef, syncWebviewViewport]);

  const goBack = useCallback(() => {
    try {
      const wv = webviewRef.current;
      if (wv?.canGoBack?.()) wv.goBack();
    } catch {}
  }, []);

  const goForward = useCallback(() => {
    try {
      const wv = webviewRef.current;
      if (wv?.canGoForward?.()) wv.goForward();
    } catch {}
  }, []);

  const reload = useCallback(() => {
    if (frameUrl) {
      setLoading(true);
      setFrameKey((value) => value + 1);
      return;
    }
    try {
      webviewRef.current?.reload?.();
    } catch {}
  }, [frameUrl]);

  useEffect(() => {
    const offBack = subscribePetriEvent(petriEvents.browserBack, () => goBack());
    const offForward = subscribePetriEvent(petriEvents.browserForward, () => goForward());
    return () => {
      offBack();
      offForward();
    };
  }, [goBack, goForward]);

  // ============================================================
  // BLOCK-269 — 连接器动作事件桥：event-bus 下发 browser-action → webview 执行 →
  // 结果 POST 回传（resolve 后端 pending）。面板未挂载/离线时收不到下发，
  // 后端 25s 超时如实报 transport_timeout（不假装操作成功）。
  // ============================================================
  const performBridgeRef = useRef<WebviewActionBridge | null>(null);

  useEffect(() => {
    performBridgeRef.current = {
      async navigate(url) {
        const webview = webviewRef.current;
        if (!webview) throw new Error('webview_not_ready');
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            webview.removeEventListener('did-navigate', done);
            webview.removeEventListener('did-navigate-in-page', done);
            webview.removeEventListener('did-fail-load', onFail);
            resolve();
          };
          const onFail = (event: WebviewEventLike) => {
            if (Number(event?.errorCode) === -3) return; // 中断态不算失败
            if (settled) return;
            settled = true;
            webview.removeEventListener('did-navigate', done);
            webview.removeEventListener('did-navigate-in-page', done);
            webview.removeEventListener('did-fail-load', onFail);
            reject(new Error(String(event?.errorDescription || 'navigation_failed')));
          };
          webview.addEventListener('did-navigate', done);
          webview.addEventListener('did-navigate-in-page', done);
          webview.addEventListener('did-fail-load', onFail);
          try {
            webview.loadURL(url);
          } catch {
            webview.src = url;
          }
          setTimeout(done, 12_000); // 慢站点兜底（loadURL 已发起即视为已投递）
        });
      },
      async executeJavaScript(code) {
        const webview = webviewRef.current;
        if (!webview || typeof webview.executeJavaScript !== 'function') {
          throw new Error('webview_not_ready');
        }
        return webview.executeJavaScript(code);
      },
      async capturePage() {
        const webview = webviewRef.current;
        if (!webview || typeof webview.capturePage !== 'function') {
          throw new Error('webview_not_ready');
        }
        return webview.capturePage();
      },
    };
  }, []);

  useInvalidationStream(true, (info) => {
    if (info.domain !== 'browser-connector') return;
    const payload = info.payload as { kind?: string; actionId?: string; params?: BrowserActionParams } | undefined;
    if (!payload || payload.kind !== 'browser-action' || !payload.actionId || !payload.params) return;
    const bridge = performBridgeRef.current;
    if (!bridge) {
      void postActionResult(payload.actionId, { ok: false, error: 'webview_not_ready' });
      return;
    }
    void performBrowserAction(payload.params, bridge)
      .then((outcome) => postActionResult(payload.actionId as string, outcome));
  });

  const submitUrl = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      navigate(inputUrl);
    },
    [inputUrl, navigate]
  );

  return (
    <div className={`${styles.browserPanel} ${obscured ? styles.browserPanelObscured : ''}`}>
      <div className={styles.browserPanelHead}>
        <div className={styles.browserPanelControls}>
          <button type="button" className={styles.browserControlBtn} onClick={goBack} title="后退">
            <Icon name="arrow-left" size={14} />
          </button>
          <button type="button" className={styles.browserControlBtn} onClick={goForward} title="前进">
            <Icon name="chevron-right" size={14} />
          </button>
          <button type="button" className={styles.browserControlBtn} onClick={reload} title="刷新">
            <Icon name="refresh" size={14} />
          </button>
        </div>
        <form className={styles.browserUrlBar} onSubmit={submitUrl}>
          <input
            value={inputUrl}
            onChange={(event) => setInputUrl(event.target.value)}
            placeholder="输入网址或搜索词"
            spellCheck={false}
          />
          <button type="submit" className={styles.browserGoBtn}>
            打开
          </button>
        </form>
      </div>
      <div className={styles.browserMetaRow}>
        <span>{title}</span>
        {loading && <span>加载中…</span>}
      </div>
      {frameUrl ? (
        <iframe
          key={frameKey}
          className={styles.browserFrame}
          src={frameUrl}
          title="Petri HTML 报告"
          onLoad={() => {
            setLoading(false);
            setBrowserError('');
          }}
        />
      ) : (
        <div className={styles.browserHost} ref={hostRef} />
      )}
      {browserError && (
        <div className={styles.browserError}>
          <Icon name="globe" size={22} />
          <strong>无法打开网页</strong>
          <span>{browserError}</span>
          <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" onClick={reload}>重新加载</button>
        </div>
      )}
    </div>
  );
}
