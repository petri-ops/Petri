import { useCallback, useMemo, useState } from 'react';
import { useArtifactAnnotations } from '@/hooks/useArtifactAnnotations';
import {
  appendUndoAction,
  buildAnnotationTaskPrompt,
  defaultAnnotationComment,
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
  /** BLOCK-292 — 待填批注的几何（overlay 据此在保存前保持可见；anchor 待填时两者皆 null）。 */
  pendingRect: [number, number, number, number] | null;
  pendingPath: readonly [number, number][] | null;
  /** BLOCK-303 — 箭头待填两点 [起点,终点]（就地输入框锚点兼形状预览）。 */
  pendingArrow: readonly [number, number][] | null;
  /** BLOCK-300 — 文本标注点击点（就地输入框锚点；形状待填时为 null）。 */
  pendingTextPoint: [number, number] | null;
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
  /** BLOCK-303 — 箭头真形态：起点→终点两点线段，待填评论（与 beginRect 互斥）。 */
  beginArrow: (start: [number, number], end: [number, number], page?: number | null) => void;
  /** BLOCK-300 — 文本标注：点击图上位置，待就地输入文字（与 beginRect 互斥）。 */
  beginTextAt: (point: [number, number], page?: number | null) => void;
  /** BLOCK-254 P5 — 文本锚点：选区落在源码行范围上（与 beginRect 互斥）。 */
  beginAnchor: (anchor: TextAnchor) => void;
  cancelPending: () => void;
  /**
   * BLOCK-300 — comment 空串=「允许不填写」（落 defaultAnnotationComment 占位，后端
   * comment_required 契约不变）；rectOverride 供 text-place 就地输入框量取实际尺寸落库。
   */
  submitComment: (comment: string, rectOverride?: [number, number, number, number]) => Promise<boolean>;
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
  | { kind: 'line'; points: [[number, number], [number, number]]; page: number | null }
  | { kind: 'text-place'; point: [number, number]; page: number | null }
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
  const [drawing, setDrawing] = useState(true); // BLOCK-292 自动打开：挂载即批注模式（用户裁决「不需要点击批注才可以」）
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

  // BLOCK-292 — begin* 不再退出绘制模式（旧语义画完即关，第二笔被拒识）：
  // 批注模式保持 true，用户画→写→再画零摩擦；退出只走 toggle。
  const beginRect = useCallback((rect: [number, number, number, number], page: number | null = null) => {
    setPending({ target: { kind: 'rect', rect, page }, identity });
  }, [identity]);

  const beginPath = useCallback((path: [number, number][], page: number | null = null) => {
    setPending({ target: { kind: 'path', path, page }, identity });
  }, [identity]);

  const beginArrow = useCallback((
    start: [number, number],
    end: [number, number],
    page: number | null = null,
  ) => {
    setPending({ target: { kind: 'line', points: [start, end], page }, identity });
  }, [identity]);

  const beginTextAt = useCallback((point: [number, number], page: number | null = null) => {
    setPending({ target: { kind: 'text-place', point, page }, identity });
  }, [identity]);

  const beginAnchor = useCallback((anchor: TextAnchor) => {
    setPending({ target: { kind: 'anchor', anchor }, identity });
  }, [identity]);

  const cancelPending = useCallback(() => {
    setPending(null);
  }, []);

  const submitComment = useCallback(async (
    comment: string,
    rectOverride?: [number, number, number, number],
  ): Promise<boolean> => {
    if (!pending) return false;
    if (pending.identity !== identity) {
      setPending(null);
      return false;
    }
    // BLOCK-300「允许不填写」：空评论落工具类型占位文案，后端 comment_required 契约不变。
    const resolvedComment = comment.trim() || defaultAnnotationComment(
      pending.target.kind === 'path'
        ? 'freehand'
        : pending.target.kind === 'line'
          ? 'arrow'
          : pending.target.kind === 'anchor'
            ? 'text-selection'
            : pending.target.kind === 'text-place'
              ? 'text'
              : kind,
    );
    // 定位方式决定 kind：锚点→text-selection、路径→freehand、箭头线→arrow、点击→text
    //（工具条形状选择对前三者无意义）。
    const saved = pending.target.kind === 'rect'
      ? await store.add({ rect: rectOverride ?? pending.target.rect, comment: resolvedComment, color, kind, page: pending.target.page })
      : pending.target.kind === 'path'
        ? await store.add({ path: pending.target.path, comment: resolvedComment, color, kind: 'freehand', page: pending.target.page })
        : pending.target.kind === 'line'
          ? await store.add({ path: pending.target.points, comment: resolvedComment, color, kind: 'arrow', page: pending.target.page })
          : pending.target.kind === 'text-place'
            ? await store.add({
              rect: rectOverride ?? [pending.target.point[0], pending.target.point[1], 0.25, 0.06],
              comment: resolvedComment,
              color,
              kind: 'text',
              page: pending.target.page,
            })
            : await store.add({ anchor: pending.target.anchor, comment: resolvedComment, color, kind: 'text-selection' });
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
      // 重建也要保持定位方式互斥：文本锚点走 anchor、画笔/箭头线走 path（BLOCK-303
      // 箭头真形态存两点 path），区域批注走 rect。
      ...(last.annotation.anchor
        ? { anchor: last.annotation.anchor }
        : (last.annotation.kind === 'freehand' || last.annotation.kind === 'arrow')
          && Array.isArray(last.annotation.path) && last.annotation.path.length > 0
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
    pendingRect: pending?.target.kind === 'rect' ? pending.target.rect : null,
    pendingPath: pending?.target.kind === 'path' ? pending.target.path : null,
    /** BLOCK-303 — 箭头待填两点 [起点,终点]（就地输入框锚点兼形状预览）。 */
    pendingArrow: pending?.target.kind === 'line' ? pending.target.points : null,
    /** BLOCK-300 — 文本标注点击点（就地输入框锚点；形状待填时为 null）。 */
    pendingTextPoint: pending?.target.kind === 'text-place' ? pending.target.point : null,
    canUndo: undoActions.length > 0,
    undoLabel: undoActionLabel(lastUndo),
    toggleDrawing: () => setDrawing((value) => !value),
    setColor,
    setKind,
    beginRect,
    beginPath,
    beginArrow,
    beginTextAt,
    beginAnchor,
    cancelPending,
    submitComment,
    remove,
    undo,
    buildPrompt,
  }), [
    beginAnchor,
    beginPath,
    beginArrow,
    beginTextAt,
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
