import React from 'react';
import { getBridge } from '@/lib/desktopBridge';

/**
 * BLOCK-447 — MCP App 页面卡片（自动渲染 + 双向 RPC）。
 *
 * 外部 MCP 工具结果携带 `_meta.ui.resourceUri` 时，本组件自动调用主进程
 * `gen-ui:prepare-mcp-app` 把资源 HTML 装进 `petri-genui://` 沙箱会话，
 * 再把沙箱页里 `window.petri.mcpApp.callTool` / `sendFollowUpMessage` /
 * `openExternal` 的 postMessage RPC 中继到宿主 IPC / 会话回调。
 *
 * 与 GenUiCard 的差异：内容来自 MCP 资源而非工作区 fragment，因此不需要
 * projectId/conversationId 与 scope 归属校验；沙箱、CSP、origin 校验完全一致。
 * 刻意不引入 CSS module —— gen-ui 样式文件属在制 WIP，本组件自带内联样式。
 */

interface McpAppDescriptor {
  serverId: string;
  uri: string;
}

export interface McpAppCardProps {
  app: McpAppDescriptor;
  title?: string;
  height?: number;
  onFollowUp?: (prompt: string, title?: string) => void;
}

type PrepareResult =
  | { ok: true; url: string }
  | { ok: false; code: string; message: string };

interface RpcMessage {
  type: 'petri-gen-ui-rpc';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

function parseSandbox(url: string): { sessionId: string; origin: string } | null {
  const match = /^petri-genui:\/\/([^/]+)\//.exec(url);
  if (!match) return null;
  return { sessionId: match[1], origin: `petri-genui://${match[1]}` };
}

const MIN_HEIGHT = 160;
const MAX_HEIGHT = 720;

export const McpAppCard = React.memo(function McpAppCard({
  app,
  title = 'MCP App',
  height = 240,
  onFollowUp,
}: McpAppCardProps) {
  const [result, setResult] = React.useState<PrepareResult | null>(null);
  const [frameHeight, setFrameHeight] = React.useState(
    Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)),
  );
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const sandbox = React.useMemo(
    () => (result?.ok ? parseSandbox(result.url) : null),
    [result],
  );

  React.useEffect(() => {
    let cancelled = false;
    setResult(null);
    const bridge = getBridge('genUi');
    if (!bridge) {
      setResult({ ok: false, code: 'bridge-unavailable', message: '桌面桥不可用' });
      return undefined;
    }
    bridge
      .prepareMcpApp({ serverId: app.serverId, uri: app.uri, title })
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch(() => {
        if (!cancelled) setResult({ ok: false, code: 'ipc-error', message: 'IPC 调用失败' });
      });
    return () => { cancelled = true; };
  }, [app.serverId, app.uri, title]);

  const postToFrame = React.useCallback((message: Record<string, unknown>) => {
    if (!sandbox) return;
    frameRef.current?.contentWindow?.postMessage(message, sandbox.origin);
  }, [sandbox]);

  const relayRpc = React.useCallback(async (rpc: RpcMessage) => {
    const reply = (ok: boolean, payload: Record<string, unknown>) => {
      postToFrame({ type: 'petri-gen-ui-rpc-result', id: rpc.id, ok, payload });
    };
    const bridge = getBridge('genUi');
    if (!bridge || !sandbox) {
      reply(false, { message: 'gen-ui bridge unavailable' });
      return;
    }
    const params = rpc.params || {};
    try {
      if (rpc.method === 'petri/mcp-app/call-tool') {
        const toolName = typeof params.toolName === 'string' ? params.toolName : '';
        const args = params.args && typeof params.args === 'object'
          ? params.args as Record<string, unknown>
          : {};
        if (!toolName) {
          reply(false, { message: 'toolName required' });
          return;
        }
        const res = await bridge.callMcpAppTool({ sessionId: sandbox.sessionId, toolName, args });
        if (res.ok) reply(true, { result: res.result });
        else reply(false, { message: res.message || res.code });
      } else if (rpc.method === 'petri/gen-ui/follow-up') {
        if (typeof onFollowUp !== 'function' || typeof params.prompt !== 'string') {
          reply(false, { message: 'follow-up binding unavailable (read-only)' });
          return;
        }
        const nextTitle = typeof params.title === 'string' ? params.title : undefined;
        onFollowUp(params.prompt, nextTitle);
        reply(true, {});
      } else if (rpc.method === 'petri/gen-ui/open-external') {
        const href = typeof params.href === 'string' ? params.href : '';
        const res = await bridge.openExternal({ sessionId: sandbox.sessionId, href });
        if (res.ok) reply(true, {});
        else reply(false, { message: res.message || res.code });
      } else {
        reply(false, { message: `unsupported rpc method: ${rpc.method}` });
      }
    } catch (error) {
      reply(false, { message: error instanceof Error ? error.message : String(error) });
    }
  }, [onFollowUp, postToFrame, sandbox]);

  React.useEffect(() => {
    if (!sandbox) return undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.origin !== sandbox.origin) return;
      const data = event.data as RpcMessage | { type?: string; height?: unknown } | null;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'petri-gen-ui-height') {
        const value = (data as { height?: unknown }).height;
        if (typeof value === 'number' && Number.isFinite(value)) {
          setFrameHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(value))));
        }
        return;
      }
      if (data.type === 'petri-gen-ui-rpc') {
        const rpc = data as RpcMessage;
        if (typeof rpc.id === 'number' && typeof rpc.method === 'string') void relayRpc(rpc);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [relayRpc, sandbox]);

  if (!result) {
    return (
      <div data-testid="mcp-app-loading" style={{ padding: 12, fontSize: 12, opacity: 0.72 }}>
        正在准备 MCP App 页面…
      </div>
    );
  }
  if (!result.ok) {
    return (
      <div data-testid="mcp-app-error" role="alert" style={{ padding: 12, fontSize: 12 }}>
        MCP App 页面不可用：{result.message}（{result.code}）
      </div>
    );
  }
  return (
    <div
      data-testid="mcp-app-card"
      style={{ border: '1px solid var(--border-color, currentColor)', borderRadius: 8, overflow: 'hidden', marginTop: 8 }}
    >
      <div style={{ padding: '4px 10px', fontSize: 11, opacity: 0.72 }}>{title}</div>
      <iframe
        ref={frameRef}
        data-testid="mcp-app-frame"
        src={result.url}
        title={title}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        style={{ width: '100%', height: frameHeight, border: 0, display: 'block' }}
      />
    </div>
  );
});
