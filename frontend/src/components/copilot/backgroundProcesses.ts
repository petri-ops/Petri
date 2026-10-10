/**
 * BLOCK-34 P3 — 后台进程浮窗客户端
 *
 * 只读查询 petri-server 的 background-processes 路由（数据源为
 * workspace-tools 内存进程表，per conversation 隔离）：
 *   - listBackgroundProcesses: 列出本会话后台进程（含日志尾部摘要）
 *   - fetchProcessLogTail: 读单个进程日志尾部（浮窗 1s 轮询用）
 */

import { getApiPrefix, getAuthHeader } from './copilotClient';

export type BackgroundProcessStatus =
  | 'running'
  | 'exited'
  | 'stopped'
  | 'failed'
  | 'orphaned';

export interface BackgroundProcessView {
  processId: string;
  pid: number;
  status: BackgroundProcessStatus;
  command: string;
  cwd?: string;
  shell?: string;
  startedAtIso: string;
  durationMs: number;
  exitCode?: number | null;
  signal?: string | null;
  logPath?: string;
  logTail?: string;
  logTruncated?: boolean;
  logSizeBytes?: number;
  spawnError?: string;
}

async function requestJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, { headers: { ...getAuthHeader() } });
  let body: (T & { status?: string; error?: string }) | null = null;
  try {
    body = (await resp.json()) as T & { status?: string; error?: string };
  } catch {
    // 非 JSON 响应按 HTTP 状态处理
  }
  if (!resp.ok || !body) {
    throw new Error(body?.error || `HTTP ${resp.status}`);
  }
  return body;
}

/** 列出本会话的后台进程（每项含日志尾部摘要）。 */
export async function listBackgroundProcesses(
  conversationId: string,
  projectId?: string | null
): Promise<BackgroundProcessView[]> {
  const params = new URLSearchParams({ conversationId });
  if (projectId) params.set('projectId', projectId);
  const body = await requestJson<{ count: number; processes: BackgroundProcessView[] }>(
    `${getApiPrefix()}/ai/agent/background-processes?${params.toString()}`
  );
  return Array.isArray(body.processes) ? body.processes : [];
}

/** 读取单个进程的状态与日志尾部。进程不存在或属于其他会话时抛错。 */
export async function fetchProcessLogTail(
  processId: string,
  conversationId: string,
  projectId?: string | null,
  bytes?: number
): Promise<BackgroundProcessView> {
  const params = new URLSearchParams({ conversationId });
  if (projectId) params.set('projectId', projectId);
  if (Number.isFinite(bytes)) params.set('bytes', String(bytes));
  const body = await requestJson<{ process: BackgroundProcessView }>(
    `${getApiPrefix()}/ai/agent/background-processes/${encodeURIComponent(
      processId
    )}/log?${params.toString()}`
  );
  return body.process;
}
