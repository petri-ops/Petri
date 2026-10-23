/**
 * scratchpadClient.ts — BLOCK-246 C13 速记板前端 API 封装。
 *
 * 单一真相 = 后端 `GET/POST/DELETE /api/scratchpad`（表在 `src/migrations/016_scratchpad.sql`）。
 * 前端不缓存、不本地造第二份列表；上限（正文 8000 字 / 图片约 1.5MB / 单页 100）全部
 * 由后端返回可读错误，前端只负责原样展示——不在前端另写一套阈值。
 */

import { getApiPrefix } from '../components/copilot/copilotClient';

export type ScratchpadKind = 'text' | 'image';
export type ScratchpadSourceKind = 'manual' | 'conversation' | 'file' | 'selection';

export interface ScratchpadEntry {
  entryId: string;
  contractVersion: number;
  kind: ScratchpadKind;
  title: string | null;
  /** 文本 = 正文；图片 = data URL 或 http(s) 地址。 */
  body: string;
  sourceKind: ScratchpadSourceKind;
  /** 来源标识（会话 id / 工作区相对路径 / 选区位置串）；manual 时为 null。 */
  sourceRef: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScratchpadListResult {
  entries: ScratchpadEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateScratchpadInput {
  kind?: ScratchpadKind;
  title?: string;
  body: string;
  sourceKind?: ScratchpadSourceKind;
  sourceRef?: string | null;
  projectId?: string | null;
}

/** 列表单页默认条数（与后端默认一致；后端还会把上限夹到 100）。 */
export const SCRATCHPAD_PAGE_SIZE = 20;

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || !data) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new Error(typeof message === 'string' && message ? message : `速记请求失败（HTTP ${response.status}）`);
  }
  return data;
}

export async function listScratchpad(
  options: { query?: string; limit?: number; offset?: number } = {}
): Promise<ScratchpadListResult> {
  const params = new URLSearchParams();
  if (options.query) params.set('query', options.query);
  params.set('limit', String(options.limit ?? SCRATCHPAD_PAGE_SIZE));
  if (options.offset) params.set('offset', String(options.offset));
  const response = await fetch(`${getApiPrefix()}/scratchpad?${params.toString()}`, { cache: 'no-store' });
  const data = await readJson<{ ok: true } & ScratchpadListResult>(response);
  return { entries: data.entries, total: data.total, limit: data.limit, offset: data.offset };
}

export async function createScratchpad(input: CreateScratchpadInput): Promise<ScratchpadEntry> {
  const response = await fetch(`${getApiPrefix()}/scratchpad`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await readJson<{ entry: ScratchpadEntry }>(response);
  return data.entry;
}

export async function removeScratchpad(entryId: string): Promise<boolean> {
  const response = await fetch(`${getApiPrefix()}/scratchpad/${encodeURIComponent(entryId)}`, {
    method: 'DELETE',
  });
  if (response.status === 204) return true;
  if (response.status === 404) return false;
  throw new Error(`删除速记失败（HTTP ${response.status}）`);
}
