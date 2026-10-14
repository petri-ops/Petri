/**
 * BLOCK-183 — 投影数据桥 WS-first 传输层（共享单连接 /m/api/ws）。
 *
 * 数据桥读面（skills/plugins/packs/runtime/aiSettings 的 GET）从「每请求一条
 * HTTP」改为共享单条 WebSocket 信封：`{t:"data",id,url}` → `{t:"data-res",id,
 * status,data}`（HTTP 同形状透传）/`{t:"data-err",id,error}`。服务端 loopback
 * 自调既有 Express 路由——读面形状单一真相零第二实现。
 *
 * 回退纪律（对齐 agentTaskStream BLOCK-162 P3 形态）：
 *  - 传输级失败（建连失败/连接断开/请求超时）逐请求静默回退：调用方
 *    （projectionDataBridges.getJson）catch 后落回既有 HTTP fetch，横幅语义
 *    由 HTTP 最终结果决定，零行为漂移；
 *  - 传输级失败连续 3 次 → 5min 冷却直走 HTTP（防代理拦死 upgrade 的死循环），
 *    到期恢复尝试；成功一次即清零连击；
 *  - 业务 data-err（data_timeout 等）reject 但不计连击——WS 通道本身健康。
 *
 * 白名单镜像（服务端 DATA_ALLOWED_PATHS 是真值门，此处只省无谓往返）：
 * 非白名单路径直接 reject，不发 WS 帧。
 */
import { isProjectionEnv } from '@/lib/projectionLink';

export const WS_DATA_READ_PATHS: ReadonlySet<string> = new Set([
  '/api/skills/registry',
  '/api/plugins/installed',
  '/api/plugins/catalog',
  '/api/packs/installed',
  '/api/packs/available',
  '/api/runtime/status',
  '/api/ai/settings',
]);

const WS_CONNECT_TIMEOUT_MS = 5000;
const WS_REQUEST_TIMEOUT_MS = 8000;
const WS_FALLBACK_FAILURE_THRESHOLD = 3;
const WS_FALLBACK_COOLDOWN_MS = 5 * 60 * 1000;

export interface WsDataResult {
  status: number;
  data: Record<string, unknown>;
}

interface PendingRequest {
  resolve: (result: WsDataResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let socket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;
let nextRequestId = 1;
let failStreak = 0;
let disabledUntil = 0;
const pending = new Map<string, PendingRequest>();

/** 传输级失败记账：连击 ≥3 → 5min 冷却（期间 wsDataAvailable()=false 直走 HTTP）。 */
function noteTransportFailure(): void {
  failStreak += 1;
  if (failStreak >= WS_FALLBACK_FAILURE_THRESHOLD) {
    disabledUntil = Date.now() + WS_FALLBACK_COOLDOWN_MS;
  }
}

/** WS-first 可用性：投影环境 + WebSocket 存在 + 不在冷却期。 */
export function wsDataAvailable(): boolean {
  return isProjectionEnv()
    && typeof WebSocket !== 'undefined'
    && Date.now() >= disabledUntil;
}

function wsEndpoint(): string {
  const protocol = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/m/api/ws`;
}

function bindSocket(s: WebSocket): void {
  s.onmessage = (event: { data: unknown }) => {
    const msg = (() => {
      try {
        return JSON.parse(String(event.data)) as {
          t?: string; id?: unknown; status?: unknown; data?: unknown; error?: unknown;
        };
      } catch { return null; }
    })();
    if (!msg || (msg.t !== 'data-res' && msg.t !== 'data-err')) return; // 任务流/心跳帧非本模块管辖
    const key = (typeof msg.id === 'string' || typeof msg.id === 'number') ? String(msg.id) : '';
    const entry = pending.get(key);
    if (!entry) return;
    pending.delete(key);
    clearTimeout(entry.timer);
    if (msg.t === 'data-res') {
      failStreak = 0;
      entry.resolve({
        status: typeof msg.status === 'number' ? msg.status : 0,
        data: msg.data && typeof msg.data === 'object' ? (msg.data as Record<string, unknown>) : {},
      });
    } else {
      // 业务错：通道健康，不计连击（调用方自行回退该请求）
      entry.reject(new Error(typeof msg.error === 'string' && msg.error ? msg.error : 'data_error'));
    }
  };
  s.onclose = () => {
    if (socket === s) socket = null;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('ws_closed'));
    }
    pending.clear();
    noteTransportFailure();
  };
  s.onerror = () => { /* close 事件接手（建连失败路径由 connecting 的 reject 兜） */ };
}

/** 惰性共享建连（5s 超时）；连接由服务端 15s ping 保活，断开后下次请求按需重建。 */
function connectOnce(): Promise<WebSocket> {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  if (connecting) return connecting;
  let settled = false;
  const promise = new Promise<WebSocket>((resolve, reject) => {
    let s: WebSocket;
    try {
      s = new WebSocket(wsEndpoint());
    } catch (error) {
      settled = true;
      noteTransportFailure();
      reject(error instanceof Error ? error : new Error('ws_connect_failed'));
      return;
    }
    const fail = (reason: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { s.close(); } catch { /* 未开即败 */ }
      noteTransportFailure();
      reject(reason);
    };
    const timer = setTimeout(() => fail(new Error('ws_connect_timeout')), WS_CONNECT_TIMEOUT_MS);
    s.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket = s;
      bindSocket(s);
      resolve(s);
    };
    s.onerror = () => fail(new Error('ws_connect_failed'));
    s.onclose = () => fail(new Error('ws_connect_failed'));
  });
  connecting = promise;
  // 落定即清槽（含构造器同步 throw 的 reject 路径）：下一次请求按需重建
  void promise.then(
    () => { if (connecting === promise) connecting = null; },
    () => { if (connecting === promise) connecting = null; },
  );
  return promise;
}

/**
 * 白名单读路径 WS 信封请求。任何 reject 都意味着「本请求走 HTTP 回退」；
 * 传输级失败同时推进冷却连击。非白名单路径立即 reject（不发帧）。
 */
export function wsDataRequest(url: string): Promise<WsDataResult> {
  if (!wsDataAvailable()) return Promise.reject(new Error('ws_unavailable'));
  if (!WS_DATA_READ_PATHS.has(url)) return Promise.reject(new Error('path_not_allowed'));
  return connectOnce().then((s) => new Promise<WsDataResult>((resolve, reject) => {
    const id = String(nextRequestId);
    nextRequestId += 1;
    const entry: PendingRequest = {
      resolve: (result) => { pending.delete(id); resolve(result); },
      reject: (error) => { pending.delete(id); reject(error); },
      timer: setTimeout(() => {
        pending.delete(id);
        noteTransportFailure();
        reject(new Error('ws_request_timeout'));
      }, WS_REQUEST_TIMEOUT_MS),
    };
    pending.set(id, entry);
    try {
      s.send(JSON.stringify({ t: 'data', id, url }));
    } catch {
      clearTimeout(entry.timer);
      pending.delete(id);
      noteTransportFailure();
      reject(new Error('ws_send_failed'));
    }
  }));
}
