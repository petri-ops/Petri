import React, { useCallback, useRef, useState } from 'react';
import {
  MAX_ANNOTATION_COMMENT_CHARS,
  MOSAIC_DISCLOSURE,
  arrowHeadPoints,
  clamp01,
  decimatePath,
  describeAnnotationAnchor,
  normalizeFreehandPoints,
  normalizePointerRect,
  pointToNormalized,
  rectToStyle,
  smoothFreehandPathD,
  type AnnotationColor,
  type AnnotationKind,
  type ArtifactAnnotation,
  type NormalizedPoint,
} from '@/lib/annotations';
import styles from './AnnotationOverlay.module.css';

/**
 * AnnotationOverlay — BLOCK-219 Q6 区域批注覆盖层。
 *
 * 职责单一：把「指针拖拽」变成**归一化矩形**并渲染既有批注。
 * - 坐标只在本组件与容器 rect 之间换算（`pointToNormalized`），像素不进状态；
 * - 未进入绘制模式时覆盖层 `pointer-events:none`，不抢底层查看器（灯箱/滚动）的交互；
 * - 批注盒子按 `page` 过滤：PDF 每页各自一层，图像页 `page=null`。
 *
 * 不做的事：不持久化、不组装 prompt、不知道 artifact 身份——那些在 bar/hook 里。
 */

export interface AnnotationOverlayProps {
  annotations: readonly ArtifactAnnotation[];
  /** PDF 页号（1-based）；图像/整页产物传 null。 */
  page: number | null;
  /** true = 捕获拖拽画新批注；false = 只渲染既有批注。 */
  drawing: boolean;
  color: AnnotationColor;
  /** 当前绘制的形状（draft 预览；保存由会话层随批注一起提交）。 */
  kind: AnnotationKind;
  onCommit: (rect: [number, number, number, number]) => void;
  /** BLOCK-270（C-43 尾项）— 画笔提交（kind='freehand' 时替代 onCommit）；缺省=画笔不可绘制。 */
  onCommitPath?: (path: [number, number][]) => void;
  /** BLOCK-303 — 箭头真形态提交（kind='arrow' 时替代 onCommit）：起点→终点两点；缺省=旧矩形对角线。 */
  onCommitArrow?: (start: [number, number], end: [number, number]) => void;
  onSelect?: (annotationId: string) => void;
  /** 无障碍标签（如「批注层：第 2 页」）。 */
  label: string;
  testId?: string;
  /** BLOCK-292 — pending 批注预览（画完→保存期间保持可见；会话层下放）。 */
  pendingRect?: [number, number, number, number] | null;
  pendingPath?: readonly (readonly [number, number])[] | null;
  /** BLOCK-303 — 箭头待填两点 [起点,终点]（保存前保持可见）。 */
  pendingArrow?: readonly (readonly [number, number])[] | null;
  /** BLOCK-300 — 文本标注点击点（就地输入框锚点；缺省=text 形状退回拖拽语义）。 */
  pendingTextPoint?: [number, number] | null;
  /** BLOCK-300 — 文本标注点击上报（kind='text' 时点击图面即就地开框）。 */
  onCommitClick?: (point: [number, number]) => void;
  /** BLOCK-307 — 拖拽移动提交（非绘制态拖动既有批注；提供即启用，缺省=不可拖）。 */
  onMoveAnnotation?: (
    annotationId: string,
    geometry: { rect?: number[]; path?: number[][] },
  ) => void;
  /**
   * BLOCK-300 — 就地确认：动作结束后输入框出现在结束位置，允许不填直接确认。
   * 提供即接管评论输入（bar 的 composer 在区域面退场）；返回 false=保存失败，框保留。
   */
  onSubmitPending?: (
    comment: string,
    rectOverride?: [number, number, number, number],
  ) => boolean | Promise<boolean>;
  /** BLOCK-300 — 就地取消（Esc / ×）。 */
  onCancelPending?: () => void;
}

