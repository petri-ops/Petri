import React from 'react';
import { AnnotationBar } from './AnnotationBar';
import type { AnnotationSession } from './useAnnotationSession';

/**
 * ConnectedAnnotationBar — 把批注会话接到工具条上（查看器侧唯一接线点）。
 *
 * 存在意义：ResultArtifactShell / WorkspaceFilePreview / PDF host 三处若各自映射
 * props，很容易出现「某处漏传 pending 或 onAddToTask」的静默退化；映射只写这一次。
 */
export function ConnectedAnnotationBar({
  session,
  canAnnotate,
  unavailableReason,
  onAddToTask,
}: {
  session: AnnotationSession;
  canAnnotate: boolean;
  unavailableReason?: string;
  onAddToTask: (prompt: string) => void;
}): React.ReactElement {
  return (
    <AnnotationBar
      annotations={session.annotations}
      loading={session.loading}
      error={session.error}
      limit={session.limit}
      drawing={session.drawing}
      color={session.color}
      kind={session.kind}
      canAnnotate={canAnnotate}
      cannotAnnotateReason={unavailableReason}
      pendingRect={session.pending}
      onToggleDrawing={session.toggleDrawing}
      onColorChange={session.setColor}
      onKindChange={session.setKind}
      onSubmitComment={session.submitComment}
      onCancelPending={session.cancelPending}
      onRemove={session.remove}
      onAddToTask={() => {
        const prompt = session.buildPrompt();
        if (prompt) onAddToTask(prompt);
      }}
    />
  );
}
