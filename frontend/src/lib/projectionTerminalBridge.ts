/**
 * BLOCK-85 P4 — 投影终端 HTTP 桥。
 *
 * 桌面投影（手机浏览器）里没有 Electron 终端桥——本模块在投影环境下
 * 以同一形状提供真终端：startSession/writeSession/resizeSession/stopSession
 * + onData/onExit，内部走 gateway /m/api/terminal/*（SSE 下行 + POST 上行，
 * node-pty 会话驻留 core 进程，手机锁屏重连经环形缓冲重放）。
 * 消费方（useTerminalTabs）零改动——getBridge('terminal') 在投影环境
 * 自动切换到本桥。
 */
import { getToken } from '@/lib/authClient';
import { installProjectionResyncListener, markProjectionBridgeFailure, markProjectionBridgeSuccess, onProjectionResync } from '@/lib/projectionLink';

interface ProjectionTerminalBridge {
  startSession: (cwd: string | null, tabId: string, ssh?: unknown) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  writeSession: (data: string, tabId: string) => void;
  resizeSession: (cols: number, rows: number, tabId: string) => void;
  stopSession: (tabId: string) => void;
  onData: (handler: (payload: { sessionId: string; data: string }) => void) => () => void;
  onExit: (handler: (payload: { sessionId: string; exitCode?: number | null }) => void) => () => void;
}

const sessionByTab = new Map<string, string>(); // tabId -> gateway sessionId
const sourceByTab = new Map<string, EventSource>();
const dataHandlers = new Set<(payload: { sessionId: string; data: string }) => void>();
const exitHandlers = new Set<(payload: { sessionId: string; exitCode?: number | null; bridgeUnavailable?: boolean }) => void>();
// L3-3（蓝图 L-17）：每 tab 重连失败计数（onerror 有界重连）
const reconnectFailures = new Map<string, number>();
const TERMINAL_RECONNECT_LIMIT = 5;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function attachStream(tabId: string, sessionId: string) {
  if (sourceByTab.has(tabId)) return;
  // BLOCK-102 P3 — 不再把一年期会话 token 放进 URL（会落中转 nginx 日志与
  // 浏览器历史）；投影 SPA 与网关同源，EventSource 自动携带 HttpOnly
  // gw_session cookie（sessionAuth 的 readCookieToken 分支鉴权）。
  const url = `/m/api/terminal/${encodeURIComponent(sessionId)}/stream`;
  const source = new EventSource(url);
  source.addEventListener('open', () => {
    // BLOCK-159 P1-9 — 终端流连上即链路活的强信号（帮断连横幅复位）
    markProjectionBridgeSuccess();
  });
  source.addEventListener('terminal:data', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { data: string };
      for (const handler of dataHandlers) handler({ sessionId: tabId, data: payload.data });
    } catch { /* 忽略坏帧 */ }
  });
  source.addEventListener('terminal:exit', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { exitCode?: number | null };
      for (const handler of exitHandlers) handler({ sessionId: tabId, exitCode: payload.exitCode });
    } catch { /* 忽略坏帧 */ }
    source.close();
    sourceByTab.delete(tabId);
    // L3-3（蓝图 L-17）：exit 必须同时清 sessionByTab——残留会让后续 write/resize 对死会话 POST。
    sessionByTab.delete(tabId);
    reconnectFailures.delete(tabId);
  });
  // L3-3（蓝图 L-17）：onerror 有界重连——EventSource 原生无限重连改为计数上限
  //（5 次达限 close + 显式失败上报），避免永久盲重连。
  const failures = (reconnectFailures.get(tabId) || 0) + 1;
  reconnectFailures.set(tabId, failures);
  if (failures >= TERMINAL_RECONNECT_LIMIT) {
    source.close();
    sourceByTab.delete(tabId);
    sessionByTab.delete(tabId);
    reconnectFailures.delete(tabId);
    markProjectionBridgeFailure('terminal stream reconnect limit reached');
    for (const handler of exitHandlers) handler({ sessionId: tabId, exitCode: null, bridgeUnavailable: true });
    return;
  }
  markProjectionBridgeFailure('terminal stream error');
  sourceByTab.set(tabId, source);
}

