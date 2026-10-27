import { useCallback, useMemo, useState } from 'react';
import { useArtifactAnnotations } from '@/hooks/useArtifactAnnotations';
import {
  appendUndoAction,
  buildAnnotationTaskPrompt,
  undoActionLabel,
  type AnnotationColor,
  type AnnotationKind,
  type AnnotationScope,
  type AnnotationTaskTarget,
  type AnnotationUndoAction,
  type ArtifactAnnotation,
  type TextAnchor,
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
  kind: AnnotationKind;
  /** true = 已画好矩形，等待填写评论。 */
  pending: boolean;
  /** 撤销栈是否可回退（仅本次会话、仅当前 scope）。 */
  canUndo: boolean;
  /** 下一步撤销会做什么（空栈为空串），用于按钮 title 如实说明。 */
  undoLabel: string;
  toggleDrawing: () => void;
  setColor: (color: AnnotationColor) => void;
  setKind: (kind: AnnotationKind) => void;
  /** PDF 传页号，图像传 null；页号随批注一起落库。 */
  beginRect: (rect: [number, number, number, number], page?: number | null) => void;
  /** BLOCK-270（C-43 尾项）— 画笔：路径采点完成，待填评论（与 beginRect 互斥）。 */
  beginPath: (path: [number, number][], page?: number | null) => void;
  /** BLOCK-254 P5 — 文本锚点：选区落在源码行范围上（与 beginRect 互斥）。 */
  beginAnchor: (anchor: TextAnchor) => void;
  cancelPending: () => void;
  submitComment: (comment: string) => Promise<boolean>;
  remove: (annotationId: string) => void;
  undo: () => Promise<boolean>;
  buildPrompt: () => string;
}

/**
 * 待填批注的定位方式（BLOCK-254 P5）：区域矩形或文本锚点二选一，
 * 与后端「互斥」契约同形，避免 UI 出现「既有 rect 又有 anchor」的第三种状态。
 */
type PendingTarget =
  | { kind: 'rect'; rect: [number, number, number, number]; page: number | null }
  | { kind: 'path'; path: [number, number][]; page: number | null }
  | { kind: 'anchor'; anchor: TextAnchor };

interface UndoSnapshot {
  /** 快照所属 scope 身份：identity 一变即视为空栈（同 pending 的纪律，不靠 effect 清空）。 */
  identity: string;
  actions: AnnotationUndoAction[];
}

const EMPTY_UNDO_ACTIONS: AnnotationUndoAction[] = [];
const EMPTY_UNDO_SNAPSHOT: UndoSnapshot = { identity: '', actions: EMPTY_UNDO_ACTIONS };

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
  const [kind, setKind] = useState<AnnotationKind>('region');
  // 待填矩形随「画它时的 scope 身份」一起存：切换产物后即便组件未重挂，
  // 也不会把旧坐标提交到新产物（提交时按身份复核，不靠 effect 清空）。
  const [pending, setPending] = useState<{
    target: PendingTarget;
    identity: string;
  } | null>(null);
  const [undoState, setUndoState] = useState<UndoSnapshot>(EMPTY_UNDO_SNAPSHOT);
  const undoActions = undoState.identity === identity ? undoState.actions : EMPTY_UNDO_ACTIONS;
  const lastUndo = undoActions.length > 0 ? undoActions[undoActions.length - 1] : null;

  const pushUndo = useCallback((action: AnnotationUndoAction) => {
    setUndoState((previous) => {
      const base = previous.identity === identity ? previous.actions : EMPTY_UNDO_ACTIONS;
      return { identity, actions: appendUndoAction(base, action) };
    });
  }, [identity]);

  const beginRect = useCallback((rect: [number, number, number, number], page: number | null = null) => {
    setPending({ target: { kind: 'rect', rect, page }, identity });
    setDrawing(false);
  }, [identity]);

  const beginPath = useCallback((path: [number, number][], page: number | null = null) => {
    setPending({ target: { kind: 'path', path, page }, identity });
    setDrawing(false);
  }, [identity]);

  const beginAnchor = useCallback((anchor: TextAnchor) => {
    setPending({ target: { kind: 'anchor', anchor }, identity });
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
    // 定位方式决定 kind：锚点→text-selection、路径→freehand（工具条形状选择对二者无意义）。
    const saved = pending.target.kind === 'rect'
      ? await store.add({ rect: pending.target.rect, comment, color, kind, page: pending.target.page })
      : pending.target.kind === 'path'
        ? await store.add({ path: pending.target.path, comment, color, kind: 'freehand', page: pending.target.page })
        : await store.add({ anchor: pending.target.anchor, comment, color, kind: 'text-selection' });
    if (!saved) return false;
    pushUndo({ type: 'created', annotationId: saved.annotationId });
    setPending(null);
    return true;
  }, [color, identity, kind, pending, pushUndo, store]);

  const remove = useCallback((annotationId: string) => {
    // 先留补偿快照再删：删除成功后本地列表已无这条，事后无法再还原内容。
    const target = store.annotations.find((annotation) => annotation.annotationId === annotationId);
    if (target) pushUndo({ type: 'deleted', annotation: target });
    void store.remove(annotationId);
  }, [pushUndo, store]);

  const undo = useCallback(async (): Promise<boolean> => {
    const actions = undoState.identity === identity ? undoState.actions : EMPTY_UNDO_ACTIONS;
    const last = actions.length > 0 ? actions[actions.length - 1] : null;
    if (!last) return false;
    // 先出栈再补偿：补偿失败不重压入（避免用户反复点同一动作拿到不一致结果）。
    setUndoState({ identity, actions: actions.slice(0, -1) });
    if (last.type === 'created') {
      return store.remove(last.annotationId);
    }
    const restored = await store.add({
      // 重建也要保持定位方式互斥：文本锚点走 anchor、画笔走 path，区域批注走 rect。
      ...(last.annotation.anchor
        ? { anchor: last.annotation.anchor }
        : last.annotation.kind === 'freehand' && Array.isArray(last.annotation.path) && last.annotation.path.length > 0
          ? { path: last.annotation.path as [number, number][] }
          : { rect: last.annotation.rect as [number, number, number, number] }),
      comment: last.annotation.comment,
      color: last.annotation.color,
      kind: last.annotation.kind,
      page: last.annotation.page,
    });
    return restored !== null;
  }, [identity, store, undoState]);

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
    kind,
    pending: pending !== null,
    canUndo: undoActions.length > 0,
    undoLabel: undoActionLabel(lastUndo),
    toggleDrawing: () => setDrawing((value) => !value),
    setColor,
    setKind,
    beginRect,
    beginPath,
    beginAnchor,
    cancelPending,
    submitComment,
    remove,
    undo,
    buildPrompt,
  }), [
    beginAnchor,
    beginPath,
    beginRect,
    buildPrompt,
    cancelPending,
    color,
    drawing,
    kind,
    lastUndo,
    pending,
    remove,
    store.annotations,
    store.error,
    store.limit,
    store.loading,
    submitComment,
    undo,
    undoActions.length,
  ]);
}
