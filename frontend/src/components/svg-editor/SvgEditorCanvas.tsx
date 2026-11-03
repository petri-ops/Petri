/**
 * SvgEditorCanvas.tsx — BLOCK-342 W1 画布：内联 SVG 视图 + 选择 + 拖拽 + 框选。
 *
 * 纪律：DOM 是活视图。拖拽只改 DOM transform 做即时反馈，手势结束才折算成 op
 * （onOpsCommitted），真值由后端 span 引擎在保存时改写。
 */

import * as React from 'react';
import {
  Box,
  boxIntersects,
  composeTranslate,
  elementPath,
  findByPath,
  normalizeBox,
  pathKey,
  SvgOp,
  translateOp,
} from './svgEditorModel';
import styles from './SvgEditorViewer.module.css';

export interface CanvasProps {
  markup: string;
  scale: number;
  selected: Set<string>;
  /** 宿主共享的画布容器引用（宿主需要用同一 DOM 读回序列化视图 / 做结构命令）。 */
  hostRef: React.MutableRefObject<HTMLDivElement | null>;
  onSelectionChange: (next: Set<string>) => void;
  onOpsCommitted: (ops: SvgOp[]) => void;
}

interface OverlayBox extends Box {
  key: string;
}

const DRAG_THRESHOLD = 3;

