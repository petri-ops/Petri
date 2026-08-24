/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — scrollToLine extension 占位
 *
 * P0 阶段仅 stub。P3 才会落地的内容：
 * - 暴露 `scrollToLine(line: number, options?: { pulse?: boolean })` API
 * - 默认 pulse 持续 3000ms（用 CM6 Decoration + ViewPlugin 实现高亮闪烁）
 * - 不接业务事件，只暴露命令面
 *
 * 注意：P0 不实际挂任何 ViewPlugin；该占位符仅让 types.ts 的 EditorApi 在 P3 扩展时
 * 有处可加实现。
 */

import type { Extension } from '@codemirror/state';

export interface ScrollToLineOptions {
  /** 是否高亮闪烁目标行，默认 false。P3 实际语义为持续 3000ms。 */
  pulse?: boolean;
}

/** P0 stub：返回空 extension。P3 才会真正实现。 */
export function scrollToLineExtension(): Extension {
  return [];
}
