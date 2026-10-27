import React from 'react';
import { PdfResultViewer } from '@/components/workspace-panels/PdfResultViewer';
import { AnnotationOverlay } from './AnnotationOverlay';
import { ConnectedAnnotationBar } from './ConnectedAnnotationBar';
import { useAnnotationSession } from './useAnnotationSession';
import type { AnnotationScope, AnnotationTaskTarget } from '@/lib/annotations';
import styles from './AnnotationHost.module.css';

/**
 * AnnotatablePdfPane — PDF 产物/文件的批注宿主（结果面与工作区共用）。
 *
 * 坐标模型：每页一个覆盖层，page 随批注落库；同一批注在不同缩放/DPI 下复现，
 * 因为存的是页内 0..1 相对矩形而不是像素。父层只负责「批注怎么进对话」。
 */
export function AnnotatablePdfPane({
  url,
  name,
  scope,
  conversationId = null,
  target,
  onAddToTask,
}: {
  url: string;
  name: string;
  scope: AnnotationScope | null;
  conversationId?: string | null;
  target: AnnotationTaskTarget;
  onAddToTask: (prompt: string) => void;
}): React.ReactElement {
  const session = useAnnotationSession({ scope, conversationId, target });

  return (
    <div className={styles.pane} data-testid="annotatable-pdf-pane">
      <ConnectedAnnotationBar
        session={session}
        canAnnotate={Boolean(scope)}
        unavailableReason="缺少产物身份，无法保存批注。"
        onAddToTask={onAddToTask}
      />
      <PdfResultViewer
        url={url}
        name={name}
        renderPageOverlay={(page) => (
          <AnnotationOverlay
            annotations={session.annotations}
            page={page}
            drawing={session.drawing}
            color={session.color}
            kind={session.kind}
            onCommit={(rect) => session.beginRect(rect, page)}
            onCommitPath={(path) => session.beginPath(path, page)}
            label={`批注层：第 ${page} 页`}
            testId={`annotation-overlay-p${page}`}
          />
        )}
      />
    </div>
  );
}