export function SvgEditorCanvas({ markup, scale, selected, hostRef, onSelectionChange, onOpsCommitted }: CanvasProps) {
  const [boxes, setBoxes] = React.useState<OverlayBox[]>([]);
  const [hoverBox, setHoverBox] = React.useState<Box | null>(null);
  const [rubber, setRubber] = React.useState<Box | null>(null);

  const dragRef = React.useRef<{
    startX: number;
    startY: number;
    moved: boolean;
    targets: Array<{ el: Element; path: number[]; id: string | null; origin: string | null }>;
    box: Box | null;
  } | null>(null);

  const getRoot = React.useCallback((): SVGSVGElement | null => {
    const host = hostRef.current;
    if (!host) return null;
    return host.querySelector('svg');
  }, []);

  const refreshBoxes = React.useCallback(() => {
    const root = getRoot();
    const host = hostRef.current;
    if (!root || !host) { setBoxes([]); return; }
    const hostRect = host.getBoundingClientRect();
    const next: OverlayBox[] = [];
    selected.forEach((key) => {
      const path = key === '' ? [] : key.split('.').map((n) => Number(n));
      const el = findByPath(root, path);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      next.push({
        key,
        x: rect.left - hostRect.left,
        y: rect.top - hostRect.top,
        width: rect.width,
        height: rect.height,
      });
    });
    setBoxes(next);
  }, [getRoot, selected]);

  React.useEffect(() => { refreshBoxes(); }, [refreshBoxes, markup]);
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => refreshBoxes());
    observer.observe(host);
    return () => observer.disconnect();
  }, [refreshBoxes]);

  const targetOf = (el: Element): { el: Element; path: number[]; id: string | null; origin: string | null } | null => {
    const root = getRoot();
    if (!root) return null;
    const path = elementPath(root, el);
    if (!path) return null;
    return { el, path, id: el.getAttribute('id'), origin: el.getAttribute('transform') };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const root = getRoot();
    const host = hostRef.current;
    if (!root || !host) return;
    const raw = event.target as Element;
    if (raw === root) {
      // 空白处：起框选
      const hostRect = host.getBoundingClientRect();
      dragRef.current = {
        startX: event.clientX, startY: event.clientY, moved: false, targets: [], box: { x: 0, y: 0, width: 0, height: 0 },
      };
      setRubber({ x: event.clientX - hostRect.left, y: event.clientY - hostRect.top, width: 0, height: 0 });
      return;
    }
    const target = targetOf(raw);
    if (!target) return;
    const key = pathKey(target.path);
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    let nextSelected = selected;
    if (additive) {
      nextSelected = new Set(selected);
      if (nextSelected.has(key)) nextSelected.delete(key); else nextSelected.add(key);
      onSelectionChange(nextSelected);
    } else if (!selected.has(key)) {
      nextSelected = new Set([key]);
      onSelectionChange(nextSelected);
    }
    const targets = Array.from(nextSelected)
      .map((k) => findByPath(root, k === '' ? [] : k.split('.').map((n) => Number(n))))
      .filter((el): el is Element => !!el)
      .map((el) => targetOf(el))
      .filter((t): t is { el: Element; path: number[]; id: string | null; origin: string | null } => !!t);
    dragRef.current = { startX: event.clientX, startY: event.clientY, moved: false, targets, box: null };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const host = hostRef.current;
    if (!drag || !host) return;
    const dx = (event.clientX - drag.startX) / scale;
    const dy = (event.clientY - drag.startY) / scale;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
    drag.moved = true;

    if (drag.box !== null) {
      const hostRect = host.getBoundingClientRect();
      const start = { x: drag.startX - hostRect.left, y: drag.startY - hostRect.top };
      const current = { x: event.clientX - hostRect.left, y: event.clientY - hostRect.top };
      const box = normalizeBox(start, current);
      drag.box = box;
      setRubber(box);
      return;
    }

    drag.targets.forEach((t) => {
      const value = composeTranslate(t.origin, dx, dy);
      t.el.setAttribute('transform', value);
    });
    refreshBoxes();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setRubber(null);
    if (!drag) return;

    if (drag.box !== null) {
      const root = getRoot();
      const host = hostRef.current;
      if (!root || !host) return;
      const box = drag.box;
      const hostRect = host.getBoundingClientRect();
      const hits: string[] = [];
      Array.prototype.slice.call(root.children).forEach((child: Element) => {
        const rect = child.getBoundingClientRect();
        const rel = {
          x: rect.left - hostRect.left,
          y: rect.top - hostRect.top,
          width: rect.width,
          height: rect.height,
        };
        if (box.width === 0 && box.height === 0) return;
        if (boxIntersects(box, rel)) {
          const path = elementPath(root, child);
          if (path) hits.push(pathKey(path));
        }
      });
      onSelectionChange(new Set(hits));
      return;
    }

    if (!drag.moved) return;
    const dx = (event.clientX - drag.startX) / scale;
    const dy = (event.clientY - drag.startY) / scale;
    const ops: SvgOp[] = drag.targets
      .filter((t) => {
        const current = t.el.getAttribute('transform');
        return current !== t.origin;
      })
      .map((t) => {
        const current = t.el.getAttribute('transform');
        const origin = t.origin;
        // 用「origin + 总位移」重建，避免把逐帧累加串写进 op
        const value = composeTranslate(origin, dx, dy);
        t.el.setAttribute('transform', current ?? value);
        return t.id
          ? { op: 'set_attr', target: { id: t.id }, name: 'transform', value }
          : translateOp(t.path, dx, dy, origin);
      });
    if (ops.length > 0) onOpsCommitted(ops);
    refreshBoxes();
  };

  const handleHover = (event: React.PointerEvent<HTMLDivElement>) => {
    const root = getRoot();
    const host = hostRef.current;
    if (!root || !host) return;
    const raw = event.target as Element;
    if (raw === root) { setHoverBox(null); return; }
    const rect = raw.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) { setHoverBox(null); return; }
    const hostRect = host.getBoundingClientRect();
    setHoverBox({
      x: rect.left - hostRect.left,
      y: rect.top - hostRect.top,
      width: rect.width,
      height: rect.height,
    });
  };

  return (
    <div
      className={styles.canvas}
      data-testid="svg-editor-canvas"
      ref={hostRef}
      onPointerDown={handlePointerDown}
      onPointerMove={(event) => { handlePointerMove(event); handleHover(event); }}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => setHoverBox(null)}
    >
      <div
        className={styles.canvasInner}
        style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
      <div className={styles.overlay} aria-hidden="true">
        {boxes.map((box) => (
          <div
            key={box.key}
            className={styles.selectionBox}
            data-testid="svg-editor-selection"
            style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
          />
        ))}
        {hoverBox ? (
          <div
            className={styles.hoverBox}
            data-testid="svg-editor-hover"
            style={{ left: hoverBox.x, top: hoverBox.y, width: hoverBox.width, height: hoverBox.height }}
          />
        ) : null}
        {rubber ? (
          <div className={styles.rubber} style={{ left: rubber.x, top: rubber.y, width: rubber.width, height: rubber.height }} />
        ) : null}
      </div>
    </div>
  );
}


