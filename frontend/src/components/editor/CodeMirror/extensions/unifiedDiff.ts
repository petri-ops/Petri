/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — unifiedDiff extension 占位
 *
 * P0 阶段仅 stub。P1 才会落地的内容：
 * - 封装 `@codemirror/merge` 的 `unifiedMergeView`（行级 + 字符级）
 * - 自定义 diff 主题（`.cm-deletedChunk` / `.cm-insertedChunk` / `.cm-deletedChar` / `.cm-insertedChar`）
 * - 复用既有 `--biof3-status-warning` / `--biof3-status-success` 颜色变量
 *
 * P0 仅导出空对象 + 占位类型，避免 P1 实施时找不到模块。
 */

import type { Extension } from '@codemirror/state';

export interface UnifiedDiffConfig {
  /** 旧文本（git HEAD 或磁盘原始内容）。 */
  baseline: string;
  /** 新文本（agent 写入后的当前内容）。 */
  proposed: string;
}

/** P0 stub：返回空 extension。P1 才会真正返回 unifiedMergeView。 */
export function unifiedDiffExtension(_config: UnifiedDiffConfig): Extension {
  return [];
}
