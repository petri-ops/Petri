// ============================================================
// useArtifactTextSelection — 只读文本族 viewer 的文本选择→选择总线
// （BLOCK-175 CP-14：viewerProfileCanSelect 消费面；数据源=容器内 window
// selection，pointerup 采样 + 防抖去重）。启用条件由宿主按
// viewerProfileCanSelect(adapter) && activeIsPreviewText 计算。
// ============================================================
import { useCallback, useEffect, useRef } from 'react';
import { buildTextSelection } from '@/lib/artifact-selection';
import { setSelectionBusSelection } from '@/lib/selectionBus';

export function useArtifactTextSelection({ enabled, containerRef, artifactId, revisionId }: {
  enabled: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  artifactId: string;
  revisionId: string | null;
}): void {
  const lastHashRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    let timer: number | null = null;
    const publish = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return;
      const text = selection.toString();
      const built = buildTextSelection({ artifactId, revisionId }, text);
      if (!built) return;
      // 同一选择去重（hash 相同不重复广播）
      if (built.entityIdsHash && built.entityIdsHash === lastHashRef.current) return;
      lastHashRef.current = built.entityIdsHash;
      setSelectionBusSelection(built);
    };

    const onPointerUp = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(publish, 250);
    };
    document.addEventListener('pointerup', onPointerUp);
    return () => {
      document.removeEventListener('pointerup', onPointerUp);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [enabled, artifactId, revisionId, containerRef]);
}
