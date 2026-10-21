import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnnotationClientError,
  createAnnotation,
  deleteAnnotation,
  fetchAnnotations,
} from '@/lib/annotation-client';
import type {
  AnnotationColor,
  AnnotationKind,
  AnnotationScope,
  ArtifactAnnotation,
} from '@/lib/annotations';

/**
 * useArtifactAnnotations — BLOCK-219 Q6 批注读取/写入的单一 React 入口。
 *
 * 语义：
 * - scope 变化即重载（旧请求作废，不把上一个产物的批注画到当前产物上）；
 * - 写/删走服务端确认后再生效（不做静默乐观：批注是用户显式留下的证据，
 *   显示"已保存"却实际失败比慢一拍更糟）；
 * - 失败一律落到 `error` 供 UI 如实展示，不吞异常；
 * - scope 为 null（无项目/无产物身份）时零请求、空状态。
 *
 * 实现约束：**effect 内不同步 setState**（会级联渲染）。所有状态写入都发生在
 * 异步回调里，`loading`/`error`/`annotations` 由「快照 key 与当前 scope key 是否
 * 一致」派生——scope 一变，界面上立刻是 loading 空态，无需先用 effect 清一遍。
 */
export interface ArtifactAnnotationsState {
  annotations: ArtifactAnnotation[];
  loading: boolean;
  error: string;
  limit: number;
  add: (input: {
    rect: [number, number, number, number];
    comment: string;
    color?: AnnotationColor;
    kind?: AnnotationKind;
    page?: number | null;
  }) => Promise<ArtifactAnnotation | null>;
  remove: (annotationId: string) => Promise<boolean>;
  reload: () => void;
  clearError: () => void;
}

/** 空 scope 的稳定空数组（引用恒定，避免每次渲染都触发下游 memo 失效）。 */
const EMPTY_ANNOTATIONS: ArtifactAnnotation[] = [];

interface AnnotationSnapshot {
  key: string;
  annotations: ArtifactAnnotation[];
  limit: number;
  error: string;
}

const EMPTY_SNAPSHOT: AnnotationSnapshot = { key: '', annotations: EMPTY_ANNOTATIONS, limit: 0, error: '' };

function scopeKey(scope: AnnotationScope | null): string {
  if (!scope) return '';
  return [
    scope.projectId,
    scope.surface,
    scope.artifactId || '',
    scope.revisionId || '',
    scope.filePath || '',
  ].join('|');
}

function messageOf(error: unknown): string {
  if (error instanceof AnnotationClientError) return error.message;
  if (error instanceof Error) return error.message;
  return '批注请求失败。';
}

export function useArtifactAnnotations(input: {
  scope: AnnotationScope | null;
  conversationId?: string | null;
  artifactName?: string | null;
}): ArtifactAnnotationsState {
  const { scope, conversationId = null, artifactName = null } = input;
  const key = scopeKey(scope);
  // scope 对象每次渲染都会重建，但它的**字段**是原始值：effect 只依赖这些原始值
  // （与 key 同源），在 effect 内重建 scope。这样既不会持有过期对象，也不需要
  // 在渲染期读写 ref。
  const projectId = scope?.projectId ?? '';
  const surface = scope?.surface ?? null;
  const artifactId = scope?.artifactId ?? null;
  const revisionId = scope?.revisionId ?? null;
  const filePath = scope?.filePath ?? null;
  const active = Boolean(projectId && surface && key);

  const [snapshot, setSnapshot] = useState<AnnotationSnapshot>(EMPTY_SNAPSHOT);
  const [reloadToken, setReloadToken] = useState(0);
  const epochRef = useRef(0);

  useEffect(() => {
    if (!active || !surface) return () => undefined;
    const epoch = epochRef.current + 1;
    epochRef.current = epoch;
    const currentScope: AnnotationScope = { projectId, surface, artifactId, revisionId, filePath };
    const controller = new AbortController();
    fetchAnnotations(currentScope, { signal: controller.signal })
      .then((result) => {
        if (epochRef.current !== epoch) return;
        setSnapshot({ key, annotations: result.annotations, limit: result.limit, error: '' });
      })
      .catch((failure: unknown) => {
        if (epochRef.current !== epoch || controller.signal.aborted) return;
        setSnapshot({ key, annotations: EMPTY_ANNOTATIONS, limit: 0, error: messageOf(failure) });
      });
    return () => controller.abort();
  }, [active, artifactId, filePath, key, projectId, reloadToken, revisionId, surface]);

  const current = snapshot.key === key;
  const loading = active && !current;

  const add = useCallback(async (annotationInput: {
    rect: [number, number, number, number];
    comment: string;
    color?: AnnotationColor;
    kind?: AnnotationKind;
    page?: number | null;
  }): Promise<ArtifactAnnotation | null> => {
    if (!scope) return null;
    try {
      const saved = await createAnnotation({
        ...scope,
        conversationId,
        artifactName,
        rect: annotationInput.rect,
        comment: annotationInput.comment,
        color: annotationInput.color,
        kind: annotationInput.kind,
        page: annotationInput.page ?? null,
      });
      setSnapshot((previous) => ({
        key,
        limit: previous.limit,
        error: '',
        annotations: previous.key === key ? [...previous.annotations, saved.annotation] : [saved.annotation],
      }));
      return saved.annotation;
    } catch (failure) {
      setSnapshot((previous) => ({ ...previous, key, error: messageOf(failure) }));
      return null;
    }
  }, [artifactName, conversationId, key, scope]);

  const remove = useCallback(async (annotationId: string): Promise<boolean> => {
    try {
      await deleteAnnotation(annotationId);
      setSnapshot((previous) => ({
        ...previous,
        key,
        error: '',
        annotations: previous.annotations.filter((annotation) => annotation.annotationId !== annotationId),
      }));
      return true;
    } catch (failure) {
      setSnapshot((previous) => ({ ...previous, key, error: messageOf(failure) }));
      return false;
    }
  }, [key]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);
  const clearError = useCallback(() => {
    setSnapshot((previous) => ({ ...previous, error: '' }));
  }, []);

  return useMemo(() => ({
    annotations: active && current ? snapshot.annotations : EMPTY_ANNOTATIONS,
    loading,
    error: active && current ? snapshot.error : '',
    limit: active && current ? snapshot.limit : 0,
    add,
    remove,
    reload,
    clearError,
  }), [active, add, clearError, current, loading, reload, remove, snapshot]);
}
