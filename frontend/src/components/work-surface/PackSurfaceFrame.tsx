import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { useThemeOptional } from '@/themes/ThemeProvider';
import type { PackUiActionDescriptor, WorkSurfaceDescriptor } from '@/lib/workSurface/types';
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
}: {
  descriptor: WorkSurfaceDescriptor;
  projectId?: string | null;
  conversationId?: string | null;
  uiActions?: readonly PackUiActionDescriptor[];
  artifactContext?: Record<string, unknown> | null;
}): React.ReactElement {
  const theme = useThemeOptional();
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [state, setState] = React.useState<'loading' | 'ready' | 'error' | 'unsupported'>(
    typeof window !== 'undefined' && window.petriDesktop ? 'loading' : 'unsupported'
  );
  const [error, setError] = React.useState('');
  const [retryKey, setRetryKey] = React.useState(0);
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
      },
    }, origin);
  }, [artifactContext, conversationId, descriptor.id, descriptor.packId, origin, projectId, surfaceActions, theme?.resolvedTheme, url]);

  React.useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<WorkSurfaceUiActionDetail>).detail;
      if (!detail?.actionId) return;
      const action = surfaceActions.find((candidate) => candidate.id === detail.actionId);
      if (!action || !iframeRef.current?.contentWindow || !origin) return;
      iframeRef.current.contentWindow.postMessage({
        type: 'petri:ui-action',
        actionId: action.id,
        payload: detail.payload ?? {},
      }, origin);
    };
    window.addEventListener(WORK_SURFACE_UI_ACTION_EVENT, onAction);
    return () => window.removeEventListener(WORK_SURFACE_UI_ACTION_EVENT, onAction);
  }, [origin, surfaceActions]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!origin || event.origin !== origin) return;
      const data = event.data as { type?: unknown; actionId?: unknown; ok?: unknown; message?: unknown } | null;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'petri:ready') {
        setState('ready');
        sendContext();
        return;
      }
      if (data.type === 'petri:ui-action-result') {
        const actionId = typeof data.actionId === 'string' ? data.actionId : '';
        if (!actionId || !surfaceActions.some((action) => action.id === actionId)) return;
        dispatchWorkSurfaceUiActionResult({
          actionId,
          ok: data.ok === true,
          ...(typeof data.message === 'string' ? { message: data.message.slice(0, 500) } : {}),
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, sendContext, surfaceActions]);

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
    <div className={styles.frameHost} data-testid="pack-surface-frame" data-surface-state={state}>
      {state === 'loading' && <p className={styles.frameLoading}>正在加载「{descriptor.title}」…</p>}
      {state === 'error' && (
        <div className={styles.frameState} role="alert">
          <Icon name="alert-circle" size={18} />
          <p>{error || '领域包视图加载失败。'}</p>
          <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={() => {
            setError('');
            setState('loading');
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
          if (state !== 'error') {
            setState('ready');
            sendContext();
          }
        }}
        onError={() => {
          setState('error');
          setError('领域包视图加载失败（协议或资产不可用）。');
        }}
      />
    </div>
  );
}