/** BLOCK-303 — 箭头图形（线段+贴合方向的头部三角）；draft/待填/已保存三态共用同一形态，
 *  绘制中所见即保存后所得。坐标 0..1 → 0..100 viewBox。入参放宽 number[]：ArtifactAnnotation.path
 *  与采点元组两种形态都吃。 */
function ArrowGlyph({ start, end, color }: {
  start: readonly number[];
  end: readonly number[];
  color: AnnotationColor;
}): React.ReactElement {
  const geo = arrowHeadPoints(start, end);
  return (
    <>
      <line
        x1={start[0] * 100}
        y1={start[1] * 100}
        x2={geo.lineEnd[0] * 100}
        y2={geo.lineEnd[1] * 100}
        className={styles.arrowLine}
        data-color={color}
      />
      <polygon
        points={[geo.head[0], geo.head[1], geo.head[2]]
          .map((point) => `${point[0] * 100},${point[1] * 100}`)
          .join(' ')}
        className={styles.arrowHead}
        data-color={color}
      />
    </>
  );
}

function samePage(annotation: ArtifactAnnotation, page: number | null): boolean {
  const annotationPage = typeof annotation.page === 'number' ? annotation.page : null;
  return annotationPage === page;
}

export function AnnotationOverlay({
  annotations,
  page,
  drawing,
  color,
  kind,
  onCommit,
  onCommitPath,
  onCommitArrow,
  onSelect,
  label,
  testId = 'annotation-overlay',
  pendingRect = null,
  pendingPath = null,
  pendingArrow = null,
  pendingTextPoint = null,
  onCommitClick,
  onSubmitPending,
  onCancelPending,
  onMoveAnnotation,
}: AnnotationOverlayProps): React.ReactElement {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<NormalizedPoint | null>(null);
  const strokeRef = useRef<NormalizedPoint[] | null>(null);
  const [draft, setDraft] = useState<[number, number, number, number] | null>(null);
  const [draftPath, setDraftPath] = useState<NormalizedPoint[] | null>(null);
  /** BLOCK-303 — 箭头拖拽实时预览（[起点, 当前点]；绘制中即最终形态，丝滑无「外部框」中间态）。 */
  const [draftArrow, setDraftArrow] = useState<[[number, number], [number, number]] | null>(null);
  const visible = annotations.filter((annotation) => samePage(annotation, page));
  const freehandVisible = visible.filter((annotation) => annotation.kind === 'freehand');
  // BLOCK-303 — 箭头真形态（两点 path）走 SVG 层；freehand 与两点箭头不再产生矩形退化框。
  const isArrowLine = (annotation: ArtifactAnnotation): boolean =>
    annotation.kind === 'arrow' && Array.isArray(annotation.path) && annotation.path.length === 2;
  const boxVisible = visible.filter((annotation) => annotation.kind !== 'freehand' && !isArrowLine(annotation));
  const arrowVisible = visible.filter(isArrowLine);
  const freehandDrawing = drawing && kind === 'freehand' && typeof onCommitPath === 'function';
  // BLOCK-303 — 箭头真形态：拖拽=起点→终点两点线段（缺省 onCommitArrow 时退回旧 rect 对角线）。
  const arrowDrawing = drawing && kind === 'arrow' && typeof onCommitArrow === 'function';

  // BLOCK-300 — 就地批注输入：动作结束位置出现，允许不填直接确认（Esc/× 取消）。
  const [inlineComment, setInlineComment] = useState('');
  const inlineInputRef = useRef<HTMLInputElement | null>(null);
  const submittingRef = useRef(false);

  // 就地框锚点：形状=拖拽终点（右下角），画笔=尾点，箭头=终点，文本=点击点。
  const pendingAnchor: { x: number; y: number } | null = pendingRect
    ? { x: pendingRect[0] + pendingRect[2], y: pendingRect[1] + pendingRect[3] }
    : pendingPath && pendingPath.length > 0
      ? { x: pendingPath[pendingPath.length - 1][0], y: pendingPath[pendingPath.length - 1][1] }
      : pendingArrow && pendingArrow.length === 2
        ? { x: pendingArrow[1][0], y: pendingArrow[1][1] }
        : pendingTextPoint
          ? { x: pendingTextPoint[0], y: pendingTextPoint[1] }
          : null;

  // text-place 保存时把就地输入框的实际渲染尺寸落库（rectOverride），文本框位置才忠实于输入现场。
  const measureInlineRect = (): [number, number, number, number] | undefined => {
    const node = surfaceRef.current;
    const input = inlineInputRef.current;
    if (!node || !input) return undefined;
    const bounds = node.getBoundingClientRect();
    const inputBounds = input.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return undefined;
    const x = Math.max(0, Math.min((inputBounds.left - bounds.left) / bounds.width, 1));
    const y = Math.max(0, Math.min((inputBounds.top - bounds.top) / bounds.height, 1));
    const w = Math.max(0.02, Math.min(inputBounds.width / bounds.width, 1 - x));
    const h = Math.max(0.02, Math.min(inputBounds.height / bounds.height, 1 - y));
    return [x, y, w, h];
  };

  const confirmInline = () => {
    if (!onSubmitPending || submittingRef.current) return;
    submittingRef.current = true;
    const override = pendingTextPoint ? measureInlineRect() : undefined;
    void Promise.resolve(onSubmitPending(inlineComment, override))
      .then((ok) => {
        submittingRef.current = false;
        if (ok) setInlineComment('');
      })
      .catch(() => {
        submittingRef.current = false;
      });
  };

  const cancelInline = () => {
    setInlineComment('');
    onCancelPending?.();
  };

  const readPoint = useCallback((event: { clientX: number; clientY: number }): NormalizedPoint | null => {
    const node = surfaceRef.current;
    if (!node) return null;
    return pointToNormalized(node.getBoundingClientRect(), event.clientX, event.clientY);
  }, []);

  // BLOCK-288 — 触屏防误触：活动笔触期间只认同一 pointerId（第二根手指/手掌
  // 落屏不篡改当前笔画）；pointerUp/cancel 释放。
  const activePointerRef = useRef<number | null>(null);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    const point = readPoint(event);
    if (!point) return;
    // BLOCK-307 两处真实鼠标路径修复：
    // ①不再对 pointerdown 无条件 setPointerCapture——capture 会把后续 click 的派发
    //   目标劫持回覆盖层，点在就地框 ✓/× 按钮上的 click 永远到不了按钮（体感「点击
    //   无效，只能 Enter」）。capture 延迟到 pointermove 首次移动（防出界的本意不变）。
    // ②不再 preventDefault：阻断 mousedown/click 兼容序列，同址二次失效。
    if (activePointerRef.current !== null && event.pointerId !== activePointerRef.current) return;
    activePointerRef.current = event.pointerId;
    if (freehandDrawing) {
      strokeRef.current = [point];
      setDraftPath([point]);
      return;
    }
    if (arrowDrawing) {
      startRef.current = point;
      setDraftArrow([[point.x, point.y], [point.x, point.y]]);
      setDraft(null);
      return;
    }
    startRef.current = point;
    setDraft(null);
  }, [arrowDrawing, drawing, freehandDrawing, readPoint]);

  // BLOCK-307 — 文本标注采点改走 click（浏览器原生派发，trusted/合成同管线可靠；
  // pointerdown 在真实鼠标路径下存在不触发的输入管线差异，BLOCK-300 实机复现实锤）。
  const handleTextClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // BLOCK-307 — 已有待填批注时 click 不再开新的点击框（一次只有一个就地框）；
    // 拖拽与单击共用该互斥语义，无时序脆弱性。
    if (pendingRect || pendingPath || pendingArrow) return;
    if (!drawing || kind !== 'text' || !onCommitClick) return;
    if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return;
    const point = readPoint(event);
    if (!point) return;
    onCommitClick([point.x, point.y]);
  }, [drawing, kind, onCommitClick, pendingArrow, pendingPath, pendingRect, readPoint]);

  // ── BLOCK-307 拖拽移动（非绘制态）：box / 箭头线 / 画笔线均可整体拖动 ──
  const [moveDrag, setMoveDrag] = useState<{
    id: string;
    isPath: boolean;
    origRect: number[] | null;
    origPath: number[][] | null;
    startClientX: number;
    startClientY: number;
    dx: number;
    dy: number;
    moved: boolean;
  } | null>(null);
  const surfaceSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  const startShapeMove = useCallback((annotation: ArtifactAnnotation, event: React.PointerEvent) => {
    // 已存批注任何模式下都可拖（绘制态点在既有框上=拖框而非采新点；stopPropagation
    // 阻止冒泡到覆盖层采新点——drawing gate 不设，避免绘制态拖拽被拦）。
    if (!onMoveAnnotation) return;
    const node = surfaceRef.current;
    if (!node) return;
    const bounds = node.getBoundingClientRect();
    surfaceSizeRef.current = { w: bounds.width || 1, h: bounds.height || 1 };
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* 测试环境无 capture 实现 */
    }
    setMoveDrag({
      id: annotation.annotationId,
      isPath: Array.isArray(annotation.path) && annotation.path.length >= 2,
      origRect: Array.isArray(annotation.rect) && annotation.rect.length === 4 ? [...annotation.rect] : null,
      origPath: Array.isArray(annotation.path) ? annotation.path.map((p) => [p[0], p[1]]) : null,
      startClientX: event.clientX,
      startClientY: event.clientY,
      dx: 0,
      dy: 0,
      moved: false,
    });
  }, [onMoveAnnotation]);

  const handleMoveDragPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!moveDrag) return;
    const size = surfaceSizeRef.current;
    const dx = (event.clientX - moveDrag.startClientX) / size.w;
    const dy = (event.clientY - moveDrag.startClientY) / size.h;
    const moved = Math.abs(event.clientX - moveDrag.startClientX) + Math.abs(event.clientY - moveDrag.startClientY) > 3;
    setMoveDrag((current) => (current ? { ...current, dx, dy, moved } : current));
  }, [moveDrag]);

  const commitMoveDrag = useCallback(() => {
    if (!moveDrag) return;
    const state = moveDrag;
    setMoveDrag(null);
    if (!state.moved || !onMoveAnnotation) return;
    if (state.isPath && state.origPath) {
      // 平移整体 clamp 进画布（保持形状，逐点同 delta）
      const minX = Math.min(...state.origPath.map((p) => p[0]));
      const maxX = Math.max(...state.origPath.map((p) => p[0]));
      const minY = Math.min(...state.origPath.map((p) => p[1]));
      const maxY = Math.max(...state.origPath.map((p) => p[1]));
      const clampedDx = Math.max(-minX, Math.min(state.dx, 1 - maxX));
      const clampedDy = Math.max(-minY, Math.min(state.dy, 1 - maxY));
      onMoveAnnotation(state.id, {
        path: state.origPath.map((p) => [
          Math.round(clamp01(p[0] + clampedDx) * 10000) / 10000,
          Math.round(clamp01(p[1] + clampedDy) * 10000) / 10000,
        ]),
      });
      return;
    }
    if (state.origRect) {
      const [x, y, w, h] = state.origRect;
      const clampedDx = Math.max(-x, Math.min(state.dx, 1 - x - w));
      const clampedDy = Math.max(-y, Math.min(state.dy, 1 - y - h));
      onMoveAnnotation(state.id, {
        rect: [
          Math.round(clamp01(x + clampedDx) * 10000) / 10000,
          Math.round(clamp01(y + clampedDy) * 10000) / 10000,
          w,
          h,
        ],
      });
    }
  }, [moveDrag, onMoveAnnotation]);

  // 拖拽中的渲染偏移（归一化）——box 用 style 覆盖、SVG 用 translate。
  const moveOffsetFor = (annotationId: string): { dx: number; dy: number } => {
    if (!moveDrag || moveDrag.id !== annotationId || !moveDrag.moved) return { dx: 0, dy: 0 };
    return { dx: moveDrag.dx, dy: moveDrag.dy };
  };
  const surfaceMoveHandlers = {
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      if (moveDrag) {
        handleMoveDragPointerMove(event);
        return;
      }
      handlePointerMove(event);
    },
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      if (moveDrag) {
        commitMoveDrag();
        return;
      }
      finish(event);
      // BLOCK-307 — text 采点的 pointerup 兜底：与 click 幂等（同点重复 beginTextAt
      // 只是覆盖同 pending），trusted click 派发异常时此路径仍可达。
      handleTextClick(event);
    },
  };

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    if (activePointerRef.current !== null && event.pointerId !== activePointerRef.current) return;
    const point = readPoint(event);
    if (!point) return;
    // BLOCK-307 — 延迟 capture：首次移动才抢（防笔画出界），点按钮的按下不受劫持。
    try {
      if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }
    } catch {
      /* 测试环境无 capture 实现 */
    }
    if (freehandDrawing && strokeRef.current) {
      const stroke = [...strokeRef.current, point];
      strokeRef.current = stroke;
      setDraftPath(stroke);
      return;
    }
    if (arrowDrawing && startRef.current) {
      const start = startRef.current;
      setDraftArrow([[start.x, start.y], [point.x, point.y]]);
      return;
    }
    if (!startRef.current) return;
    setDraft(normalizePointerRect(startRef.current, point));
  }, [arrowDrawing, drawing, freehandDrawing, readPoint]);

  const finish = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    if (activePointerRef.current !== null && event.pointerId !== activePointerRef.current) return;
    activePointerRef.current = null;
    // BLOCK-307 — 显式释放采点 capture：泄漏时后续 trusted click 的 target 会被
    // 劫持回覆盖层，就地框 ✓/× 等 click 按钮全部失灵（真实鼠标路径复现实锤）。
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      /* 未 capture/测试环境无实现 */
    }
    if (freehandDrawing) {
      const stroke = strokeRef.current;
      strokeRef.current = null;
      setDraftPath(null);
      const point = readPoint(event);
      const strokeAll = point && stroke ? [...stroke, point] : stroke;
      // 相邻重复点去重（up 终点常与最后一次 move 重合；同点单“笔触”不成路径）
      const deduped = (strokeAll ?? []).filter((point, index) => {
        const previous = index > 0 ? (strokeAll as NormalizedPoint[])[index - 1] : null;
        return !previous || previous.x !== point.x || previous.y !== point.y;
      });
      if (deduped.length < 2) return;
      const path = decimatePath(normalizeFreehandPoints(deduped));
      onCommitPath?.(path);
      return;
    }
    if (arrowDrawing) {
      const start = startRef.current;
      startRef.current = null;
      setDraftArrow(null);
      const point = readPoint(event);
      if (!start || !point) return;
      // 误触（微动）不成箭头：位移低于 1% 忽略
      if (Math.hypot(point.x - start.x, point.y - start.y) < 0.01) return;
      onCommitArrow?.([start.x, start.y], [point.x, point.y]);
      return;
    }
    if (!startRef.current) return;
    const point = readPoint(event);
    const start = startRef.current;
    startRef.current = null;
    setDraft(null);
    if (!point) return;
    const rect = normalizePointerRect(start, point);
    if (!rect) return;
    onCommit(rect);
  }, [arrowDrawing, drawing, freehandDrawing, onCommit, onCommitArrow, onCommitPath, readPoint]);

  return (
    <div
      ref={surfaceRef}
      className={drawing ? `${styles.overlay} ${styles.drawing}` : styles.overlay}
      data-testid={testId}
      data-page={page === null ? 'none' : String(page)}
      data-drawing={drawing ? 'true' : 'false'}
      data-annotation-count={visible.length}
      role="group"
      aria-label={label}
      onPointerDown={handlePointerDown}
      onPointerMove={surfaceMoveHandlers.onPointerMove}
      onPointerUp={surfaceMoveHandlers.onPointerUp}
      onClick={handleTextClick}
      onPointerLeave={(event) => {
        if (activePointerRef.current !== null && event.pointerId !== activePointerRef.current) return;
        if (startRef.current || strokeRef.current) finish(event);
      }}
    >
      {boxVisible.map((annotation, index) => {
        const offset = moveOffsetFor(annotation.annotationId);
        const boxStyle = rectToStyle(annotation.rect);
        if (offset.dx || offset.dy) {
          boxStyle.left = `${clamp01(annotation.rect[0] + offset.dx) * 100}%`;
          boxStyle.top = `${clamp01(annotation.rect[1] + offset.dy) * 100}%`;
        }
        return (
        <button
          key={annotation.annotationId}
          type="button"
          className={styles.box}
          data-annotation-id={annotation.annotationId}
          data-color={annotation.color}
          data-kind={annotation.kind || 'region'}
          data-testid="annotation-box"
          style={boxStyle}
          title={annotation.kind === 'mosaic'
            ? `${describeAnnotationAnchor(annotation)}：${annotation.comment}（${MOSAIC_DISCLOSURE}）`
            : `${describeAnnotationAnchor(annotation)}：${annotation.comment}`}
          aria-label={`批注 ${index + 1}：${annotation.comment}`}
          onPointerDown={(event) => startShapeMove(annotation, event)}
          onClick={() => onSelect?.(annotation.annotationId)}
        >
          {annotation.kind === 'text' ? (
            <span className={styles.textContent}>{annotation.comment}</span>
          ) : null}
          <span className={styles.badge}>{index + 1}</span>
        </button>
        );
      })}
      {freehandVisible.length > 0 && (
        <svg
          className={styles.freehandLayer}
          data-testid="annotation-freehand-layer"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="false"
        >
          {freehandVisible.map((annotation) => {
            const offset = moveOffsetFor(annotation.annotationId);
            return (
              <path
                key={annotation.annotationId}
                data-annotation-id={annotation.annotationId}
                data-testid="annotation-freehand-stroke"
                data-color={annotation.color}
                d={smoothFreehandPathD(annotation.path || [])}
                fill="none"
                className={styles.freehandStroke}
                transform={`translate(${offset.dx * 100} ${offset.dy * 100})`}
                onPointerDown={(event) => startShapeMove(annotation, event)}
                onClick={() => onSelect?.(annotation.annotationId)}
              >
                <title>{`${describeAnnotationAnchor(annotation)}：${annotation.comment}`}</title>
              </path>
            );
          })}
        </svg>
      )}
      {/* BLOCK-303 — 箭头真形态（两点 path）：线段+贴合方向的头部三角；旧 rect-only 数据仍走下方对角线。 */}
      {arrowVisible.length > 0 && (
        <svg
          className={styles.freehandLayer}
          data-testid="annotation-arrow-layer"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="false"
        >
          {arrowVisible.map((annotation) => {
            const start = annotation.path[0];
            const end = annotation.path[1];
            const offset = moveOffsetFor(annotation.annotationId);
            return (
              <g
                key={annotation.annotationId}
                data-annotation-id={annotation.annotationId}
                data-testid="annotation-arrow-stroke"
                transform={`translate(${offset.dx * 100} ${offset.dy * 100})`}
                onPointerDown={(event) => startShapeMove(annotation, event)}
                onClick={() => onSelect?.(annotation.annotationId)}
              >
                <ArrowGlyph start={start} end={end} color={annotation.color} />
                <title>{`${describeAnnotationAnchor(annotation)}：${annotation.comment}`}</title>
              </g>
            );
          })}
        </svg>
      )}
      {draft && !freehandDrawing && (
        <div
          className={styles.draft}
          data-testid="annotation-draft"
          data-color={color}
          data-kind={kind}
          style={rectToStyle(draft)}
        />
      )}
      {freehandDrawing && draftPath && draftPath.length >= 2 && (
        <svg className={styles.freehandLayer} data-testid="annotation-freehand-draft" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path
            d={smoothFreehandPathD(draftPath.map((point) => [point.x, point.y]))}
            fill="none"
            className={styles.freehandStroke}
            data-color={color}
          />
        </svg>
      )}
      {/* BLOCK-303 — 箭头拖拽实时预览：与保存后同形态（线段+贴合方向的头部），无「外部框」中间态。 */}
      {draftArrow && (
        <svg className={styles.freehandLayer} data-testid="annotation-arrow-draft" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <ArrowGlyph start={draftArrow[0]} end={draftArrow[1]} color={color} />
        </svg>
      )}
      {/* BLOCK-303 — 箭头待填预览：保存前保持可见且形态不变。 */}
      {pendingArrow && pendingArrow.length === 2 && (
        <svg className={styles.freehandLayer} data-testid="annotation-pending-arrow" viewBox="0 0 100 100" preserveAspectRatio="none">
          <ArrowGlyph start={pendingArrow[0]} end={pendingArrow[1]} color={color} />
        </svg>
      )}
      {/* BLOCK-292 — pending 批注预览：画完→保存期间保持可见（用户裁决「批注不要隐藏」）。
          预览与 draft 互斥：draft 只在采点时存在，pending 只在采点结束后存在。 */}
      {pendingRect && (
        <div
          className={styles.draft}
          data-testid="annotation-pending-rect"
          style={rectToStyle(pendingRect)}
        />
      )}
      {pendingPath && pendingPath.length >= 2 && (
        <svg
          className={styles.freehandLayer}
          data-testid="annotation-pending-path"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <path
            d={smoothFreehandPathD(pendingPath.map((point) => [point[0], point[1]]))}
            fill="none"
            className={styles.freehandStroke}
          />
        </svg>
      )}
      {/* BLOCK-300 — 就地批注输入框：动作结束位置出现；Enter/失焦/✓ 确认（可不填），Esc/× 取消。 */}
      {pendingAnchor && onSubmitPending && (
        <div
          className={styles.inlineComposer}
          data-testid="annotation-inline-composer"
          style={{
            left: `${Math.min(pendingAnchor.x * 100, 55)}%`,
            top: `${Math.min(pendingAnchor.y * 100, 72)}%`,
          }}
        >
          <input
            ref={inlineInputRef}
            className={styles.inlineInput}
            data-testid="annotation-inline-input"
            value={inlineComment}
            placeholder="批注说明（可不填，回车确认）"
            autoFocus
            maxLength={MAX_ANNOTATION_COMMENT_CHARS}
            onChange={(event) => setInlineComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') confirmInline();
              if (event.key === 'Escape') cancelInline();
            }}
            onBlur={confirmInline}
          />
          <button
            type="button"
            className="petri-btn petri-btn--primary petri-btn--sm"
            data-testid="annotation-inline-confirm"
            title="确认（可不填说明）"
            onMouseDown={(event) => event.preventDefault()}
            onClick={confirmInline}
          >
            ✓
          </button>
          <button
            type="button"
            className="petri-btn petri-btn--ghost petri-btn--sm"
            data-testid="annotation-inline-cancel"
            title="取消这一笔"
            onMouseDown={(event) => event.preventDefault()}
            onClick={cancelInline}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
