/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — unifiedDiff extension（P1 落地）
 *
 * 封装 `@codemirror/merge` 的 `unifiedMergeView`：
 * - 行级 diff（按行对比插入 / 删除 / 修改）
 * - 字符级 inline diff（`allowInlineDiffs: true`，单 token 级变更直接在同行展示）
 * - 行号 gutter 标记（`gutter: true`）
 * - **不接** Accept/Reject UI 控件（`mergeControls: false`，P2 才接）
 * - **不接** 3-way merge（统一走 single-track unified view）
 *
 * 安全策略：
 * - `diffConfig.scanLimit = 10000`：超大文件（>10k 字符变更段）走快速不精确算法，
 *   避免 O(n²) 卡 UI
 * - `diffConfig.timeout = 1000`：超过 1s 自动放弃精细 diff，退回粗算法
 *
 * 返回 extension array，挂到 Compartment 即可热切换。
 *
 * 设计约束：
 * - 工厂函数必须在 `mode === 'inline-diff'` 时才被调用
 *   （调用方 `useCodeMirrorEditor` 守卫，避免把空 baseline / 空 proposed 错误传给 CM6）
 * - `original` 字段必须 non-null：`DiffRevision.originalText` 由 types.ts 强约束为 `string`
 */

import type { Extension } from '@codemirror/state';
import { unifiedMergeView } from '@codemirror/merge';

import type { DiffRevision } from '../types';

/** 大文件保护：扫到 10k 字符变更时放弃精确算法；防 O(n²)。 */
const DIFF_SCAN_LIMIT = 10000;
/** 单次 diff 计算 1s 超时；超时回退到快速不精确算法。 */
const DIFF_TIMEOUT_MS = 1000;

/**
 * BLOCK-28 — inline-diff 渲染选项。
 * `collapseUnchanged`：折叠 hunk 间长段未变更上下文（merge view 原生
 * "⇕ 展开"控件），用于主区审阅模式的大空间 diff。
 */
export interface DiffViewOptions {
  collapseUnchanged?: { margin: number; minSize: number };
}

/**
 * 创建 unified diff extension。
 *
 * @param revision DiffRevision；`originalText` / `modifiedText` 都允许空串
 *                 （空文本用于"全新文件" / "全文件删除"场景）
 * @param options  BLOCK-28 可选渲染选项（向后兼容：缺省行为与 BLOCK-22 一致）
 */
export function createUnifiedDiffExtension(
  revision: DiffRevision,
  options?: DiffViewOptions,
): Extension[] {
  return unifiedMergeView({
    original: revision.originalText,
    // 行级 + 字符级 inline diff：同行 token 级变更直接渲染字符级高亮
    allowInlineDiffs: true,
    // 行号 gutter 标记
    gutter: true,
    // BLOCK-43：通用 Accept/Reject widget 已退休，不启用 mergeControls；
    // 业务路径的按 hunk 决策由 BLOCK-28 hunkControls 承担
    mergeControls: false,
    // BLOCK-28：hunk 间折叠未变更上下文（可选）
    ...(options?.collapseUnchanged ? { collapseUnchanged: options.collapseUnchanged } : {}),
    // 自定义 diff 算法策略；防大文件卡 UI
    diffConfig: {
      scanLimit: DIFF_SCAN_LIMIT,
      timeout: DIFF_TIMEOUT_MS,
    },
  });
}

