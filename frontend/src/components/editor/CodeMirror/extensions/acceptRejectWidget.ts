/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — acceptRejectWidget extension (P2 落地)
 *
 * 设计要点：
 * - 形态切换：单 hunk ≤ 5 行 → 行内 inline（按钮嵌在 hunk 末尾）
 *              单 hunk > 5 行 → floating（按钮悬浮在编辑器右侧）
 * - 数据源：`DiffRevision.hunks[]`（P0+P1 已落地类型），按 `hunk.id` 渲染
 * - 不接业务侧 dispatch（**P3 才接 events.ts**）
 * - 不接 IPC（**P3 才接 desktopBridge**）；P2 仅暴露 `onAccept` / `onReject` 回调，
 *   由 `useCodeMirrorEditor` 在 IPC 失败时 dispatch `onError`
 *
 * 实现路径（避免引入 `ViewPlugin` 装饰器的开销）：
 * - `WidgetType.line` 注入两种形态按钮
 * - `getHunkLineCount(hunkId)` 用 `view.contentDOM.querySelectorAll` 统计
 *   `.cm-deletedChunk` / `.cm-insertedLine` 元素
 * - `ViewPlugin.fromClass` 监听 view update 后给 hunk chunks 写 `data-hunk-id`，
 *   避免每次 render 都 query DOM
 * - click 事件在 `view.contentDOM` 上挂 addEventListener，
 *   通过 `data-accept-hunk` / `data-reject-hunk` 属性路由到 `opts.onAccept/onReject`
 *
 * 不变量：
 * - 不修改 `originalText` / `modifiedText`
 * - 不修改 `cm-deletedChunk` / `cm-insertedLine` 既有 class
 * - 按钮 widget 是 inline-block / absolute positioned，不破坏 CM6 布局
 */

import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

import type { DiffHunk } from '../types';

/** inline 形态阈值：单 hunk 行数 ≤ 此值走 inline。 */
export const INLINE_THRESHOLD_LINES = 5;

export interface AcceptRejectWidgetCallbacks {
  /** Accept 按钮点击回调；P2 仅回调，不接事件总线。 */
  onAccept(hunkId: string): void;
  /** Reject 按钮点击回调。 */
  onReject(hunkId: string): void;
}

export interface AcceptRejectWidgetOptions {
  /** Accept / Reject 回调。 */
  callbacks: AcceptRejectWidgetCallbacks;
  /**
   * 视图层 hunk 列表（来自 `DiffRevision.hunks`）。缺省视为无 hunk。
   * 可选：上层可在 hunk 列表变化时通过该闭包传新值（不要求 reactive）。
   */
  getHunks?: () => DiffHunk[];
}

/**
 * Button group 的形态：inline 或 floating。
 */
type WidgetForm = 'inline' | 'floating';

/** 测试导出：button 上的 dataset key。 */
export const DATA_ACCEPT_HUNK = 'data-accept-hunk';
export const DATA_REJECT_HUNK = 'data-reject-hunk';
export const DATA_HUNK_ID = 'data-hunk-id';

/** 测试导出：floating widget 的 host data attribute。 */
export const DATA_FLOATING_HOST = 'data-cm6-accept-reject-host';

/**
 * 计算单 hunk 在 view DOM 中占用的"行级块元素"数量：
 * - `.cm-deletedChunk` = 1 个容器（行级块）
 * - `.cm-insertedLine` (= `<ins class="cm-insertedLine">`) = 1 个容器
 *
 * 返回 0 表示找不到（hunk 已被 widget 清除 / 文档状态变化）。
 */
export function getHunkLineCount(view: EditorView, hunkId: string): number {
  const root = view.contentDOM;
  // CM6 给 hunk 内的行级容器写了 data-hunk-id（由 ViewPlugin.update 维护）
  const nodes = root.querySelectorAll<HTMLElement>(`[${DATA_HUNK_ID}="${cssEscape(hunkId)}"]`);
  return nodes.length;
}

/**
 * 给 hunk 行级容器写 data-hunk-id：
 * - `hunks[]` 中的 chunk 按出现顺序 1:1 映射到 view 内的 `.cm-deletedChunk` /
 *   `.cm-insertedLine` 序列
 * - ViewPlugin.update 内做 assignment（避免每次 update 重新 query）
 */
function tagHunkChunks(view: EditorView, hunks: DiffHunk[]): void {
  const root = view.contentDOM;
  const allChunks: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>('.cm-deletedChunk, .cm-insertedLine').forEach((node) => {
    // 仅取"未嵌套在另一个 chunk 内的"顶级块
    if (!node.parentElement?.closest('.cm-deletedChunk, .cm-insertedLine')) {
      allChunks.push(node);
    }
  });
  let cursor = 0;
  for (const hunk of hunks) {
    const lines = Math.max(1, hunk.endLine - hunk.startLine + 1);
    for (let i = 0; i < lines && cursor < allChunks.length; i++) {
      const chunk = allChunks[cursor];
      if (chunk) chunk.setAttribute(DATA_HUNK_ID, hunk.id);
      cursor++;
    }
  }
}

/**
 * 构造 inline 形态按钮组（嵌在 hunk 末尾）。
 *
 * 该 widget 必须在父 `ViewUpdate` 中根据 `getHunkLineCount <= INLINE_THRESHOLD_LINES`
 * 才挂入；本函数只负责 DOM。
 */
