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
 * 实现路径：
 * - `ViewPlugin.fromClass` 监听 view update 后给 hunk chunks 写 `data-hunk-id`，
 *   避免每次 render 都 query DOM
 * - click 事件在 `view.contentDOM` 上挂 addEventListener，
 *   通过 `data-accept-hunk` / `data-reject-hunk` 属性路由到 `opts.onAccept/onReject`
 * - 新增 `AcceptRejectDecorationsPlugin`（同 ViewPlugin）提供 Decoration：
 *   - 遍历 `[data-hunk-id]` 元素，计算行尾 doc 位置
 *   - `InlineButtonWidget` / `FloatingButtonWidget`（继承 `WidgetType`），
 *     `toDOM()` 返回 `buildInlineButtonGroup` / `buildFloatingButtonGroup`
 *   - 两种形态都用 `Decoration.widget({ widget, side: 1 })` 嵌入行尾
 *
 * 不变量：
 * - 不修改 `originalText` / `modifiedText`
 * - 不修改 `cm-deletedChunk` / `cm-insertedLine` 既有 class
 * - 按钮 widget 是 inline-block / absolute positioned，不破坏 CM6 布局
 */

import {
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type EditorView,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import {
  RangeSetBuilder,
  type Extension,
} from '@codemirror/state';

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
export function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

// ─── WidgetType subclasses (Task 1) ──────────────────────────────────────────

/**
 * Inline button widget：inline 形态，`side: 1` 嵌入行尾，CSS 样式让它 inline-flex。
 */
class InlineButtonWidget extends WidgetType {
  constructor(
    private readonly hunk: DiffHunk,
    private readonly callbacks: AcceptRejectWidgetCallbacks,
  ) {
    super();
  }

  toDOM(_view: EditorView): HTMLElement {
    return buildInlineButtonGroup(this.hunk, this.callbacks);
  }

  eq(other: InlineButtonWidget): boolean {
    return other.hunk.id === this.hunk.id;
  }
}

/**
 * Floating button widget：`side: 1` 嵌入行尾，CSS 的 `position: absolute` 把它
 * 推到 `.cm-scroller`（`position: relative`）右侧；多个 floating hunk 的 top 值
 * 通过首 chunk 相对 scroller 的像素偏移区分，滚动时跟随文档流自然移动。
 */
class FloatingButtonWidget extends WidgetType {
  constructor(
    private readonly hunk: DiffHunk,
    private readonly callbacks: AcceptRejectWidgetCallbacks,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const host = buildFloatingButtonGroup(this.hunk, this.callbacks);
    // 计算首 chunk 在 scroller 中的相对 y 坐标，用于在滚动时让按钮跟随文档位置
    const selector = `[${DATA_HUNK_ID}="${cssEscape(this.hunk.id)}"]`;
    const firstEl = view.contentDOM.querySelector<HTMLElement>(selector);
    if (firstEl) {
      const elRect = firstEl.getBoundingClientRect();
      const scrollerRect = view.scrollDOM.getBoundingClientRect();
      // elRect.top - scrollerRect.top = 元素相对 scroller 顶部的像素偏移
      const relativeTop = elRect.top - scrollerRect.top;
      host.style.top = `${relativeTop}px`;
    }
    return host;
  }

  eq(other: FloatingButtonWidget): boolean {
    return other.hunk.id === this.hunk.id;
  }
}

// ─── Decorations Plugin (Task 1) ─────────────────────────────────────────────

interface DecorationsPluginValue {
  decorations: DecorationSet;
}

/**
 * 在 hunk 行末尾注入 accept/reject 按钮 widget：
 * - 遍历 `view.contentDOM` 中已由 tagHunkChunks 写入的 `[data-hunk-id]` 元素
 * - 按 hunk 大小决定形态（inline ≤ 5 行，floating > 5 行）
 * - 计算行末尾 doc 位置，用 `Decoration.widget({ widget, side: 1 })` 嵌入
 * - 用 `ViewPlugin.decorations` 接口暴露 DecorationSet
 *
 * 注意：本 plugin 与主 plugin（tagHunkChunks + click 路由）并行运行；
 * 两者均通过 `ViewPlugin.fromClass` 创建，extension 数组按顺序处理，
 * 所以主 plugin 的 tagHunkChunks 先执行，本 plugin 的 update 读取到最新 DOM。
 */
function createDecorationsPlugin(options: AcceptRejectWidgetOptions) {
  const { callbacks, getHunks } = options;

  return ViewPlugin.fromClass(
    class implements DecorationsPluginValue {
      decorations: DecorationSet = Decoration.none;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate): void {
        if (!update.docChanged && !update.viewportChanged && !update.geometryChanged) {
          return;
        }
        this.decorations = this.buildDecorations(update.view);
      }

      private buildDecorations(view: EditorView): DecorationSet {
        const hunks = getHunks?.() ?? [];
        if (hunks.length === 0) return Decoration.none;

        const builder = new RangeSetBuilder<Decoration>();

        for (const hunk of hunks) {
          const escaped = cssEscape(hunk.id);
          const selector = `[${DATA_HUNK_ID}="${escaped}"]`;
          const elements = view.contentDOM.querySelectorAll<HTMLElement>(selector);
          if (elements.length === 0) continue;

          // 取最后一个 chunk 所在行，追加 widget 于该行末尾（side: 1 = after cursor/line）
          const lastEl = elements[elements.length - 1];
          // 优先取 .cm-line 子元素；若无则直接取 lastEl
          const lineEl =
            (lastEl.querySelector<HTMLElement>('.cm-line') as HTMLElement | null) ?? lastEl;

          try {
            // posAtDOM 从 DOM 节点得到文档位置（0-based）
            const domStart = view.posAtDOM(lineEl);
            // 该行在文档中不一定连续（可能有其他标记），用 lineAt 获取行的真实边界
            const lineInfo = view.state.doc.lineAt(domStart);
            const pos = lineInfo.to; // 行末尾

            const form = pickWidgetForm(hunk, view);
            const widget =
              form === 'inline'
                ? new InlineButtonWidget(hunk, callbacks)
                : new FloatingButtonWidget(hunk, callbacks);

            // side: 1 → 插入到该位置之后（行末尾之后）
            builder.add(pos, pos, Decoration.widget({ widget, side: 1 }));
          } catch {
            // posAtDOM 在 DOM 节点被 CM6 重新挂载前可能抛 RangeError；跳过
            continue;
          }
        }

        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
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

  return [plugin, createDecorationsPlugin(options)];
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