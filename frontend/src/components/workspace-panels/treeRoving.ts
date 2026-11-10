/**
 * BLOCK-395 B-10 — 项目树 roving tabindex + 方向键导航（纯函数，可离线断言）。
 *
 * 此前树只有 role=tree / treeitem，Tab 会依次穿过每一个 treeitem（N 个项目就 N 次 Tab），
 * 且上下键完全无效。WAI-ARIA tree 模式要求整棵树只保留一个 tab stop，
 * 焦点在树内用方向键移动。
 *
 * 本模块只做「按键 → 下一个焦点索引 / 展开折叠意图」的纯映射，
 * 不新建状态源、不改 DOM 结构；消费方在 LeftPanel 用 useState 保存 activeIndex。
 * VoiceOver 朗读与真焦点观感仍需人眼/读屏确认（Agent 不代答）。
 */
export type TreeKeyIntent =
  | { kind: 'move'; index: number }
  | { kind: 'toggle'; index: number }
  | { kind: 'home'; index: number }
  | { kind: 'end'; index: number }
  | { kind: 'none' };

export function treeRovingIntent(
  key: string,
  activeIndex: number,
  count: number,
): TreeKeyIntent {
  if (count <= 0) return { kind: 'none' };
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));
  switch (key) {
    case 'ArrowDown': return { kind: 'move', index: clamp(activeIndex + 1) };
    case 'ArrowUp': return { kind: 'move', index: clamp(activeIndex - 1) };
    case 'Home': return { kind: 'home', index: 0 };
    case 'End': return { kind: 'end', index: count - 1 };
    case 'ArrowRight': return { kind: 'toggle', index: clamp(activeIndex) };
    case 'ArrowLeft': return { kind: 'toggle', index: clamp(activeIndex) };
    default: return { kind: 'none' };
  }
}

/** roving tabindex：只有 activeIndex 那一项是 0（可 Tab 进入），其余 -1。 */
export function rovingTabIndex(index: number, activeIndex: number): 0 | -1 {
  return index === activeIndex ? 0 : -1;
}