// BLOCK-159 P1-8 — 回前台 resync：锁屏/切后台会杀 SSE 连接，EventSource 的
// 盲重试窗口内体验是黑终端；回可见时对仍存活的会话立即重挂（服务端环形
// 缓冲重放，会话驻留 core 进程不丢）。终端桥首次使用时注册幂等 resync 监听。
let resyncInstalled = false;
function ensureResyncWiring() {
  if (resyncInstalled) return;
  resyncInstalled = true;
  installProjectionResyncListener();
  onProjectionResync(() => {
    for (const [tabId, sessionId] of sessionByTab) {
      const source = sourceByTab.get(tabId);
      if (source && source.readyState === EventSource.CLOSED) {
        sourceByTab.delete(tabId);
        attachStream(tabId, sessionId);
      }
    }
  });
}

const bridge: ProjectionTerminalBridge = {
  async startSession(cwd, tabId, ssh) {
    ensureResyncWiring();
    const sshInfo = ssh as { alias?: string; remotePath?: string } | undefined;
    try {
      const response = await fetch('/m/api/terminal/start', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          cwd,
          ssh: sshInfo?.alias && sshInfo?.remotePath ? { alias: sshInfo.alias, remotePath: sshInfo.remotePath } : undefined,
        }),
      });
      const data = (await response.json()) as { ok?: unknown; sessionId?: string; message?: unknown; error?: unknown };
      if (!data.ok || !data.sessionId) {
        return { ok: false, error: typeof data.message === 'string' && data.message ? data.message : typeof data.error === 'string' && data.error ? data.error : '终端启动失败' };
      }
      sessionByTab.set(tabId, data.sessionId);
      attachStream(tabId, data.sessionId);
      return { ok: true, sessionId: data.sessionId };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '终端通道连接失败' };
    }
  },

  writeSession(data, tabId) {
    const sessionId = sessionByTab.get(tabId);
    if (!sessionId) return;
    void fetch(`/m/api/terminal/${encodeURIComponent(sessionId)}/input`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ data }),
    }).catch(() => { /* 瞬时失败由 xterm 光标状态体现 */ });
  },

  resizeSession(cols, rows, tabId) {
    const sessionId = sessionByTab.get(tabId);
    if (!sessionId) return;
    void fetch(`/m/api/terminal/${encodeURIComponent(sessionId)}/resize`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ cols, rows }),
    }).catch(() => {
      // L3-4（L-18）：resize 失败具名降级（终端列宽暂不生效，不阻塞会话）
      markProjectionBridgeFailure('terminal resize failed');
    });
  },

  stopSession(tabId) {
    const sessionId = sessionByTab.get(tabId);
    sourceByTab.get(tabId)?.close();
    sourceByTab.delete(tabId);
    sessionByTab.delete(tabId);
    if (!sessionId) return;
    // L3-3（蓝图 L-17）：kill 失败重试 2 次——原裸吞会让 core 侧 node-pty 会话常驻
    // 而本地映射已删、无法补偿；重试耗尽显式上报。
    const kill = (attempt: number): void => {
      void fetch(`/m/api/terminal/${encodeURIComponent(sessionId)}/kill`, {
        method: 'POST',
        headers: authHeaders(),
      }).catch(() => {
        if (attempt < 2) {
          setTimeout(() => kill(attempt + 1), 500 * (attempt + 1));
          return;
        }
        markProjectionBridgeFailure('terminal kill failed after retries');
      });
    };
    kill(0);
  },

  onData(handler) {
    dataHandlers.add(handler);
    return () => dataHandlers.delete(handler);
  },

  onExit(handler) {
    exitHandlers.add(handler);
    return () => exitHandlers.delete(handler);
  },
};

function isProjectionEnv(): boolean {
  return typeof window !== 'undefined'
    && !!(window.petriDesktop as { __projection?: boolean } | undefined)?.__projection;
}

export function getProjectionTerminalBridge(): ProjectionTerminalBridge | null {
  return isProjectionEnv() ? bridge : null;
}