function buildInlineButtonGroup(hunk: DiffHunk, callbacks: AcceptRejectWidgetCallbacks): HTMLElement {
  const group = document.createElement('span');
  group.className = 'cm-accept-reject-widget-inline';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', `Accept or reject hunk ${hunk.id}`);
  group.appendChild(buildAcceptButton(hunk.id, callbacks));
  group.appendChild(buildRejectButton(hunk.id, callbacks));
  return group;
}

/** floating 形态：absolute 定位，挂在 editor scroller 顶层。 */
function buildFloatingButtonGroup(hunk: DiffHunk, callbacks: AcceptRejectWidgetCallbacks): HTMLElement {
  const group = document.createElement('div');
  group.className = 'cm-accept-reject-widget-floating';
  group.setAttribute(DATA_FLOATING_HOST, hunk.id);
  group.appendChild(buildAcceptButton(hunk.id, callbacks));
  group.appendChild(buildRejectButton(hunk.id, callbacks));
  return group;
}

function buildAcceptButton(hunkId: string, callbacks: AcceptRejectWidgetCallbacks): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cm-accept-button';
  btn.textContent = '✓';
  btn.setAttribute('aria-label', `Accept hunk ${hunkId}`);
  btn.setAttribute('title', 'Accept hunk');
  btn.setAttribute(DATA_ACCEPT_HUNK, hunkId);
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    callbacks.onAccept(hunkId);
  });
  return btn;
}

function buildRejectButton(hunkId: string, callbacks: AcceptRejectWidgetCallbacks): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cm-reject-button';
  btn.textContent = '✗';
  btn.setAttribute('aria-label', `Reject hunk ${hunkId}`);
  btn.setAttribute('title', 'Reject hunk');
  btn.setAttribute(DATA_REJECT_HUNK, hunkId);
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    callbacks.onReject(hunkId);
  });
  return btn;
}

/** CSS.escape polyfill for selectors that may include non-ASCII characters in hunk ids. */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

/**
 * 选择 widget 形态：基于 hunk 行级块数。
 */
export function pickWidgetForm(hunk: DiffHunk, view: EditorView): WidgetForm {
  const count = getHunkLineCount(view, hunk.id);
  if (count === 0) return 'floating';
  return count <= INLINE_THRESHOLD_LINES ? 'inline' : 'floating';
}

/**
 * 创建 P2 accept / reject widget 扩展：
 *
 * - ViewPlugin 在 view 变化后给 hunk 行级容器打 `data-hunk-id`
 * - click listener 挂在 `view.contentDOM` 上，拦截 button 事件转发回调
 * - 扩展本身不直接构造 Decoration / WidgetType 行内嵌入；
 *   真正的"在 hunk 末尾嵌入按钮"由 hook 层（`useCodeMirrorEditor`）
 *   在 mount 时按形态决策，本文件只提供按钮组构造 + click 路由
 *
 * 用法：
 * ```ts
 * const ext = createAcceptRejectWidgetExtension({
 *   callbacks: { onAccept, onReject },
 *   getHunks: () => diffRevision?.hunks ?? [],
 * });
 * ```
 */
export function createAcceptRejectWidgetExtension(
  options: AcceptRejectWidgetOptions,
): Extension {
  const { callbacks, getHunks } = options;
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        // 初始 attach click listener + 首次 tag
        attachClickListener(view, callbacks);
        if (getHunks) tagHunkChunks(view, getHunks());
      }

      update(update: ViewUpdate): void {
        if (!update.docChanged && !update.viewportChanged && !update.geometryChanged) {
          return;
        }
        if (getHunks) tagHunkChunks(update.view, getHunks());
      }

      destroy(): void {
        // listener 是 contentDOM-level；view.destroy 会清空 DOM，无需手动 remove
      }
    },
  );

  return [plugin];
}

function attachClickListener(view: EditorView, callbacks: AcceptRejectWidgetCallbacks): void {
  const root = view.contentDOM;
  // 幂等守卫：避免 mount 之后 [mode] / [diffRevision] effect 重新 reconfigure
  // 时重复附加 listener。数据属性挂在 view.contentDOM 上，view.destroy() 自动清除。
  if ((root as HTMLElement & { __cm6AcceptRejectWired?: boolean }).__cm6AcceptRejectWired) {
    return;
  }
  (root as HTMLElement & { __cm6AcceptRejectWired?: boolean }).__cm6AcceptRejectWired = true;
  const handler = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const acceptId = target.closest<HTMLElement>(`[${DATA_ACCEPT_HUNK}]`)?.getAttribute(DATA_ACCEPT_HUNK);
    if (acceptId) {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onAccept(acceptId);
      return;
    }
    const rejectId = target.closest<HTMLElement>(`[${DATA_REJECT_HUNK}]`)?.getAttribute(DATA_REJECT_HUNK);
    if (rejectId) {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onReject(rejectId);
    }
  };
  root.addEventListener('click', handler);
}

/**
 * 测试导出：构造 inline / floating 按钮组（mock 测试用）。
 */
export const __buildInlineButtonGroup = buildInlineButtonGroup;
export const __buildFloatingButtonGroup = buildFloatingButtonGroup;