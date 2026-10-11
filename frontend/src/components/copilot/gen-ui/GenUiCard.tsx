/**
 * frontend/src/components/copilot/gen-ui/GenUiCard.tsx
 *
 * BLOCK-166 [B 层] 聊天流内嵌 Gen UI 卡片：
 * P0：prepare IPC（主进程 workspace 归属/1MB 校验返回沙箱页 URL）→ 独立 origin
 *     iframe 渲染 → guest 高度回报（240..10000px + 5px gutter）。
 * P1：guest 桥 RPC 中继（D6 简化传输）——guest 的 petri-gen-ui-rpc 经本组件校验
 *     source/origin 后转 desktopBridge（setState / openExternal），结果回投 iframe；
 *     应用主题（html[data-theme]）经 petri-set-globals 推送进沙箱页。
 * P2：放大预览（锚点迁移不重载——iframe DOM 节点在卡片锚点与覆盖层间搬移，
 *     D5 bind/unbind）+ 复制图片（可视区域几何 → gen-ui:copy-image → capturePage
 *     → 原生剪贴板）+ follow-up 追问 relay（petri/gen-ui/follow-up → 宿主回调）。
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { getBridge } from '@/lib/desktopBridge';
import type { GenUiReference } from './schema';
import type { GenUiFollowUpRequest, GenUiFollowUpResult } from './followUp';
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
  /** P2 follow-up 宿主回调（SimpleChat 输入绑定执行；缺席时 guest 收到明确拒绝）。 */
  onFollowUp?: (request: GenUiFollowUpRequest) => Promise<GenUiFollowUpResult>;
}

