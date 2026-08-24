/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — acceptRejectWidget 占位
 *
 * P0 阶段仅 stub。P2 才会落地的内容：
 * - 每个 hunk 旁注入 CM6 WidgetType 按钮（Accept / Reject）
 * - ViewPlugin 跟踪当前可见的 hunk 列表
 * - 复用 BLOCK-20 PHASE 1 已备 IPC：
 *   - `git:apply-inverse-hunk` (Accept Hunk)
 *   - `git:hunk-reject-inverse` (Reject Hunk + 注入 reject 清单)
 */

export interface AcceptRejectContext {
  /** 旧文本（baseline）。 */
  baseline: string;
  /** 新文本（proposed）。 */
  proposed: string;
  /** 当前文件工作区相对路径，用于 reject IPC。 */
  path: string;
}

export interface AcceptRejectCallbacks {
  onAccept(hunkIndex: number): void | Promise<void>;
  onReject(hunkIndex: number): void | Promise<void>;
}

/** P0 stub：P2 才会真正构造 WidgetType / ViewPlugin。 */
export function buildAcceptRejectWidget(
  _context: AcceptRejectContext,
  _callbacks: AcceptRejectCallbacks,
): unknown {
  return null;
}
