/**
 * SimpleChat/slashExecute.ts — 斜杠命令的**决策层**（BLOCK-206 / W7a，清偿 C-29）。
 *
 * 背景：`executeSlashCommand` 原本是 1664 行组件里的 `useCallback`，switch 里混着 UI 动作、
 * 上传下载与网络调用（/compact），**离线无法断言**，于是竞争力清单里 D15「斜杠即执行」
 * 一直只能记"无锚"。把"命令 → 动作类别"的判定抽成纯函数后：
 *  · 组件只负责"执行某一类动作"（副作用留在组件）；
 *  · 判定本身可被单测覆盖，D15 从此有真锚（`slashExecute.test.ts`）。
 *
 * 边界：`skill:` / `template:` 前缀仍走"注入文本模板"（结构化 chip 通道是 slashSources 里
 * 登记的 v2，不在本包范围）。
 */

export type SlashCommandKind =
  | 'new-conversation'
  | 'clear-conversation'
  | 'toggle-model-menu'
  | 'export-markdown'
  | 'compact-context'
  | 'schedule-task'
  | 'dismiss-slash'
  | 'insert-template';

const KNOWN: Record<string, SlashCommandKind> = {
  new: 'new-conversation',
  clear: 'clear-conversation',
  model: 'toggle-model-menu',
  export: 'export-markdown',
  compact: 'compact-context',
  schedule: 'schedule-task',
  help: 'dismiss-slash',
};

/**
 * 命令 id → 动作类别。
 * 未知 id 与 `help` 一样按"收起面板"处理（原实现的 default 分支就是不做事——
 * 但斜杠面板还开着，所以如实表达为 dismiss-slash，避免"静默无反应"）。
 */
export function classifySlashCommand(commandId: string): SlashCommandKind {
  const id = String(commandId ?? '');
  if (id.startsWith('skill:') || id.startsWith('template:')) return 'insert-template';
  return KNOWN[id] ?? 'dismiss-slash';
}
