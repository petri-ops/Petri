/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — scrollToLine API（P1 落地）
 *
 * 暴露给 EditorApi 的命令面：
 * - scrollToLine(target): 滚动到目标行 + 可选 column 偏移
 * - highlight (默认 pulseMs = 3000) 时：在目标位置注入高亮 Decoration，
 *   set定时器到达后自动清除
 *
 * 设计要点（happy-dom 兼容版）：
 * - ViewPlugin.fromClass 实例持有当前 DecorationSet
 * - 用 module-level WeakMap<EditorView, PendingSpec> 跨 update 传递待应用规格
 *   （避免 React 18 strict mode 下 view 频繁销毁重建时的状态泄漏）
 * - StateEffect<PulseSpec> 仅作为 trigger，update 内读取 WeakMap
 * - 过期检查放在 plugin.update 内（避免依赖 happy-dom 的 setTimeout）
 *
 * 安全策略：
 * - 行号越界（line < 1 或 line > 行数）→ 安全 no-op
 * - column 越界 → clamp 到该行末
 * - pulseMs <= 0 → 等价 highlight = false
 *
 * 不接业务事件（P3 才接 events.ts）。
 */

import { StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

import type { ScrollTarget } from '../types';

interface PulseSpec {
  from: number;
  to: number;
  expireAt: number;
}

const PULSE_HIGHLIGHT_CLASS = 'cm-pulse-highlight';

/** 设置当前脉冲高亮区间（trigger effect；具体规格在 WeakMap）。 */
const setPulseEffect = StateEffect.define<undefined>();

/** 跨 view 更新传递的待处理脉冲规格。view 销毁时由 plugin.update 检测 view 并清理。 */
const pendingByView = new WeakMap<EditorView, PulseSpec | null>();

const pulseViewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    expireAt: number | null = null;

    constructor(view: EditorView) {
      void view;
    }

    update(update: ViewUpdate): void {
      // 触发性 effect：检查 WeakMap 是否有 pending spec
      if (pendingByView.has(update.view)) {
        const spec = pendingByView.get(update.view) ?? null;
        pendingByView.delete(update.view);
        if (spec === null) {
          this.decorations = Decoration.none;
          this.expireAt = null;
        } else {
          const { from, to, expireAt } = spec;
          const deco = Decoration.mark({ class: PULSE_HIGHLIGHT_CLASS }).range(from, to);
          this.decorations = Decoration.set([deco]);
          this.expireAt = expireAt;
        }
      }
      if (this.expireAt !== null && Date.now() >= this.expireAt) {
        this.decorations = Decoration.none;
        this.expireAt = null;
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

/** scrollToLine extension 数组。 */
export function scrollToLineExtension(): Extension {
  return [pulseViewPlugin];
}

interface ScrollApi {
  scrollToLine(target: ScrollTarget): void;
}

/**
 * 把 scrollToLine 命令绑定到具体 EditorView。
 *
 * 行号越界 → 安全 no-op；column 越界 → clamp 到行末。
 */
export function createScrollToLineApi(view: EditorView): ScrollApi {
  const pluginInstance = view.plugin(pulseViewPlugin);
  if (!pluginInstance) {
    return { scrollToLine: () => undefined };
  }

  return {
    scrollToLine(target: ScrollTarget): void {
      const { line, column = 0 } = target;
      const totalLines = view.state.doc.lines;
      if (line < 1 || line > totalLines) return;

      const lineInfo = view.state.doc.line(line);
      const safeColumn = Math.max(0, Math.min(column, lineInfo.length));
      const pos = lineInfo.from + safeColumn;

      view.dispatch({
        selection: { anchor: pos, head: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      });

      const pulseMs = target.pulseMs ?? (target.highlight ? 3000 : 0);
      if (pulseMs > 0 && pos < view.state.doc.length) {
        const highlightEnd = Math.min(pos + 1, view.state.doc.length);
        const spec: PulseSpec = {
          from: pos,
          to: highlightEnd,
          expireAt: Date.now() + pulseMs,
        };
        pendingByView.set(view, spec);
        view.dispatch({ effects: setPulseEffect.of(undefined) });
      }
    },
  };
}

