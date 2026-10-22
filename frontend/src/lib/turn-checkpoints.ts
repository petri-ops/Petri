import { getBridge } from '@/lib/desktopBridge';

/**
 * turn-checkpoints — 每轮工作树快照登记（BLOCK-244 Q1-REM C5）。
 *
 * 发送时并行发起 `git stash create` 型无副作用快照（IPC BLOCK-176 CP-17，调用方不 await），
 * 以 conversationId + 文本哈希 + 时间登记在 localStorage；编辑用户消息时据此
 * 提供「回退本轮文件修改并重发」。非 git / 非桌面 / 超时 = 不登记（编辑时如实提示）。
 */

const STORAGE_KEY = 'petri_turn_checkpoints_v1';
const MAX_ENTRIES = 40;
const CREATE_TIMEOUT_MS = 2500;

export interface TurnCheckpoint {
  conversationId: string;
  contentHash: string;
  ref: string;
  at: number;
}

interface CheckpointBridge {
  checkpointCreate?: (params?: { projectId?: string }) => Promise<{
    ok: boolean;
    data?: { created?: boolean; ref?: string | null; message?: string };
    message?: string;
  }>;
}

function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function readAll(): TurnCheckpoint[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const raw = entry as Record<string, unknown>;
      if (
        typeof raw.conversationId !== 'string'
        || typeof raw.contentHash !== 'string'
        || typeof raw.ref !== 'string'
        || typeof raw.at !== 'number'
      ) return [];
      return [{
        conversationId: raw.conversationId,
        contentHash: raw.contentHash,
        ref: raw.ref,
        at: raw.at,
      }];
    });
  } catch {
    return [];
  }
}

function writeAll(entries: TurnCheckpoint[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch { /* localStorage 不可用不阻塞 */ }
}

/** 记录本轮快照（供编辑时按会话+文本查找）。 */
export function recordTurnCheckpoint(conversationId: string, text: string, ref: string): void {
  if (!conversationId || !ref) return;
  const entries = readAll().filter((entry) => !(entry.conversationId === conversationId && entry.contentHash === hashText(text)));
  entries.push({ conversationId, contentHash: hashText(text), ref, at: Date.now() });
  writeAll(entries);
}

/** 查找最近一次同会话同文本的快照；无则 null。 */
export function findTurnCheckpoint(conversationId: string, text: string): TurnCheckpoint | null {
  if (!conversationId) return null;
  const contentHash = hashText(text);
  const matches = readAll().filter((entry) => entry.conversationId === conversationId && entry.contentHash === contentHash);
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

/**
 * 发送时并行发起快照（调用方 `void` 不 await）；最长等待 2.5s，失败/非 git 不登记也不阻断发送。
 * 返回快照 ref 或 null。
 */
export async function createTurnCheckpoint(params: {
  projectId?: string | null;
  conversationId?: string | null;
  text: string;
}): Promise<string | null> {
  if (!params.projectId || !params.conversationId || !params.text.trim()) return null;
  const bridge = getBridge('workingTreeReview') as CheckpointBridge | null;
  if (!bridge || typeof bridge.checkpointCreate !== 'function') return null;
  let timer = null;
  try {
    const result = await Promise.race([
      bridge.checkpointCreate({ projectId: params.projectId }),
      new Promise<null>((resolve) => {
        timer = window.setTimeout(() => resolve(null), CREATE_TIMEOUT_MS);
      }),
    ]);
    if (!result || !result.ok || !result.data || result.data.created !== true || !result.data.ref) return null;
    recordTurnCheckpoint(params.conversationId, params.text, result.data.ref);
    return result.data.ref;
  } catch {
    return null;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}
