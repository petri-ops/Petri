import React from 'react';
import { AnnotationOverlay } from './AnnotationOverlay';
import { ConnectedAnnotationBar } from './ConnectedAnnotationBar';
import { useAnnotationSession } from './useAnnotationSession';
import type { AnnotationScope, AnnotationTaskTarget } from '@/lib/annotations';
import styles from './AnnotationHost.module.css';

/**
 * AnnotatableImagePane — 图像产物/文件的批注宿主（结果面与工作区共用）。
 *
 * 图层顺序：图片（按钮，点击开灯箱）→ 批注覆盖层（inset 0，与图片同尺寸）。
 * 覆盖层平时 `pointer-events:none`，所以灯箱点击不受影响；进入批注模式才接管拖拽。
 */
export function AnnotatableImagePane({
  src,
  alt,
  onOpenImage,
  onImageLoad,
  onImageError,
  scope,
  conversationId = null,
  target,
  onAddToTask,
}: {
  src: string;
  alt: string;
  onOpenImage?: () => void;
  /** 保留调用方的产物可用性探测（结果面据此切「文件不可读」空态）。 */
  onImageLoad?: () => void;
  onImageError?: () => void;
  scope: AnnotationScope | null;
  conversationId?: string | null;
  target: AnnotationTaskTarget;
  onAddToTask: (prompt: string) => void;
}): React.ReactElement {
  const session = useAnnotationSession({ scope, conversationId, target });

  return (
    <div className={styles.pane} data-testid="annotatable-image-pane">
      <ConnectedAnnotationBar
        session={session}
        canAnnotate={Boolean(scope)}
        unavailableReason="缺少产物身份，无法保存批注。"
        onAddToTask={onAddToTask}
      />
      <div className={styles.canvas}>
        <button
          type="button"
          className={styles.imageTrigger}
          onClick={onOpenImage}
          aria-label={`查看 ${alt}`}
          disabled={!onOpenImage}
        >
          <img
            className={styles.image}
            src={src}
            alt={alt}
            onLoad={onImageLoad}
            onError={onImageError}
          />
        </button>
        <AnnotationOverlay
          annotations={session.annotations}
          page={null}
          drawing={session.drawing}
          color={session.color}
          kind={session.kind}
          pendingRect={session.pendingRect}
          pendingPath={session.pendingPath}
          onCommit={(rect) => session.beginRect(rect, null)}
          onCommitPath={(path) => session.beginPath(path, null)}
          label={`批注层：${alt}`}
        />
      </div>
    </div>
  );
}
