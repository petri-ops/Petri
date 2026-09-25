// ============================================================
// M2-5 Copilot 离线降级提示（E3）
// 在发起 AI 请求前先做网络探测：navigator.onLine + 一次轻量 fetch。
// 离线时抛 OfflineError，调用方据此显示"离线模式"占位而非裸 fetch 堆栈。
// ============================================================

import { getApiPrefix, getAuthHeader } from './apiBase';

/** 离线错误 —— UI 层据此渲染友好占位，区别于普通请求失败。 */
class OfflineError extends Error {
  readonly isOffline = true;
  constructor(message = '离线模式，AI 暂不可用') {
    super(message);
    this.name = 'OfflineError';
  }
}


/**
 * 探测网络是否可用：navigator.onLine + 一次 HEAD/GET 探测 fetch。
 * - navigator.onLine 为 false → 直接判定离线（不发包）。
 * - 否则对 API 根路径发一次 cache-busting 探测；fetch 抛错或返回
 *   status=0 视为离线。成功（含 4xx/5xx，只要有响应）即视为在线。
 * - 探测请求带 AbortSignal，避免长时间挂起。
 */
async function checkOnline(timeoutMs = 4000): Promise<boolean> {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    if (!navigator.onLine) return false;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // 用 API 前缀根路径探测（同源、相对路径，避免 CORS），加 no-cache 防假在线。
    const url = getApiPrefix() + '/health?_t=' + Date.now();
    const resp = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { ...getAuthHeader() },
    });
    clearTimeout(timer);
    // status === 0 通常表示请求未真正发出（被拦截/网络层失败）
    return resp.status !== 0;
  } catch {
    // 探测失败可能是 abort（慢）或网络错误 —— 统一视为离线
    return false;
  }
}

/** 离线时抛出友好错误；在线则静默返回，调用方继续真实请求。（家族内部使用） */
export async function ensureOnlineOrThrow(): Promise<void> {
  const ok = await checkOnline();
  if (!ok) throw new OfflineError();
}
