import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { useThemeOptional } from '@/themes/ThemeProvider';
import type { PackUiActionDescriptor, WorkSurfaceDescriptor } from '@/lib/workSurface/types';
import type { PackResultData } from '@/lib/workSurface/packResultData';
import {
  actionsForSurface,
  dispatchWorkSurfaceUiActionResult,
  WORK_SURFACE_UI_ACTION_EVENT,
  type WorkSurfaceUiActionDetail,
} from '@/lib/workSurface/uiActionBus';
import styles from './PackSurfaceFrame.module.css';

function packOrigin(packId: string): string {
  return `petri-pack://${packId}`;
}

export function packSurfaceUrl(descriptor: WorkSurfaceDescriptor): string | null {
  if (descriptor.kind !== 'pack-view' || !descriptor.packId || !descriptor.entry) return null;
  const encodedPath = descriptor.entry.split('/').map(encodeURIComponent).join('/');
  return `${packOrigin(descriptor.packId)}/${encodedPath}`;
}

/**
 * BLOCK-216 Q5 — pack 视图宿主。
 * 独立 origin（petri-pack://<packId>）+ sandbox；宿主只传 surface context 与
 * 白名单 ui-action，只收 ready / ui-action-result，未知消息丢弃。
 */
export function PackSurfaceFrame({
  descriptor,
  projectId,
  conversationId,
  uiActions = [],
  artifactContext = null,
  resultData = null,
}: {
  descriptor: WorkSurfaceDescriptor;
  projectId?: string | null;
  conversationId?: string | null;
  uiActions?: readonly PackUiActionDescriptor[];
  artifactContext?: Record<string, unknown> | null;
  resultData?: PackResultData | null;
}): React.ReactElement {
  const theme = useThemeOptional();
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const readyRef = React.useRef(false);
  const queuedActionsRef = React.useRef<WorkSurfaceUiActionDetail[]>([]);
  const [state, setState] = React.useState<'loading' | 'ready' | 'error' | 'unsupported'>(
    typeof window !== 'undefined' && window.petriDesktop ? 'loading' : 'unsupported'
  );
  const [error, setError] = React.useState('');
  const [retryKey, setRetryKey] = React.useState(0);
  const [lastActionResult, setLastActionResult] = React.useState<{ actionId: string; ok: boolean } | null>(null);
  const url = packSurfaceUrl(descriptor);
  const origin = descriptor.packId ? packOrigin(descriptor.packId) : '';
  const surfaceActions = React.useMemo(
    () => actionsForSurface(uiActions, descriptor.id),
    [descriptor.id, uiActions]
  );

  const sendContext = React.useCallback(() => {
    if (!url || !origin || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage({
      type: 'petri:surface-context',
      payload: {
        surfaceId: descriptor.id,
        packId: descriptor.packId,
        projectId: projectId ?? null,
        conversationId: conversationId ?? null,
        theme: theme?.resolvedTheme ?? null,
        actions: surfaceActions.map((action) => action.id),
        artifact: artifactContext,
        resultData,
      },
    }, origin);
  }, [artifactContext, conversationId, descriptor.id, descriptor.packId, origin, projectId, resultData, surfaceActions, theme?.resolvedTheme, url]);

  const postAction = React.useCallback((detail: WorkSurfaceUiActionDetail) => {
    const action = surfaceActions.find((candidate) => candidate.id === detail.actionId);
    if (!action) return;
    const target = iframeRef.current?.contentWindow;
    if (!readyRef.current || !target || !origin) {
      queuedActionsRef.current.push(detail);
      return;
    }
    target.postMessage({
      type: 'petri:ui-action',
      actionId: action.id,
      requestId: detail.requestId ?? null,
      payload: detail.payload ?? {},
    }, origin);
  }, [origin, surfaceActions]);

  const markReady = React.useCallback(() => {
    readyRef.current = true;
    setState('ready');
    sendContext();
    const queued = queuedActionsRef.current;
    queuedActionsRef.current = [];
    for (const detail of queued) postAction(detail);
  }, [postAction, sendContext]);

  // Result data arrives asynchronously after first ready; push updated context.
  React.useEffect(() => {
    if (readyRef.current) sendContext();
  }, [sendContext]);

  React.useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<WorkSurfaceUiActionDetail>).detail;
      if (!detail?.actionId) return;
      if (!surfaceActions.some((candidate) => candidate.id === detail.actionId)) return;
      postAction(detail);
    };
    window.addEventListener(WORK_SURFACE_UI_ACTION_EVENT, onAction);
    return () => window.removeEventListener(WORK_SURFACE_UI_ACTION_EVENT, onAction);
  }, [postAction, surfaceActions]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!origin || event.origin !== origin) return;
      const data = event.data as {
        type?: unknown; actionId?: unknown; requestId?: unknown; ok?: unknown; message?: unknown;
      } | null;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'petri:ready') {
        markReady();
        return;
      }
      if (data.type === 'petri:ui-action-result') {
        const actionId = typeof data.actionId === 'string' ? data.actionId : '';
        if (!actionId || !surfaceActions.some((action) => action.id === actionId)) return;
        setLastActionResult({ actionId, ok: data.ok === true });
        dispatchWorkSurfaceUiActionResult({
          actionId,
          ...(typeof data.requestId === 'string' ? { requestId: data.requestId } : {}),
          ok: data.ok === true,
          ...(typeof data.message === 'string' ? { message: data.message.slice(0, 500) } : {}),
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [markReady, origin, surfaceActions]);

  if (!url) {
    return (
      <div className={styles.frameState} data-testid="pack-surface-unsupported">
        <Icon name="puzzle" size={18} />
        <p>{descriptor.emptyState || '该领域包没有提供可挂载的视图入口。'}</p>
      </div>
    );
  }

  if (state === 'unsupported') {
    return (
      <div className={styles.frameState} data-testid="pack-surface-unsupported">
        <Icon name="puzzle" size={18} />
        <p>领域包视图需要桌面端运行环境；当前环境只显示 honest 空态。</p>
      </div>
    );
  }

  return (
    <div
      className={styles.frameHost}
      data-testid="pack-surface-frame"
      data-surface-state={state}
      data-last-action-id={lastActionResult?.actionId}
      data-last-action-ok={lastActionResult ? String(lastActionResult.ok) : undefined}
      data-result-data-status={resultData?.status}
    >
      {state === 'loading' && <p className={styles.frameLoading}>正在加载「{descriptor.title}」…</p>}
      {state === 'error' && (
        <div className={styles.frameState} role="alert">
          <Icon name="alert-circle" size={18} />
          <p>{error || '领域包视图加载失败。'}</p>
          <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={() => {
            setError('');
            setState('loading');
            readyRef.current = false;
            setRetryKey((value) => value + 1);
          }}>重试</button>
        </div>
      )}
      <iframe
        key={retryKey}
        ref={iframeRef}
        className={styles.frame}
        src={url}
        title={descriptor.title}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        data-hidden={state === 'error' ? 'true' : undefined}
        onLoad={() => {
          if (state !== 'error') markReady();
        }}
        onError={() => {
          setState('error');
          setError('领域包视图加载失败（协议或资产不可用）。');
        }}
      />
    </div>
  );
}
