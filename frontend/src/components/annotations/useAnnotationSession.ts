import { useCallback, useMemo, useState } from 'react';
import { useArtifactAnnotations } from '@/hooks/useArtifactAnnotations';
import {
  buildAnnotationTaskPrompt,
  type AnnotationColor,
  type AnnotationScope,
  type AnnotationTaskTarget,
  type ArtifactAnnotation,
} from '@/lib/annotations';

/**
 * useAnnotationSession — BLOCK-219 Q6 一次批注会话的 UI 状态（跨查看器复用）。
 *
 * 把四件事绑在一起，避免每个查看器各写一遍：
 *   1. 数据（useArtifactAnnotations：读/写/删 + 错误）；
 *   2. 交互状态（绘制开关、颜色、待填评论的矩形）；
 *   3. scope 切换即复位（不把上一个产物的待填批注带过去）；
 *   4. 「加入任务」prompt 的唯一构造点。
 *
 * 不投递事件：prompt 交回调用方（结果面用 onAskAgent、工作区用 copilotAsk），
 * 保持"进对话的通道"仍然只有一条。
 */
export interface AnnotationSessionInput {
  scope: AnnotationScope | null;
  conversationId?: string | null;
  target: Omit<AnnotationTaskTarget, 'surface'> & { surface?: AnnotationTaskTarget['surface'] };
}

export interface AnnotationSession {
  annotations: ArtifactAnnotation[];
  loading: boolean;
  error: string;
  limit: number;
  drawing: boolean;
  color: AnnotationColor;
  /** true = 已画好矩形，等待填写评论。 */
  pending: boolean;
  toggleDrawing: () => void;
  setColor: (color: AnnotationColor) => void;
  /** PDF 传页号，图像传 null；页号随批注一起落库。 */
  beginRect: (rect: [number, number, number, number], page?: number | null) => void;
  cancelPending: () => void;
  submitComment: (comment: string) => Promise<boolean>;
  remove: (annotationId: string) => void;
  buildPrompt: () => string;
}

function scopeIdentity(scope: AnnotationScope | null): string {
  if (!scope) return '';
  return [scope.projectId, scope.surface, scope.artifactId || '', scope.revisionId || '', scope.filePath || ''].join('|');
}

export function useAnnotationSession(input: AnnotationSessionInput): AnnotationSession {
  const { scope, conversationId = null } = input;
  const identity = scopeIdentity(scope);
  const store = useArtifactAnnotations({
    scope,
    conversationId,
    artifactName: input.target.artifactName ?? null,
  });
  const [drawing, setDrawing] = useState(false);
  const [color, setColor] = useState<AnnotationColor>('amber');
  // 待填矩形随「画它时的 scope 身份」一起存：切换产物后即便组件未重挂，
  // 也不会把旧坐标提交到新产物（提交时按身份复核，不靠 effect 清空）。
  const [pending, setPending] = useState<{
    rect: [number, number, number, number];
    page: number | null;
    identity: string;
  } | null>(null);

  const beginRect = useCallback((rect: [number, number, number, number], page: number | null = null) => {
    setPending({ rect, page, identity });
    setDrawing(false);
  }, [identity]);

  const cancelPending = useCallback(() => {
    setPending(null);
  }, []);

  const submitComment = useCallback(async (comment: string): Promise<boolean> => {
    if (!pending) return false;
    if (pending.identity !== identity) {
      setPending(null);
      return false;
    }
    const saved = await store.add({ rect: pending.rect, comment, color, page: pending.page });
    if (!saved) return false;
    setPending(null);
    return true;
  }, [color, identity, pending, store]);

  const remove = useCallback((annotationId: string) => {
    void store.remove(annotationId);
  }, [store]);

  const buildPrompt = useCallback((): string => {
    if (!scope) return '';
    return buildAnnotationTaskPrompt(store.annotations, {
      ...input.target,
      surface: input.target.surface ?? scope.surface,
    });
  }, [input.target, scope, store.annotations]);

  return useMemo(() => ({
    annotations: store.annotations,
    loading: store.loading,
    error: store.error,
    limit: store.limit,
    drawing,
    color,
    pending: pending !== null,
    toggleDrawing: () => setDrawing((value) => !value),
    setColor,
    beginRect,
    cancelPending,
    submitComment,
    remove,
    buildPrompt,
  }), [
    beginRect,
    buildPrompt,
    cancelPending,
    color,
    drawing,
    pending,
    remove,
    store.annotations,
    store.error,
    store.limit,
    store.loading,
    submitComment,
  ]);
}
