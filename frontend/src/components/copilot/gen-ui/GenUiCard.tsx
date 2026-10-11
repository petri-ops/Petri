/**
 * frontend/src/components/copilot/gen-ui/GenUiCard.tsx
 *
 * BLOCK-166 [B 层] 聊天流内嵌 Gen UI 卡片：
 * P0：prepare IPC（主进程 workspace 归属/1MB 校验返回沙箱页 URL）→ 独立 origin
 *     iframe 渲染 → guest 高度回报（240..10000px + 5px gutter）。
 * P1：guest 桥 RPC 中继（D6 简化传输）——guest 的 petri-gen-ui-rpc 经本组件校验
 *     source/origin 后转 desktopBridge（setState / openExternal），结果回投 iframe；
 *     应用主题（html[data-theme]）经 petri-set-globals 推送进沙箱页。
 * 放大预览/复制图/follow-up（P2）不在本版。
 */

import React from 'react';
import { getBridge } from '@/lib/desktopBridge';
import type { GenUiReference } from './schema';
import styles from './GenUiCard.module.css';

const HEIGHT_MIN = 240;
const HEIGHT_MAX = 10000;

interface GenUiPrepareOk {
  ok: true;
  url: string;
}
interface GenUiPrepareError {
  ok: false;
  code:
    | 'no-workspace'
    | 'project-not-found'
    | 'outside-scope'
    | 'file-not-found'
    | 'too-large'
    | 'read-failed'
    | 'failed';
  message: string;
}
export type GenUiPrepareResult = GenUiPrepareOk | GenUiPrepareError;

const ERROR_TEXT: Record<GenUiPrepareError['code'], string> = {
  'no-workspace': '当前会话未绑定项目工作区，无法渲染可视化页',
  'project-not-found': '未找到会话所属项目，无法定位可视化目录',
  'outside-scope': '可视化文件不在本会话的可视化目录内，已拒绝渲染',
  'file-not-found': '可视化文件不存在（模型可能尚未写入或路径不符）',
  'too-large': '可视化文件超过 1MB 上限，已拒绝渲染',
  'read-failed': '读取可视化文件失败',
  failed: '可视化页准备失败',
};

interface GenUiCardProps {
  reference: GenUiReference;
  projectId: string;
  conversationId: string | null;
  /** 卡片实例键（prepare 结果缓存键用）。 */
  cardKey: string;
}

interface GenUiRpcMessage {
  type: 'petri-gen-ui-rpc';
  id: number;
  method: string;
  params?: { state?: unknown; href?: unknown };
}

/** petri-genui://gen-<id>/index.html → { sessionId, origin }（自定协议不走 URL.origin）。 */
function parseSandboxUrl(url: string): { sessionId: string; origin: string } | null {
  const match = /^petri-genui:\/\/([^/]+)\//.exec(url);
  if (!match) return null;
  return { sessionId: match[1], origin: `petri-genui://${match[1]}` };
}

function currentAppTheme(): 'dark' | 'light' | null {
  const theme = document.documentElement.dataset.theme;
  return theme === 'dark' || theme === 'light' ? theme : null;
}

