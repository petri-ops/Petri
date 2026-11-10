export function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'https://petri.com/';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) return trimmed;
  if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

/**
 * L1-4（蓝图 L-53）：webview navigate 的可导航判定——仅 http(s)、
 * 主机不得为本机回环（本地报告走 iframe/petri-pack:// / petri-genui:// 独立通道）、
 * 不得携带 userinfo（`http://user@evil` 形态）。每次 loadURL 前都必须过本判定
 * （will-attach-webview 只查初始 src，guest 运行时导航不经过它）。
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isNavigableWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (LOOPBACK_HOSTS.has(url.hostname)) return false;
    if (url.username || url.password) return false;
    return true;
  } catch {
    return false;
  }
}

export function isPetriLocalBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export function getBrowserViewportSize(width: number, height: number): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
}
