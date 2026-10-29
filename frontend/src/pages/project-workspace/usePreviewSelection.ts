// ============================================================
// usePreviewSelection.ts — BLOCK-246 C12 文件预览的选区生产者
//
// 职责：把「用户在预览里划了一段字」变成四个动作（复制 / 加入对话 / 加入速记 /
// 侧聊提问 + 批注不可用）。它是 `selectionQuote` 事件**第一个生产者**——此前
// 该事件只有消费方（composer），管线是半截的。
//
// 测量口径：
//   · CodeMirror 面优先用 `EditorApi.getSelection()`（有真实行号，引用块才有
//     `path:L42-L48` 的定位）；
//   · Markdown 渲染视图用 `window.getSelection()`（无行号，如实留空，不猜）。
// ============================================================
import { useCallback, useMemo, useState, type RefObject } from 'react';
import { dispatchPetriEvent, petriEvents } from '@/lib/events';
// UI-627（BLOCK-321）— 侧聊入口改开原生独立窗
import { openSideChatWindow } from '@/lib/sideChatWindow';
import { createScratchpad } from '@/lib/scratchpadClient';
import {
  buildSelectionActions,
  selectionAnchor,
  selectionQuoteDetail,
  selectionScratchpadInput,
  type SelectionActionId,
} from '@/components/copilot/SimpleChat/selectionActions';
import type { TextAnchor } from '@/lib/annotations';

interface PreviewSelectionState {
  text: string;
  /** 选区矩形左上角（视口坐标）。 */
  x: number;
  y: number;
  startLine?: number;
  endLine?: number;
}

export interface PreviewSelectionOptions {
  containerRef: RefObject<HTMLElement | null>;
  projectId?: string;
  filePath?: string;
  fileName?: string;
  /** BLOCK-246 C16 — 代码面的语言（有值 → 引用块按围栏代码块渲染）。 */
  language?: string;
  /** 编辑器面选区读出（CodeMirror 面才有行号）。 */
  getEditorSelection?: () => { text: string; startLine: number; endLine: number } | null;
  /** 动作结果提示（宿主已有的 notice 条）。 */
  onNotice?: (message: string | null) => void;
  /**
   * BLOCK-254 P5 — 文本批注入口。宿主收到锚点后打开评论输入（同一 annotation session），
   * 保证「批注」仍只有一条落库通道。
   */
  onAnnotate?: (anchor: TextAnchor) => void;
}

export interface PreviewSelectionApi {
  selection: PreviewSelectionState | null;
  actions: ReturnType<typeof buildSelectionActions>;
  /** 选区变化后由容器 onMouseUp/onKeyUp 调用。 */
  capture: () => void;
  dismiss: () => void;
  pick: (id: SelectionActionId) => Promise<void>;
}

function rectOf(range: Range): { x: number; y: number } {
  const rect = range.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}

export function usePreviewSelection(options: PreviewSelectionOptions): PreviewSelectionApi {
  const { containerRef, projectId, filePath, fileName, language, getEditorSelection, onNotice, onAnnotate } = options;
  const [selection, setSelection] = useState<PreviewSelectionState | null>(null);

  const capture = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const fromEditor = getEditorSelection?.();
    if (fromEditor && fromEditor.text.trim()) {
      const widget = container.getBoundingClientRect();
      setSelection({
        text: fromEditor.text,
        x: widget.left + 24,
        y: widget.top + 24,
        startLine: fromEditor.startLine,
        endLine: fromEditor.endLine,
      });
      return;
    }
    const domSelection = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!domSelection || domSelection.isCollapsed || domSelection.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const text = domSelection.toString();
    if (!text.trim()) {
      setSelection(null);
      return;
    }
    // 只认容器内的选区：别处的选中（比如左栏会话标题）不该弹本预览的动作条。
    const range = domSelection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    const point = rectOf(range);
    setSelection({ text, x: point.x, y: point.y });
  }, [containerRef, getEditorSelection]);

  const dismiss = useCallback(() => setSelection(null), []);

  const actions = useMemo(() => buildSelectionActions({
    charCount: selection ? selection.text.length : 0,
    // 只有「有路径 + 有行号 + 宿主提供了批注出口」才算可用，否则给出一条具体理由。
    annotate: {
      available: Boolean(filePath && onAnnotate && Number.isInteger(selection?.startLine)),
      reason: !filePath
        ? '缺少文件路径，无法把批注锚定到文件'
        : !onAnnotate
          ? '当前预览面不支持文本批注'
          : undefined,
    },
  }), [filePath, onAnnotate, selection]);

  const pick = useCallback(async (id: SelectionActionId) => {
    if (!selection) return;
    const source = {
      path: filePath ?? '',
      name: fileName,
      projectId,
      startLine: selection.startLine,
      endLine: selection.endLine,
      language,
    };
    const text = selection.text;
    try {
      if (id === 'copy') {
        await navigator.clipboard.writeText(text);
        onNotice?.('已复制选中文字');
        setSelection(null);
        return;
      }
      if (id === 'quote') {
        const detail = selectionQuoteDetail(text, source);
        if (!detail) {
          onNotice?.('这段选区无法引用：缺少文件路径或内容为空');
          return;
        }
        dispatchPetriEvent(petriEvents.selectionQuote, detail);
        onNotice?.('已加入对话输入框，可随时移除');
        setSelection(null);
        return;
      }
      if (id === 'scratchpad') {
        const input = selectionScratchpadInput(text, source);
        if (!input) {
          onNotice?.('这段选区无法存为速记：内容为空');
          return;
        }
        await createScratchpad(input);
        onNotice?.('已存入速记板');
        setSelection(null);
        return;
      }
      if (id === 'side-chat') {
        await navigator.clipboard.writeText(text);
        void openSideChatWindow({ projectId: projectId ?? '', sourceConversationId: null });
        onNotice?.('已复制选中文字并打开侧边会话：粘贴即可提问');
        setSelection(null);
        return;
      }
      if (id === 'annotate') {
        const anchor = selectionAnchor(text, source);
        if (!anchor) {
          onNotice?.('这段选区没有行号，无法定位批注；请切换到代码视图再试');
          return;
        }
        if (!onAnnotate) {
          onNotice?.('当前预览面不支持文本批注');
          return;
        }
        onAnnotate(anchor);
        setSelection(null);
        return;
      }
    } catch (error) {
      onNotice?.(error instanceof Error ? `动作失败：${error.message}` : '动作失败');
    }
  }, [filePath, fileName, language, onAnnotate, onNotice, projectId, selection]);

  return { selection, actions, capture, dismiss, pick };
}
