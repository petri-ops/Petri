import React from 'react';
import { AnnotationBar } from './AnnotationBar';
import type { AnnotationSession } from './useAnnotationSession';

/**
 * ConnectedAnnotationBar — 把批注会话接到工具条上（查看器侧唯一接线点）。
 *
 * 存在意义：ResultArtifactShell / WorkspaceFilePreview / PDF host 三处若各自映射
 * props，很容易出现「某处漏传 pending 或 onAddToContext」的静默退化；映射只写这一次。
 */
export function ConnectedAnnotationBar({
  session,
  canAnnotate,
  unavailableReason,
  onAddToContext,
  mode = 'region',
  side = 'full',
}: {
  session: AnnotationSession;
  canAnnotate: boolean;
  unavailableReason?: string;
  onAddToContext: (prompt: string) => void;
  /** 'text' = 文本锚点面（不渲染绘制开关，创建由选区触发）。 */
  mode?: 'region' | 'text';
  /** UI-611 — 三段式：'tools' 左工具集 / 'actions' 右执行区 / 'full' 单条。 */
  side?: 'full' | 'tools' | 'actions';
}): React.ReactElement {
  return (
    <AnnotationBar
      mode={mode}
      side={side}
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
      canUndo={session.canUndo}
      undoLabel={session.undoLabel}
      onUndo={() => {
        void session.undo();
      }}
      onToggleDrawing={session.toggleDrawing}
      onColorChange={session.setColor}
      onKindChange={(kind) => {
        // 选形状 = 进入批注模式（选择态下点形状直接回到绘制，不用再点「批注」）。
        session.setKind(kind);
        if (!session.drawing) session.toggleDrawing();
      }}
      onSubmitComment={session.submitComment}
      onCancelPending={session.cancelPending}
      onRemove={session.remove}
      onAddToContext={() => {
        const prompt = session.buildPrompt();
        if (prompt) onAddToContext(prompt);
      }}
    />
  );
}
