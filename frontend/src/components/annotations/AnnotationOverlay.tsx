import React, { useCallback, useRef, useState } from 'react';
import {
  describeAnnotationAnchor,
  normalizePointerRect,
  pointToNormalized,
  rectToStyle,
  type AnnotationColor,
  type ArtifactAnnotation,
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
  onCommit: (rect: [number, number, number, number]) => void;
  onSelect?: (annotationId: string) => void;
  /** 无障碍标签（如「批注层：第 2 页」）。 */
  label: string;
  testId?: string;
}

type NormalizedPoint = { x: number; y: number };

function samePage(annotation: ArtifactAnnotation, page: number | null): boolean {
  const annotationPage = typeof annotation.page === 'number' ? annotation.page : null;
  return annotationPage === page;
}

export function AnnotationOverlay({
  annotations,
  page,
  drawing,
  color,
  onCommit,
  onSelect,
  label,
  testId = 'annotation-overlay',
}: AnnotationOverlayProps): React.ReactElement {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<NormalizedPoint | null>(null);
  const [draft, setDraft] = useState<[number, number, number, number] | null>(null);
  const visible = annotations.filter((annotation) => samePage(annotation, page));

  const readPoint = useCallback((event: React.PointerEvent<HTMLDivElement>): NormalizedPoint | null => {
    const node = surfaceRef.current;
    if (!node) return null;
    return pointToNormalized(node.getBoundingClientRect(), event.clientX, event.clientY);
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    const point = readPoint(event);
    if (!point) return;
    event.preventDefault();
    startRef.current = point;
    setDraft(null);
  }, [drawing, readPoint]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing || !startRef.current) return;
    const point = readPoint(event);
    if (!point) return;
    setDraft(normalizePointerRect(startRef.current, point));
  }, [drawing, readPoint]);

  const finish = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing || !startRef.current) return;
    const point = readPoint(event);
    const start = startRef.current;
    startRef.current = null;
    setDraft(null);
    if (!point) return;
    const rect = normalizePointerRect(start, point);
    if (!rect) return;
    onCommit(rect);
  }, [drawing, onCommit, readPoint]);

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
        if (startRef.current) finish(event);
      }}
    >
      {visible.map((annotation, index) => (
        <button
          key={annotation.annotationId}
          type="button"
          className={styles.box}
          data-annotation-id={annotation.annotationId}
          data-color={annotation.color}
          data-testid="annotation-box"
          style={rectToStyle(annotation.rect)}
          title={`${describeAnnotationAnchor(annotation)}：${annotation.comment}`}
          aria-label={`批注 ${index + 1}：${annotation.comment}`}
          onClick={() => onSelect?.(annotation.annotationId)}
        >
          <span className={styles.badge}>{index + 1}</span>
        </button>
      ))}
      {draft && (
        <div
          className={styles.draft}
          data-testid="annotation-draft"
          data-color={color}
          style={rectToStyle(draft)}
        />
      )}
    </div>
  );
}
