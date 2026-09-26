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

import { useEffect, useState, useSyncExternalStore } from 'react';
import { gewuEvents, subscribeGewuEvent } from '@/lib/events';
import { getApiPrefix } from '@/lib/env';
import { BridgeUnavailableError, getBridge } from '@/lib/desktopBridge';

export interface ConversationFileChange {
  path: string;
  status: 'created' | 'modified';
  /** 最近一次改动的 epoch ms（用于排序） */
  lastChangedAt: number;
  /** UI-273 — 执行步骤归属：改动发生时的 agent 迭代号（未知时缺省） */
  iteration?: number;
  /** UI-273 — 产生改动的工具名（workspace_write / workspace_replace） */
  tool?: string;
}

type ChangeListener = () => void;

const changesByConversation = new Map<string, Map<string, ConversationFileChange>>();
// useSyncExternalStore 的 getSnapshot 必须返回稳定引用：每次变更后使缓存失效，
// 读取时按需重建并缓存。
const snapshotCache = new Map<string, ConversationFileChange[]>();
const EMPTY: ConversationFileChange[] = [];
const listeners = new Set<ChangeListener>();

let subscribed = false;

// UI-446 — 单调时间戳：record 与 acknowledge 同毫秒竞态会让未读判定抖动
// （Date.now 相等时严格 > 判定熄灭/点亮的语义不确定），故保证严格递增。
let stampTick = 0;
function nextStamp(): number {
  stampTick = Math.max(stampTick + 1, Date.now());
  return stampTick;
}

function invalidateSnapshot(conversationId: string): void {
  snapshotCache.delete(conversationId);
}