export const GenUiCard = React.memo(function GenUiCard({
  reference,
  projectId,
  conversationId,
  cardKey,
}: GenUiCardProps) {
  const [result, setResult] = React.useState<GenUiPrepareResult | null>(null);
  const [height, setHeight] = React.useState<number>(HEIGHT_MIN);
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  // 沙箱身份（prepare 成功后固定）：sessionId 用于 IPC 鉴权，origin 用于消息双向校验。
  const sandbox = React.useMemo(
    () => (result?.ok ? parseSandboxUrl(result.url) : null),
    [result],
  );

  React.useEffect(() => {
    let cancelled = false;
    setResult(null);
    if (!conversationId) {
      setResult({ ok: false, code: 'no-workspace', message: 'conversationId missing' });
      return undefined;
    }
    const bridge = getBridge('genUi');
    if (!bridge) {
      setResult({ ok: false, code: 'failed', message: 'desktop bridge unavailable' });
      return undefined;
    }
    bridge
      .prepare({ projectId, conversationId, path: reference.path, title: reference.title })
      .then((res: { ok: true; url: string } | { ok: false; code: string; message: string }) => {
        if (cancelled) return;
        if (res.ok) {
          setResult({ ok: true, url: res.url });
          return;
        }
        // 桥侧类型是宽 code:string——边界处收窄到已知集合，未知码兜底 failed。
        const knownCodes: GenUiPrepareError['code'][] = [
          'no-workspace', 'project-not-found', 'outside-scope', 'file-not-found', 'too-large', 'read-failed', 'failed',
        ];
        const code = (knownCodes as string[]).includes(res.code)
          ? (res.code as GenUiPrepareError['code'])
          : 'failed';
        setResult({ ok: false, code, message: res.message });
      })
      .catch(() => {
        if (!cancelled) setResult({ ok: false, code: 'failed', message: 'IPC error' });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, conversationId, reference.path, reference.title, cardKey]);

  const postToFrame = React.useCallback((message: unknown) => {
    const win = frameRef.current?.contentWindow;
    if (win && sandbox) win.postMessage(message, sandbox.origin);
  }, [sandbox]);

  // guest 桥 RPC → desktopBridge IPC；结果回投 iframe（D6 中继，主进程是权威裁决）。
  const relayRpc = React.useCallback(async (rpc: GenUiRpcMessage) => {
    const bridge = getBridge('genUi');
    const reply = (ok: boolean, payload: Record<string, unknown>) => {
      postToFrame({ type: 'petri-gen-ui-rpc-result', id: rpc.id, ok, payload });
    };
    if (!bridge || !sandbox) {
      reply(false, { message: 'gen-ui bridge unavailable' });
      return;
    }
    try {
      if (rpc.method === 'petri/gen-ui/state') {
        await bridge.setState({ sessionId: sandbox.sessionId, state: rpc.params?.state ?? null });
        reply(true, {});
      } else if (rpc.method === 'petri/gen-ui/open-external') {
        const href = typeof rpc.params?.href === 'string' ? rpc.params.href : '';
        const res = await bridge.openExternal({ sessionId: sandbox.sessionId, href });
        if (res.ok) reply(true, {});
        else reply(false, { message: res.message || res.code });
      } else {
        reply(false, { message: `unknown gen-ui rpc method: ${rpc.method}` });
      }
    } catch (error) {
      reply(false, { message: error instanceof Error ? error.message : String(error) });
    }
  }, [postToFrame, sandbox]);

  // guest 消息（高度回报 + 桥 RPC）：只信 source 为本卡 iframe 且 origin 为沙箱 origin 的消息。
  React.useEffect(() => {
    if (!result?.ok || !sandbox) return undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.origin !== sandbox.origin) return;
      const data = event.data as
        | { type?: string; height?: unknown }
        | GenUiRpcMessage
        | null;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'petri-gen-ui-height') {
        const value = typeof (data as { height?: unknown }).height === 'number'
          && Number.isFinite((data as { height: number }).height)
          ? (data as { height: number }).height
          : 0;
        setHeight(Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, Math.round(value))));
        return;
      }
      if (data.type === 'petri-gen-ui-rpc') {
        const rpc = data as GenUiRpcMessage;
        if (typeof rpc.id === 'number' && typeof rpc.method === 'string') {
          void relayRpc(rpc);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [result, sandbox, relayRpc]);

  // 主题推送：iframe 就绪与应用主题变化两条路径都走 petri-set-globals。
  React.useEffect(() => {
    if (!result?.ok || !sandbox) return undefined;
    const push = () => {
      const theme = currentAppTheme();
      if (theme) postToFrame({ type: 'petri-set-globals', detail: { globals: { theme } } });
    };
    push();
    const observer = new MutationObserver(push);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [result, sandbox, postToFrame]);

  const onFrameLoad = React.useCallback(() => {
    const theme = currentAppTheme();
    if (theme) postToFrame({ type: 'petri-set-globals', detail: { globals: { theme } } });
  }, [postToFrame]);

  const title = reference.title || '可视化';

  return (
    <div
      className={`${styles.card}${reference.mode === 'wide' ? ` ${styles.cardWide}` : ''}`}
      data-testid="gen-ui-card"
    >
      <div className={styles.header}>
        <span className={styles.headerTitle}>{title}</span>
        {result?.ok ? <span className={styles.badge}>沙箱页面</span> : null}
      </div>
      <div className={styles.body}>
        {result === null ? (
          <div className={styles.placeholder}>正在加载可视化…</div>
        ) : result.ok ? (
          <div className={styles.frameWrap} style={{ height: height + 10 }}>
            <iframe
              ref={frameRef}
              className={styles.frame}
              src={result.url}
              title={title}
              // allow-same-origin 让 petri-genui:// 文档保留真实 origin（任务书 §8 参考实现
              // 同款）：独立 origin 与宿主 app 互不可见，双向 postMessage 的 origin 校验
              // 才有意义；无它则 origin 退化为 opaque null，桥的 origin 校验全废。
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
              loading="lazy"
              onLoad={onFrameLoad}
            />
          </div>
        ) : (
          <div className={styles.errorBox} role="alert">
            <span>{ERROR_TEXT[result.code]}</span>
            <span className={styles.errorHint}>{reference.path}</span>
          </div>
        )}
      </div>
    </div>
  );
});
