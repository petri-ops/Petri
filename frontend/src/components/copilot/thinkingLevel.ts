/**
 * thinkingLevel.ts — BLOCK-81 P2：composer 思考档位的**会话级**持久化与词表。
 *
 * 裁决依据（BLOCK-81 D1/D4，2026-09-11 用户确认）：
 *   - 三档「关闭 / 标准 / 高」，**标准＝默认＝不发任何上游参数**（零行为变化）；
 *   - 持久化层级＝**会话级**：切会话各自记忆，随会话恢复（对齐 ZCode 体感）；
 *     渠道级默认档位属后续候选，不进本期。
 *
 * 存储键沿用 composer 草稿同族形状（`proj:conv|new`），便于同一会话的 UI 态聚族管理；
 * 读写全部 try/catch 兜底——localStorage 不可用时退化为内存态，绝不影响发送。
 */

export type ThinkingLevel = 'off' | 'standard' | 'high';

export const THINKING_LEVELS: readonly ThinkingLevel[] = ['off', 'standard', 'high'];

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'standard';

/** 控件展示用短标签（中性命名，不带任何供应商语义）。 */
export const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: '关闭',
  standard: '标准',
  high: '高',
};

const PREFIX = 'gewu:thinking-level:';

function storageKey(projectId: string | null | undefined, conversationId: string | null | undefined): string {
  return `${PREFIX}${projectId || 'none'}:${conversationId || 'new'}`;
}

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value);
}

/** 归一化：非法/缺失 → 默认档（标准）。 */
export function normalizeThinkingLevel(value: unknown): ThinkingLevel {
  return isThinkingLevel(value) ? value : DEFAULT_THINKING_LEVEL;
}

export function loadThinkingLevel(
  projectId: string | null | undefined,
  conversationId: string | null | undefined
): ThinkingLevel {
  try {
    return normalizeThinkingLevel(window.localStorage.getItem(storageKey(projectId, conversationId)));
  } catch {
    return DEFAULT_THINKING_LEVEL;
  }
}

export function saveThinkingLevel(
  projectId: string | null | undefined,
  conversationId: string | null | undefined,
  level: ThinkingLevel
): void {
  try {
    window.localStorage.setItem(storageKey(projectId, conversationId), level);
  } catch {
    /* 存储不可用：仅内存态生效，发送链不受影响 */
  }
}

/**
 * 把档位迁到新建会话键下（沿用 composer 草稿迁移同款语义）：
 * 空会话发送时先建会话，档位应随会话一起落到新键，否则新会话首轮之后丢档。
 */
export function migrateThinkingLevel(
  projectId: string | null | undefined,
  sourceConversationId: string | null | undefined,
  targetConversationId: string | null | undefined
): void {
  const level = loadThinkingLevel(projectId, sourceConversationId);
  saveThinkingLevel(projectId, targetConversationId, level);
}

/** 下一个档位（快捷键 Ctrl+T 循环：标准 → 高 → 关闭 → 标准）。 */
export function nextThinkingLevel(current: ThinkingLevel): ThinkingLevel {
  const order: ThinkingLevel[] = ['standard', 'high', 'off'];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length];
}
