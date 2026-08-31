// ============================================================
// conversationChangesStore — BLOCK-31 P2 会话级改动索引
//
// 记录「哪个会话改了哪些文件」：
//   - 运行中：conversationRunStore.onToolResult 实时记录成功的
//     workspace_write / workspace_replace（per-conversation 维度）
//   - 任务收尾：订阅 biof3:agent-task-done，用后端权威 filesChanged
//     清单（task_events 回放聚合产物）按 conversationId 对账合并
//
// 消费方：AgentChangesCard（默认只显示当前会话的改动）。
// git working tree 仍是 diff/统计的事实源；本 store 只负责「路径归属」。
// ============================================================

import { biof3Events, subscribeBioF3Event } from '@/lib/events';

export interface ConversationFileChange {
  path: string;
  status: 'created' | 'modified';
  /** 最近一次改动的 epoch ms（用于排序） */
  lastChangedAt: number;
}

type ChangeListener = () => void;

const changesByConversation = new Map<string, Map<string, ConversationFileChange>>();
// useSyncExternalStore 的 getSnapshot 必须返回稳定引用：每次变更后使缓存失效，
// 读取时按需重建并缓存。
const snapshotCache = new Map<string, ConversationFileChange[]>();
const EMPTY: ConversationFileChange[] = [];
const listeners = new Set<ChangeListener>();

let subscribed = false;

function invalidateSnapshot(conversationId: string): void {
  snapshotCache.delete(conversationId);
}

function ensureSubscribed(): void {
  if (subscribed || typeof window === 'undefined') return;
  subscribed = true;
  // 权威对账：任务收尾时用后端清单覆盖该会话的归属（保留 live 记录中
  // 权威清单之外的路径，兼容 workspace_exec 等盲区与多任务并发）。
  subscribeBioF3Event(biof3Events.agentTaskDone, (detail) => {
    if (!detail?.conversationId || !Array.isArray(detail.filesChanged)) return;
    const authoritative = detail.filesChanged.filter(
      (item) => item && typeof item.path === 'string'
    );
    if (authoritative.length === 0) return;
    const bucket = changesByConversation.get(detail.conversationId) ?? new Map();
    const now = Date.now();
    for (const item of authoritative) {
      const existing = bucket.get(item.path);
      bucket.set(item.path, {
        path: item.path,
        status: item.status === 'created' ? 'created' : 'modified',
        lastChangedAt: existing?.lastChangedAt ?? now,
      });
    }
    // 权威清单之外的 live 记录保留（exec 盲区 / 并发任务），不删除
    changesByConversation.set(detail.conversationId, bucket);
    invalidateSnapshot(detail.conversationId);
    emitChange();
  });
}

function emitChange(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
}

/** 运行中实时记录（workspace_write / workspace_replace 成功结果）。 */
export function recordConversationFileChange(
  conversationId: string | undefined | null,
  path: string,
  status: 'created' | 'modified'
): void {
  if (!conversationId || !path) return;
  ensureSubscribed();
  const bucket = changesByConversation.get(conversationId) ?? new Map();
  bucket.set(path, { path, status, lastChangedAt: Date.now() });
  changesByConversation.set(conversationId, bucket);
  invalidateSnapshot(conversationId);
  emitChange();
}

/** 读取某会话的改动文件（按最近改动倒序）。返回缓存引用，勿直接修改。 */
export function getConversationFileChanges(
  conversationId: string | undefined | null
): ConversationFileChange[] {
  if (!conversationId) return EMPTY;
  const cached = snapshotCache.get(conversationId);
  if (cached) return cached;
  const bucket = changesByConversation.get(conversationId);
  const snapshot = bucket
    ? Array.from(bucket.values()).sort((a, b) => b.lastChangedAt - a.lastChangedAt)
    : EMPTY;
  snapshotCache.set(conversationId, snapshot);
  return snapshot;
}

/** React useSyncExternalStore 订阅。 */
export function subscribeConversationChanges(listener: ChangeListener): () => void {
  ensureSubscribed();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 会话改动清空（提交/还原后由调用方触发全量刷新用不到此函数时勿滥用）。 */
export function clearConversationFileChanges(conversationId: string): void {
  if (changesByConversation.delete(conversationId)) {
    invalidateSnapshot(conversationId);
    emitChange();
  }
}