interface GenUiRpcMessage {
  type: 'petri-gen-ui-rpc';
  id: number;
  method: string;
  params?: { state?: unknown; href?: unknown; prompt?: unknown; title?: unknown };
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
  onFollowUp,
}: GenUiCardProps) {
  const [result, setResult] = React.useState<GenUiPrepareResult | null>(null);
  const [height, setHeight] = React.useState<number>(HEIGHT_MIN);
  const [zoomed, setZoomed] = React.useState<boolean>(false);
  const [copyNotice, setCopyNotice] = React.useState<string>('');
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const anchorRef = React.useRef<HTMLDivElement | null>(null);
  const overlayContentRef = React.useRef<HTMLDivElement | null>(null);
  // 沙箱身份（prepare 成功后固定）：sessionId 用于 IPC 鉴权，origin 用于消息双向校验。
  const sandbox = React.useMemo(
    () => (result?.ok ? parseSandboxUrl(result.url) : null),
    [result],
  );

  React.useEffect(() => {
    let cancelled = false;
    setResult(null);
    setZoomed(false);
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
      } else if (rpc.method === 'petri/gen-ui/follow-up') {
        // P2 follow-up：宿主回调缺席 = 绑定不可用（明确拒绝，规格 §8）。
        if (typeof onFollowUp !== 'function') {
          reply(false, { message: 'follow-up binding unavailable (read-only)' });
          return;
        }
        const outcome = await onFollowUp({
          prompt: typeof rpc.params?.prompt === 'string' ? rpc.params.prompt : '',
          title: typeof rpc.params?.title === 'string' ? rpc.params.title : undefined,
          messageConversationId: conversationId,
        });
        if (outcome.ok) reply(true, {});
        else reply(false, { message: outcome.reason || 'follow-up rejected' });
      } else {
        reply(false, { message: `unknown gen-ui rpc method: ${rpc.method}` });
      }
    } catch (error) {
      reply(false, { message: error instanceof Error ? error.message : String(error) });
    }
  }, [postToFrame, sandbox, onFollowUp, conversationId]);

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

  // P2 放大预览（锚点迁移）：把同一 iframe DOM 节点在卡片锚点与覆盖层间搬移，
  // 不重建不重导航 → 交互状态与页面实例完整保留（D5 bind/unbind 接口）。
  React.useLayoutEffect(() => {
    if (!result?.ok) return;
    const node = frameRef.current;
    if (!node) return;
    const target = zoomed ? overlayContentRef.current : anchorRef.current;
    if (target && node.parentElement !== target) target.appendChild(node);
  }, [zoomed, result]);

  const onFrameLoad = React.useCallback(() => {
    const theme = currentAppTheme();
    if (theme) postToFrame({ type: 'petri-set-globals', detail: { globals: { theme } } });
  }, [postToFrame]);

  const onToggleZoom = React.useCallback(() => {
    setZoomed((current) => !current);
  }, []);

  const onCopyImage = React.useCallback(() => {
    const bridge = getBridge('genUi');
    const rectEl = anchorRef.current;
    if (!bridge || !sandbox || !rectEl) return;
    const rect = rectEl.getBoundingClientRect();
    setCopyNotice('');
    bridge
      .copyImage({
        sessionId: sandbox.sessionId,
        rect: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      })
      .then((res: { ok: boolean; message?: string; code?: string }) => {
        setCopyNotice(res.ok ? '已复制到剪贴板' : `复制失败：${res.message || res.code || '未知原因'}`);
        setTimeout(() => setCopyNotice(''), 2500);
      })
      .catch(() => {
        setCopyNotice('复制失败：IPC 错误');
        setTimeout(() => setCopyNotice(''), 2500);
      });
  }, [sandbox]);

  const title = reference.title || '可视化';

  const toolbar = result?.ok ? (
    <>
      {copyNotice ? <span className={styles.copyNotice}>{copyNotice}</span> : null}
      <button
        type="button"
        className={styles.toolbarBtn}
        onClick={onCopyImage}
        title="复制可视化画面到剪贴板"
      >
        复制图
      </button>
      <button
        type="button"
        className={styles.toolbarBtn}
        onClick={onToggleZoom}
        title={zoomed ? '还原到聊天流' : '放大预览（不重载页面）'}
      >
        {zoomed ? '还原' : '放大'}
      </button>
    </>
  ) : null;

  const frame = result?.ok ? (
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
  ) : null;

  return (
    <div
      className={`${styles.card}${reference.mode === 'wide' ? ` ${styles.cardWide}` : ''}`}
      data-testid="gen-ui-card"
    >
      <div className={styles.header}>
        <span className={styles.headerTitle}>{title}</span>
        {result?.ok ? <span className={styles.badge}>沙箱页面</span> : null}
        {/* 放大期间工具钮随 iframe 迁入覆盖层头部，避免双份还原/复制入口。 */}
        {!zoomed ? toolbar : null}
      </div>
      <div className={styles.body}>
        {result === null ? (
          <div className={styles.placeholder}>正在加载可视化…</div>
        ) : result.ok ? (
          <div
            ref={anchorRef}
            className={styles.frameWrap}
            style={{ height: height + 10 }}
          >
            {/* iframe 常驻 React 树（锚点位）；放大期间由 layout effect 把 DOM 节点
                搬移到覆盖层（节点身份不变=不重载），锚点留占位保持行高。 */}
            {frame}
            {zoomed ? (
              <div className={styles.zoomPlaceholder}>可视化页已在放大预览中打开</div>
            ) : null}
          </div>
        ) : (
          <div className={styles.errorBox} role="alert">
            <span>{ERROR_TEXT[result.code]}</span>
            <span className={styles.errorHint}>{reference.path}</span>
          </div>
        )}
      </div>
      {zoomed && result?.ok
        ? createPortal(
            <div className={styles.overlay} role="dialog" aria-label={`${title} 放大预览`} data-testid="gen-ui-overlay">
              <div className={styles.overlayHeader}>
                <span className={styles.overlayTitle}>{title}</span>
                {toolbar}
              </div>
              <div ref={overlayContentRef} className={styles.overlayContent} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});
