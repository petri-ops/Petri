/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — DiffActionBar
 *
 * 顶部 action bar：在 inline-diff 模式下挂 Accept All / Reject All / Review
 * 三个全局按钮，让用户一次性决策整个文件的 hunks，而不是逐 hunk 点击。
 *
 * 设计要点：
 * - 仅当 `mode === 'inline-diff'` 时渲染（其它 mode 视为 null 容器）
 * - 通过 prop 传入的 `apiRef` 直接调 EditorApi 暴露的方法，不持有任何
 *   与 editor 共享的状态；本组件是 stateless UI shell
 * - Accept All / Reject All 的 IPC 失败走 `onError` prop（与 CodeMirrorEditor 的
 *   onError 透传链路一致）
 * - Review 按钮：从 `getDiffRevision().hunks[0].startLine` 拿第一个 hunk
 *   起始行，调 `scrollToLine({ line })` 让视图跳到第一个 hunk
 *   （业务侧可借此实现"review 跳板"流程）
 *
 * P3 才接：事件总线 / 与外部 store 协作；当前只做"按 prop 暴露的 apiRef 调用"
 * 这一最小可用形态。
 *
 * 不接：
 * - events.ts（事件总线）
 * - 任何外部 store（zustand 等）
 * - 任何新依赖
 */

import React, { type RefObject } from 'react';

import type { EditorApi } from './types';
import styles from './DiffActionBar.module.css';

export interface DiffActionBarProps {
  /** 当前 CodeMirrorEditor 暴露的 apiRef；可能为 null（未 mount）。 */
  apiRef: RefObject<EditorApi | null>;
  /** Accept All / Reject All 失败回调；Review 失败不触发（仅本地滚动）。 */
  onError?: (err: unknown) => void;
}

/**
 * DiffActionBar：顶部水平 flex 容器，3 个按钮（Accept All / Reject All / Review）。
 *
 * 行为契约：
 * - 仅当 `apiRef.current?.getMode() === 'inline-diff'` 时渲染按钮组
 * - Accept All：await `apiRef.current.acceptAll()`；失败走 onError
 * - Reject All：await `apiRef.current.rejectAll()`；失败走 onError
 * - Review：从 `getDiffRevision().hunks[0].startLine` 拿首个 hunk 起始行，
 *   调 `scrollToLine({ line })`；无 hunks 时按钮 disabled
 *
 * @param props DiffActionBarProps
 */
export const DiffActionBar: React.FC<DiffActionBarProps> = ({ apiRef, onError }) => {
  const mode = apiRef.current?.getMode() ?? 'normal';
  const disabled = mode !== 'inline-diff';

  const handleAcceptAll = React.useCallback(async (): Promise<void> => {
    const api = apiRef.current;
    if (!api) return;
    try {
      await api.acceptAll();
    } catch (err) {
      onError?.(err);
    }
  }, [apiRef, onError]);

  const handleRejectAll = React.useCallback(async (): Promise<void> => {
    const api = apiRef.current;
    if (!api) return;
    try {
      await api.rejectAll();
    } catch (err) {
      onError?.(err);
    }
  }, [apiRef, onError]);

  const handleReview = React.useCallback((): void => {
    const api = apiRef.current;
    if (!api) return;
    const rev = api.getDiffRevision();
    const firstHunk = rev?.hunks?.[0];
    if (!firstHunk) return;
    api.scrollToLine({ line: firstHunk.startLine });
  }, [apiRef]);

  // 非 inline-diff 模式：保留容器让布局占位稳定（条件挂载由 CodeMirrorEditor
  // 通过 `showDiffActionBar` 决策；本组件自身不再 hidden / unmount，
  // 避免父布局抖动）。
  if (disabled) return null;

  return (
    <div
      className={styles.bar}
      data-block-22-diff-action-bar
      data-disabled="false"
      role="toolbar"
      aria-label="Diff actions"
    >
      <button
        type="button"
        className={`${styles.button} ${styles.accept}`}
        onClick={handleAcceptAll}
        data-action="accept-all"
      >
        Accept All
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.reject}`}
        onClick={handleRejectAll}
        data-action="reject-all"
      >
        Reject All
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.review}`}
        onClick={handleReview}
        data-action="review"
      >
        Review
      </button>
    </div>
  );
};

export default DiffActionBar;