function ensureSubscribed(): void {
  if (subscribed || typeof window === 'undefined') return;
  subscribed = true;
  // 权威对账：任务收尾时用后端清单覆盖该会话的归属（保留 live 记录中
  // 权威清单之外的路径，兼容 workspace_exec 等盲区与多任务并发）。
  subscribeGewuEvent(gewuEvents.agentTaskDone, (detail) => {
    if (!detail?.conversationId || !Array.isArray(detail.filesChanged)) return;
    const authoritative = detail.filesChanged.filter(
      (item) => item && typeof item.path === 'string'
    );
    if (authoritative.length === 0) return;
    const bucket = changesByConversation.get(detail.conversationId) ?? new Map<string, ConversationFileChange>();
    const now = Date.now();
    for (const item of authoritative) {
      const existing = bucket.get(item.path);
      bucket.set(item.path, {
        path: item.path,
        status: item.status === 'created' ? 'created' : 'modified',
        lastChangedAt: existing?.lastChangedAt ?? now,
        // UI-273 — 权威清单携带执行步骤归属（旧格式清单无此字段则保留 live 值）
        iteration:
          typeof item.iteration === 'number' ? item.iteration : existing?.iteration,
        tool: typeof item.tool === 'string' ? item.tool : existing?.tool,
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
  status: 'created' | 'modified',
  /** UI-273 — 执行步骤归属（迭代号 + 工具名），未知时缺省 */
  attribution?: { iteration?: number; tool?: string }
): void {
  if (!conversationId || !path) return;
  ensureSubscribed();
  const bucket = changesByConversation.get(conversationId) ?? new Map<string, ConversationFileChange>();
  bucket.set(path, {
    path,
    status,
    lastChangedAt: nextStamp(),
    iteration: attribution?.iteration,
    tool: attribution?.tool,
  });
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


/** 会话改动清空（提交/还原后由调用方触发全量刷新用不到此函数时勿滥用）。 */
export function clearConversationFileChanges(conversationId: string): void {
  if (changesByConversation.delete(conversationId)) {
    invalidateSnapshot(conversationId);
    emitChange();
  }
}

// ============================================================
// UI-446 — 审阅 tab 未读圆点判定（BLOCK-123 G-01）
//
// 语义：当前会话存在晚于「已读时间戳」的改动 → 未读（圆点亮）；
// 打开审阅 tab 即 acknowledge（圆点熄灭），之后的新改动重新点亮。
// 设计边界：不复活 2026-09-09 被用户裁决移除的聊天区改动卡片
// （c0e92dd0：信息已在工具行与审阅面板呈现，卡片冗余且空会话噪音）——
// 本判定只服务右栏 tab 药丸上的极轻圆点，不新增聊天区内容。
// ============================================================

/** 每会话已读时间戳（打开审阅 tab 时写入）。 */
const acknowledgedAtByConversation = new Map<string, number>();

/** 纯计数：改动列表 + 已读时间戳 → 未审文件数。导出供测试直接断言。 */
export function countUnreviewedConversationChanges(
  changes: ConversationFileChange[],
  acknowledgedAt: number | undefined
): number {
  if (changes.length === 0) return 0;
  const ack = acknowledgedAt ?? 0;
  return changes.filter((change) => change.lastChangedAt > ack).length;
}

/** 打开审阅 tab 即调用：记录已读时间戳（当前时刻）。 */
export function acknowledgeConversationChanges(
  conversationId: string | undefined | null
): void {
  if (!conversationId) return;
  ensureSubscribed();
  acknowledgedAtByConversation.set(conversationId, nextStamp());
  invalidateSnapshot(conversationId);
  emitChange();
}

/** useSyncExternalStore 订阅面（仅模块内 hook 使用，不导出——knip 保留面纪律）。 */
function subscribeConversationChanges(listener: ChangeListener): () => void {
  ensureSubscribed();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 当前会话未审文件数（非钩子取数，测试与消费方共用）。 */
export function getConversationUnreviewedCount(
  conversationId: string | undefined | null
): number {
  return countUnreviewedConversationChanges(
    getConversationFileChanges(conversationId),
    acknowledgedAtByConversation.get(conversationId ?? '')
  );
}

/** 当前会话未审文件数（右栏审阅 tab 计数徽章数据源）。 */
export function useConversationUnreviewedCount(
  conversationId: string | undefined | null
): number {
  useSyncExternalStore(
    subscribeConversationChanges,
    () => getConversationFileChanges(conversationId)
  );
  return getConversationUnreviewedCount(conversationId);
}

// ============================================================
// BLOCK-40 P2 — reload 后会话改动水合
//
// 数据源：GET /api/ai/agent/conversation-changes?conversationId=
// （tasks.files_changed_json 权威清单跨任务合并，见 routes/ai-agent/
// conversation-changes.js）。纪律：
//   - 只填充 live/已有记录缺失的路径（live 记录与权威对账优先，不覆盖）
//   - in-flight 去重 + 每会话每页面生命周期只拉取一次
//   - 失败静默：维持现状全量视图回退，不新增报错面
// ============================================================

/** 权威清单端点返回的单条改动（后端 camelCase 字段）。 */
interface HydratedChangeItem {
  path?: unknown;
  status?: unknown;
  iteration?: unknown;
  tool?: unknown;
  lastChangedAt?: unknown;
}

/** epoch ms 解析：ISO 字符串 / 数字均可，不可解析时回退 Date.now()。 */
function toEpochMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
}

/** 把权威清单条目合并进内存索引（只填充缺失路径，不覆盖已有记录）。 */
export function mergeConversationFileChanges(
  conversationId: string | undefined | null,
  items: HydratedChangeItem[]
): void {
  if (!conversationId || !Array.isArray(items)) return;
  const valid = items.filter(
    (item): item is { path: string } & HydratedChangeItem =>
      Boolean(item) && typeof item.path === 'string' && item.path.length > 0
  );
  if (valid.length === 0) return;
  ensureSubscribed();
  const bucket = changesByConversation.get(conversationId) ?? new Map<string, ConversationFileChange>();
  for (const item of valid) {
    if (bucket.has(item.path)) continue; // live / 已有记录优先，不覆盖
    bucket.set(item.path, {
      path: item.path,
      status: item.status === 'created' ? 'created' : 'modified',
      lastChangedAt: toEpochMs(item.lastChangedAt),
      iteration: typeof item.iteration === 'number' ? item.iteration : undefined,
      tool: typeof item.tool === 'string' ? item.tool : undefined,
    });
  }
  changesByConversation.set(conversationId, bucket);
  invalidateSnapshot(conversationId);
  emitChange();
}

const hydrateInFlight = new Map<string, Promise<void>>();
const hydratedOnce = new Set<string>();

/**
 * 从后端权威清单水合某会话的改动归属（挂载/切会话时调用）。
 * 同会话只拉取一次（含并发去重）；失败静默维持全量回退。
 */
export function hydrateConversationFileChanges(
  conversationId: string | undefined | null
): Promise<void> {
  if (!conversationId) return Promise.resolve();
  if (hydratedOnce.has(conversationId)) return Promise.resolve();
  const inFlight = hydrateInFlight.get(conversationId);
  if (inFlight) return inFlight;
  const promise = (async () => {
    try {
      const res = await fetch(
        `${getApiPrefix()}/ai/agent/conversation-changes?conversationId=${encodeURIComponent(conversationId)}`
      );
      if (res.ok) {
        const data = (await res.json()) as { changes?: HydratedChangeItem[] };
        mergeConversationFileChanges(
          conversationId,
          Array.isArray(data?.changes) ? data.changes : []
        );
      }
      // 非 2xx（400 校验失败 / 500 查询失败）— 诚实回退现状全量视图
    } catch {
      // 网络失败静默：不新增报错面
    } finally {
      hydrateInFlight.delete(conversationId);
      hydratedOnce.add(conversationId);
    }
  })();
  hydrateInFlight.set(conversationId, promise);
  return promise;
}

// ============================================================
// UI-449（C-16）— 审阅徽章 ±行数（权威源=后端 git shortstat，前端不数行）
// per-conversation 缓存 + 20s TTL；桥失败回落旧值/null，绝不抛。
// ============================================================

export interface ConversationShortstat {
  tracked: { files: number; added: number; removed: number };
  untrackedFiles: number;
  empty: boolean;
}

const SHORTSTAT_TTL_MS = 20_000;
const shortstatCache = new Map<string, { at: number; stat: ConversationShortstat | null }>();

export function formatShortstatBadge(
  count: number,
  stat: { added: number; removed: number } | null | undefined,
): string {
  if (count <= 0) return '';
  if (stat && (stat.added > 0 || stat.removed > 0)) return `${count}·+${stat.added}−${stat.removed}`;
  return String(count);
}

export async function refreshConversationShortstat(
  conversationId: string,
  projectId: string,
  options: { force?: boolean } = {},
): Promise<ConversationShortstat | null> {
  const cached = shortstatCache.get(conversationId);
  const now = Date.now();
  if (!options.force && cached && now - cached.at < SHORTSTAT_TTL_MS) return cached.stat;
  let stat: ConversationShortstat | null = null;
  try {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) throw new BridgeUnavailableError('workingTreeReview');
    const resp = await bridge.workingTreeShortstat({ projectId });
    if (resp && resp.ok && resp.data) stat = resp.data;
  } catch {
    stat = cached ? cached.stat : null;
  }
  shortstatCache.set(conversationId, { at: now, stat });
  return stat;
}

export function __resetShortstatCacheForTest(): void {
  shortstatCache.clear();
}

/** UI-449（C-16）— 徽章 ±行数取数 hook：enabled（通常=有未审改动）时拉 shortstat，
 *  带 20s TTL 节流；桥不可用/失败回落 null（徽章回落纯计数）。
 *  禁 setState 同步进 effect（lint 红线）：键控 entry 派生返回，会话切换即失效，无残留闪现。 */
export function useConversationShortstat(
  conversationId: string | null,
  projectId: string | null,
  enabled: boolean,
): ConversationShortstat | null {
  const [entry, setEntry] = useState<{ conv: string; stat: ConversationShortstat } | null>(null);
  useEffect(() => {
    if (!enabled || !conversationId || !projectId) return;
    let alive = true;
    void refreshConversationShortstat(conversationId, projectId).then((value) => {
      if (alive && value) setEntry({ conv: conversationId, stat: value });
    });
    return () => {
      alive = false;
    };
  }, [conversationId, projectId, enabled]);
  return entry && entry.conv === conversationId ? entry.stat : null;
}
