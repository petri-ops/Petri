// ============================================================
// terminalTabs.ts — BLOCK-54 P2「多 Tab 用户终端」纯函数助手
//
// 职责：tab 状态的创建 / 关闭 / 上限 / 标签文案（纯函数，可独立测试）。
// 不做 React / IPC / xterm（那些住在 useTerminalTabs.ts 与 BottomTerminal.tsx）。
// 上限 4 对齐后端 terminal.js MAX_TERMINAL_TABS（codex 64 上限哲学取 GUI 小值）。
// ============================================================

/** 终端 tab 数量上限（与主进程 MAX_TERMINAL_TABS 对齐，双端同值防漂移）。 */
export const MAX_TERMINAL_TABS = 4;

/** 单个终端 tab（composer 状态；session 生命周期归 useTerminalTabs 管）。 */
export interface TerminalTab {
  /** 稳定唯一 id（递增序号，不会因关闭复用——关闭后新 tab 用新 id，避免撞上还在退出的旧 pty）。 */
  id: string;
  /** tab 创建时绑定的 cwd（通常为当前项目 workspace）。 */
  cwd?: string;
  /** 递增序号（标签文案用，关闭不复用）。 */
  seq: number;
  /** 该 tab 的 pty 是否已退出（退出后保留回显，允许关闭后开新 tab）。 */
  exited: boolean;
}

/** 创建一个新 tab；已达上限时返回 { limitReached: true } 且原数组不变。 */
export function createTerminalTab(
  tabs: TerminalTab[],
  cwd?: string,
): { tabs: TerminalTab[]; tab: TerminalTab } | { limitReached: true; tabs: TerminalTab[] } {
  if (tabs.length >= MAX_TERMINAL_TABS) return { limitReached: true, tabs };
  const maxSeq = tabs.reduce((m, t) => Math.max(m, t.seq), 0);
  const tab: TerminalTab = { id: `tab-${maxSeq + 1}`, cwd, seq: maxSeq + 1, exited: false };
  return { tabs: [...tabs, tab], tab };
}

/** 关闭一个 tab 并给出下一个激活 id（优先右邻，否则左邻，空则 null）。 */
export function closeTerminalTab(
  tabs: TerminalTab[],
  id: string,
): { tabs: TerminalTab[]; nextActiveId: string | null } {
  const index = tabs.findIndex((t) => t.id === id);
  if (index < 0) return { tabs, nextActiveId: null };
  const rest = tabs.filter((t) => t.id !== id);
  const nextActiveId = rest[index]?.id ?? rest[index - 1]?.id ?? null;
  return { tabs: rest, nextActiveId };
}

/** tab 标签文案：`终端 N`（seq 稳定，不随其他 tab 关闭漂移）。 */
export function terminalTabLabel(tab: TerminalTab): string {
  return `终端 ${tab.seq}`;
}

/** tab 副标题：cwd 基名（无 cwd 时不显示）。 */
export function terminalTabSubtitle(tab: TerminalTab): string {
  if (!tab.cwd) return '';
  const parts = tab.cwd.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || tab.cwd;
}
