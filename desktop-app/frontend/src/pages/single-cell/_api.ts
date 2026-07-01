// ============================================================
// R Server API client
// ============================================================

import { errMsg } from '@/lib/error';
import { getApiPrefix, getComputePrefix } from './_config';
export { getApiPrefix, getComputePrefix } from './_config';

/** Auth header for non-JSON requests (e.g. XHR upload). */
function getBearerHeader(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('biof3_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Auth headers for JSON requests. */
function getJsonAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('biof3_token') : null;
  if (token) {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }
  return { 'Content-Type': 'application/json' };
}

// FIX_ADMIN_STABILITY_v1: Admin panel fetch calls were unbounded — no timeout means
// a slow/stuck server response hangs the UI indefinitely (browser shows "loading…"
// forever). This wrapper aborts after `ms` milliseconds and rejects with a clear error.
// Also includes retry logic for transient 5xx errors (retries do NOT count against timeout).
const DEFAULT_TIMEOUT_MS = 15_000; // 15s — generous for heavy admin queries

class FetchTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(msg: string, timeoutMs: number) {
    super(msg);
    this.name = 'FetchTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

async function fetchWithTimeoutInner(
  url: string,
  opts: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal as AbortSignal });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      throw new FetchTimeoutError(
        `请求超时（${(timeoutMs / 1000).toFixed(0)}s）: ${url}`,
        timeoutMs
      );
    }
    throw err;
  }
}

/**
 * Fetch with per-request timeout + automatic retry on transient 5xx.
 * All admin panel fetch calls MUST use this — never bare fetch().
 *
 * @param timeoutMs  Abort after this many ms (default 15s). Admin-heavy queries
 *                   (retention, usage-stats) can pass 30_000.
 * @param retries    Number of retries on 5xx (default 1). Set 0 to disable.
 */
export async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 1
): Promise<Response> {
  const delays = [1200, 3600];
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetchWithTimeoutInner(url, opts, timeoutMs);
      if (resp.status >= 500 && i < retries) {
        await new Promise((r) => setTimeout(r, delays[i] ?? 3000));
        continue;
      }
      return resp;
    } catch (err: unknown) {
      // Timeout and 5xx are retryable; 4xx / network error is not
      if (
        i < retries &&
        !(err instanceof FetchTimeoutError) &&
        !((err as FetchTimeoutError)?.status >= 500)
      ) {
        await new Promise((r) => setTimeout(r, delays[i] ?? 3000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('请求失败');
}

export interface UploadResult {
  name: string;
  url: string;
  size: number;
}

export async function uploadFile(
  file: File,
  onProgress?: (pct: number) => void
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', getApiPrefix() + '/upload');
    const bearer = getBearerHeader();
    if (bearer.Authorization) xhr.setRequestHeader('Authorization', bearer.Authorization);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.status === 'ok') {
            resolve({
              name: data.originalName,
              url: data.ossUrl || data.filePath,
              size: file.size,
            });
          } else {
            reject(new Error(data.error || '上传失败'));
          }
        } catch {
          reject(new Error('响应解析失败'));
        }
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  });
}

export async function submitTask(
  type: string,
  ossInputUrl: string,
  params: Record<string, unknown>,
  parentTaskId?: string
): Promise<string> {
  const resp = await fetchWithTimeout(getApiPrefix() + '/task', {
    method: 'POST',
    headers: getJsonAuthHeaders(),
    body: JSON.stringify({ type, ossInputUrl, params, parentTaskId }),
  });
  const data = await resp.json();
  if (data.status === 'ok') return data.taskId;
  throw new Error(data.error || '提交失败');
}

export async function getTaskStatus(taskId: string): Promise<Record<string, unknown>> {
  const resp = await fetchWithTimeout(getApiPrefix() + `/task/${taskId}`, {
    headers: getJsonAuthHeaders(),
  });
  const data = await resp.json();
  if (data.status === 'ok') return data.task;
  throw new Error(data.error || '任务不存在');
}

// ============================================================
// Replot — Persistent R session for fast online plotting
// ============================================================

export async function warmupReplot(
  taskId: string,
  cachePath: string
): Promise<{ ok: boolean; nCells?: number; error?: string }> {
  try {
    const resp = await fetchWithTimeout(
      getComputePrefix() + '/replot/warmup',
      {
        method: 'POST',
        headers: getJsonAuthHeaders(),
        body: JSON.stringify({ taskId, cachePath }),
      },
      30_000
    );
    const data = await resp.json();
    // plumber returns arrays for scalar fields
    const status = Array.isArray(data.status) ? data.status[0] : data.status;
    if (status === 'ok') {
      return { ok: true, nCells: Array.isArray(data.nCells) ? data.nCells[0] : data.nCells };
    }
    return { ok: false, error: Array.isArray(data.error) ? data.error[0] : data.error };
  } catch (e: unknown) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function runReplot(
  taskId: string,
  code: string
): Promise<{ ok: boolean; image?: string; error?: string }> {
  try {
    const resp = await fetchWithTimeout(
      getComputePrefix() + '/replot/run',
      {
        method: 'POST',
        headers: getJsonAuthHeaders(),
        body: JSON.stringify({ taskId, code }),
      },
      60_000
    );
    const data = await resp.json();
    const status = Array.isArray(data.status) ? data.status[0] : data.status;
    if (status === 'ok') {
      const image = Array.isArray(data.image) ? data.image[0] : data.image;
      return { ok: true, image };
    }
    return { ok: false, error: Array.isArray(data.error) ? data.error[0] : data.error };
  } catch (e: unknown) {
    return { ok: false, error: errMsg(e) };
  }
}

// ============================================================
// Format helpers
// ============================================================

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} 小时前`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay} 天前`;
    return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  } catch {
    return '';
  }
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}秒`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}分${secs}秒`;
}
