// ============================================================
// /spatial API client
//
// 复用 /single-cell `_api.ts` 的：uploadFile / formatSize / formatTime / formatDuration
// （它们走 r-server `/api/upload` 通用路径，跨模态共享，零代码改动）
//
// 空间专属（待 W3-B 实现）：submitTask 走 py-server `/api/py/task`
// ============================================================

// 通用工具函数（上传/时间/大小格式化）从 single-cell 直接复用
export {
  uploadFile,
  getApiPrefix,
  formatSize,
  formatTime,
  formatDuration,
} from '../single-cell/_api';

import type { SpatialAnalysisType } from './_types';

// ============================================================
// py-server API prefix（线上同域走 nginx 反代 /api/py，本地开发直连）
// ============================================================

const PROD_PY_SERVER = 'http://localhost:3004';

export function getPyApiPrefix(): string {
  if (typeof window === 'undefined') return `${PROD_PY_SERVER}/api`;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return `${PROD_PY_SERVER}/api`;
  }
  return window.location.origin + '/api/py';
}

function getJsonAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('biof3_token') : null;
  if (token) {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }
  return { 'Content-Type': 'application/json' };
}

// ============================================================
// 空间任务派发（W3-B 启用；W3-A 暂不调用）
// ============================================================

/**
 * 派发空间分析任务到 py-server。
 *
 * 与 single-cell `submitTask` 的区别：走 py-server `/api/py/task`，
 * 任务 ID 前缀 `'py:'`，前端轮询时按前缀路由（spec §3.3）。
 *
 * **状态：占位实现**——W3-A 暂不调用（Wave 3-A 只做 UI 骨架）。
 * 真实 dispatch 在 W3-B 实现，那时 py-server `/api/py/task` 已存在。
 */
export async function submitSpatialTask(
  type: SpatialAnalysisType,
  ossInputUrl: string,
  params: Record<string, unknown>,
  parentTaskId?: string
): Promise<string> {
  const resp = await fetch(getPyApiPrefix() + '/task', {
    method: 'POST',
    headers: getJsonAuthHeaders(),
    body: JSON.stringify({ type, ossInputUrl, params, parentTaskId }),
  });
  const data = await resp.json();
  if (data.status === 'ok') return data.taskId;
  throw new Error(data.error || '提交失败');
}

export async function getSpatialTaskStatus(taskId: string): Promise<Record<string, unknown>> {
  const resp = await fetch(getPyApiPrefix() + `/task/${taskId}`, {
    headers: getJsonAuthHeaders(),
  });
  const data = await resp.json();
  if (data.status === 'ok') return data.task;
  throw new Error(data.error || '任务不存在');
}
