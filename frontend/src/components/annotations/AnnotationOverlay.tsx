import React, { useCallback, useRef, useState } from 'react';
import {
  MOSAIC_DISCLOSURE,
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
  onSelect?: (annotationId: string) => void;
  /** 无障碍标签（如「批注层：第 2 页」）。 */
  label: string;
  testId?: string;
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
  onSelect,
  label,
  testId = 'annotation-overlay',
}: AnnotationOverlayProps): React.ReactElement {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<NormalizedPoint | null>(null);
  const strokeRef = useRef<NormalizedPoint[] | null>(null);
  const [draft, setDraft] = useState<[number, number, number, number] | null>(null);
  const [draftPath, setDraftPath] = useState<NormalizedPoint[] | null>(null);
  const visible = annotations.filter((annotation) => samePage(annotation, page));
  const freehandVisible = visible.filter((annotation) => annotation.kind === 'freehand');
  const freehandDrawing = drawing && kind === 'freehand' && typeof onCommitPath === 'function';

  const readPoint = useCallback((event: React.PointerEvent<HTMLDivElement>): NormalizedPoint | null => {
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
    event.preventDefault();
    if (activePointerRef.current !== null && event.pointerId !== activePointerRef.current) return;
    activePointerRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* 测试环境无 capture 实现 */
    }
    if (freehandDrawing) {
      strokeRef.current = [point];
      setDraftPath([point]);
      return;
    }
    startRef.current = point;
    setDraft(null);
  }, [drawing, freehandDrawing, readPoint]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    if (activePointerRef.current !== null && event.pointerId !== activePointerRef.current) return;
    const point = readPoint(event);
    if (!point) return;
    if (freehandDrawing && strokeRef.current) {
      const stroke = [...strokeRef.current, point];
      strokeRef.current = stroke;
      setDraftPath(stroke);
      return;
    }
    if (!startRef.current) return;
    setDraft(normalizePointerRect(startRef.current, point));
  }, [drawing, freehandDrawing, readPoint]);

  const finish = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    if (activePointerRef.current !== null && event.pointerId !== activePointerRef.current) return;
    activePointerRef.current = null;
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
    if (!startRef.current) return;
    const point = readPoint(event);
    const start = startRef.current;
    startRef.current = null;
    setDraft(null);
    if (!point) return;
    const rect = normalizePointerRect(start, point);
    if (!rect) return;
    onCommit(rect);
  }, [drawing, freehandDrawing, onCommit, onCommitPath, readPoint]);

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
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerLeave={(event) => {
        if (activePointerRef.current !== null && event.pointerId !== activePointerRef.current) return;
        if (startRef.current || strokeRef.current) finish(event);
      }}
    >
      {visible.map((annotation, index) => (
        <button
          key={annotation.annotationId}
          type="button"
          className={styles.box}
          data-annotation-id={annotation.annotationId}
          data-color={annotation.color}
          data-kind={annotation.kind || 'region'}
          data-testid="annotation-box"
          style={rectToStyle(annotation.rect)}
          title={annotation.kind === 'mosaic'
            ? `${describeAnnotationAnchor(annotation)}：${annotation.comment}（${MOSAIC_DISCLOSURE}）`
            : `${describeAnnotationAnchor(annotation)}：${annotation.comment}`}
          aria-label={`批注 ${index + 1}：${annotation.comment}`}
          onClick={() => onSelect?.(annotation.annotationId)}
        >
          {annotation.kind === 'text' ? (
            <span className={styles.textContent}>{annotation.comment}</span>
          ) : null}
          <span className={styles.badge}>{index + 1}</span>
        </button>
      ))}
      {freehandVisible.length > 0 && (
        <svg
          className={styles.freehandLayer}
          data-testid="annotation-freehand-layer"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="false"
        >
          {freehandVisible.map((annotation) => (
            <path
              key={annotation.annotationId}
              data-annotation-id={annotation.annotationId}
              data-testid="annotation-freehand-stroke"
              data-color={annotation.color}
              d={smoothFreehandPathD(annotation.path || [])}
              fill="none"
              className={styles.freehandStroke}
              onClick={() => onSelect?.(annotation.annotationId)}
            >
              <title>{`${describeAnnotationAnchor(annotation)}：${annotation.comment}`}</title>
            </path>
          ))}
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
    </div>
  );
}
