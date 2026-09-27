// ============================================================
// UI-448 — composer 占位符档位（v2 的「单一输入面让位件」已于 v14 退役：
// 用户裁决侧聊与主会话并存互不冲突，主会话 composer 不再让位）。
// ============================================================

/** 中栏宽列的完整键位提示。 */
export const COMPOSER_PLACEHOLDER_FULL = '输入消息… (Enter 发送, Shift+Enter 换行, ↑/↓ 回溯历史)';

/** compact 档（300px 悬浮面/列区）用短占位符，完整键位提示在窄面内会折两行。 */
export function composerPlaceholder(compact?: boolean): string {
  return compact ? '输入消息…' : COMPOSER_PLACEHOLDER_FULL;
}
