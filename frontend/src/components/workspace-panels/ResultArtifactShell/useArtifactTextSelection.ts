// ============================================================
// useArtifactTextSelection — 只读文本族 viewer 的文本选择→选择总线
// （BLOCK-175 CP-14：viewerProfileCanSelect 消费面；数据源=容器内 window
// selection，pointerup 采样 + 防抖去重）。启用条件由宿主按
// viewerProfileCanSelect(adapter) && activeIsPreviewText 计算。
// BLOCK-334 P2 Slice B：文本族统一到 CodeMirror 后——①优先经宿主注入的
// getSelectionText（EditorApi.getSelection().text，长文档虚拟化下 DOM 选区可能
// 不完整）取精确文本，DOM 采样保留为兜底；②补 keyup 采样（Shift+方向键选区）。
// ============================================================
import { useEffect, useRef } from 'react';
import { buildTextSelection } from '@/lib/artifact-selection';
import { setSelectionBusSelection } from '@/lib/selectionBus';

export function useArtifactTextSelection({ enabled, containerRef, artifactId, revisionId, getSelectionText }: {
  enabled: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  artifactId: string;
  revisionId: string | null;
  /** 宿主提供的精确选区文本读取器（CodeMirror EditorApi）；返回空则回落 DOM 采样。 */
  getSelectionText?: () => string | null | undefined;
}): void {
  const lastHashRef = useRef<string | null>(null);
  // 读取器经 ref 转发（宿主每轮渲染换函数不触发重订阅；render 期写 ref 违反 react-hooks/refs，同步走 effect）
  const readerRef = useRef(getSelectionText);
  useEffect(() => {
    readerRef.current = getSelectionText;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    let timer: number | null = null;
    const readDomSelection = (): string | null => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return null;
      return selection.toString();
    };
    const publish = () => {
      const fromEditor = readerRef.current?.();
      const text = (typeof fromEditor === 'string' && fromEditor.trim()) ? fromEditor : readDomSelection();
      if (!text) return;
      const built = buildTextSelection({ artifactId, revisionId }, text);
      if (!built) return;
      // 同一选择去重（hash 相同不重复广播）
      if (built.entityIdsHash && built.entityIdsHash === lastHashRef.current) return;
      lastHashRef.current = built.entityIdsHash;
      setSelectionBusSelection(built);
    };

    const schedule = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(publish, 250);
    };
    document.addEventListener('pointerup', schedule);
    document.addEventListener('keyup', schedule);
    return () => {
      document.removeEventListener('pointerup', schedule);
      document.removeEventListener('keyup', schedule);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [enabled, artifactId, revisionId, containerRef]);
}
