import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Project, ToolJob } from '@/lib/project-types';
import {
  deleteResultStudioSelection,
  fetchArtifactInteraction,
  restoreResultStudioSelection,
  saveResultStudioSelection,
  type ResultTableQuery,
} from '@/lib/result-studio-interaction-client';
import type { ArtifactInteractionManifest, ArtifactSelection } from '@/lib/artifact-selection';
import { setSelectionBusArtifact, setSelectionBusSelection } from '@/lib/selectionBus';
import { shouldRequestArtifactInteraction, shouldSurfaceInteractionFailure, type ResultViewerAdapter } from '@/components/result-studio/resultSurface';
import type { ArtifactRevision } from '@/components/result-studio/resultStudioClient';
import { toArtifactRevision } from '@/components/workspace-panels/ResultView/helpers';

// BLOCK-92 Wave B-2 — 交互清单与选择状态簇外迁（原 ResultArtifactShell 内联，纯搬运零行为变化）。

// RS3：交互清单只能由后端基于**完整文件**产出。浏览器侧只有 buildPreviewTable
// 解析出的前 40 行样本，用它判定"哪一列是稳定实体 ID"会在 10 万行表上出错。
// artifact 一变就重取，并清空上一份选择——旧选择属于旧 artifact，不能顺延。
// SelectionContext 是 SQLite 真相的乐观投影。连续点击必须按发生顺序写入，
// 且保存/删除失败时回到最后一次真正提交的选择，不能把未落库状态交给 Agent。
interface UseArtifactInteractionSelectionOptions {
  project: Project;
  conversationId?: string | null;
  job: ToolJob | null;
  effectiveJobStatus: ToolJob['status'];
  lang: 'r' | 'python';
  selectedArtifactName: string;
  viewedRevision: ArtifactRevision | null;
  viewerAdapter: ResultViewerAdapter;
}

export function useArtifactInteractionSelection(options: UseArtifactInteractionSelectionOptions): {
  interactionBindingKey: string;
  interactionPreviewKey: string | null;
  setInteractionPreviewKey: Dispatch<SetStateAction<string | null>>;
  boundInteractionManifest: ArtifactInteractionManifest | null;
  boundInteractionRevision: ArtifactRevision | null;
  boundInteractionBackingTable: ResultTableQuery | null;
  boundArtifactSelection: ArtifactSelection | null;
  interactionError: string;
  selectionError: string;
  setInteractionRetryVersion: (update: (value: number) => number) => void;
  handleSelectionChange: (next: ArtifactSelection | null) => void;
  resetInteractionSelection: () => void;
} {
  const {
    project,
    conversationId,
    job,
    effectiveJobStatus,
    lang,
    selectedArtifactName,
    viewedRevision,
    viewerAdapter,
  } = options;

  const [interactionRevision, setInteractionRevision] = useState<ArtifactRevision | null>(null);
  const [interactionManifest, setInteractionManifest] = useState<ArtifactInteractionManifest | null>(null);
  const [interactionBackingTable, setInteractionBackingTable] = useState<ResultTableQuery | null>(null);
  const [interactionError, setInteractionError] = useState('');
  const [interactionRetryVersion, setInteractionRetryVersion] = useState(0);
  const [artifactSelection, setArtifactSelection] = useState<ArtifactSelection | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const [interactionPreviewKey, setInteractionPreviewKey] = useState<string | null>(null);
  // Which artifact the interaction manifest belongs to, so the manifest effect
  // can tell an artifact change from an unrelated dependency change.
  const manifestArtifactRef = useRef<string | null>(null);
  const selectionMutationEpochRef = useRef(0);
  const selectionMutationVersionRef = useRef(0);
  const selectionMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const visibleSelectionRef = useRef<ArtifactSelection | null>(null);
  const committedSelectionRef = useRef<ArtifactSelection | null>(null);

  const interactionBindingKey = `${viewedRevision?.revisionId || 'current'}::${viewedRevision?.toolJobId || job?.id || ''}::${selectedArtifactName}`;
  const interactionIsBound = manifestArtifactRef.current === interactionBindingKey;
  const boundInteractionManifest = interactionIsBound ? interactionManifest : null;
  const boundInteractionRevision = interactionIsBound ? interactionRevision : null;
  const boundInteractionBackingTable = interactionIsBound ? interactionBackingTable : null;
  const boundArtifactSelection = interactionIsBound ? artifactSelection : null;

  useEffect(() => {
    const epoch = selectionMutationEpochRef.current + 1;
    selectionMutationEpochRef.current = epoch;
    // 只在 artifact 真的换了时才清空。这个 effect 的依赖还包含 conversationId
    // 与 effectiveJobStatus，因此 artifact 没变也会重跑；而下面的 catch 是空的，
    // 于是一次刷新失败就会永久丢掉交互视图——次级失败降级了主体能力。
    // 清空本身的理由（旧选择属于旧 artifact）依然成立，只是收窄到它真正适用的条件。
    // 见 components/result-studio/resultBodyState.ts。
    if (manifestArtifactRef.current !== interactionBindingKey) {
      manifestArtifactRef.current = interactionBindingKey;
      setInteractionManifest(null);
      setInteractionRevision(null);
      setInteractionBackingTable(null);
      setInteractionError('');
      setArtifactSelection(null);
      visibleSelectionRef.current = null;
      committedSelectionRef.current = null;
      setSelectionError('');
    }
    if (!job || effectiveJobStatus !== 'done' || !selectedArtifactName) return;
    if (!shouldRequestArtifactInteraction(viewerAdapter)) return;
    let cancelled = false;
    void (async () => {
      try {
        setInteractionError('');
        const data = await fetchArtifactInteraction({
          language: lang,
          jobId: viewedRevision?.toolJobId || job.id,
          artifact: selectedArtifactName,
          revisionId: viewedRevision?.revisionId || null,
        });
        if (cancelled) return;
        if (data?.manifest) {
          setInteractionManifest(data.manifest);
          setInteractionRevision(toArtifactRevision(data.revision));
          setInteractionBackingTable(data.backingTable || null);
          const restored = await restoreResultStudioSelection({
            language: lang,
            projectId: project.id,
            conversationId,
            artifactId: data.manifest.artifactId,
            revisionId: data.manifest.revisionId,
            selectionDurable: data.manifest.selectionDurable,
          });
          if (!cancelled && selectionMutationEpochRef.current === epoch) {
            visibleSelectionRef.current = restored;
            committedSelectionRef.current = restored;
            setArtifactSelection(restored);
          }
        }
      } catch {
        if (!cancelled && shouldSurfaceInteractionFailure(viewerAdapter)) {
          // 次级交互失败不能清空主体结果；明确告诉用户当前降级及恢复动作。
          setInteractionError('交互能力暂不可用；请查看下方产物状态。');
        }
      }
    })();
    return () => {
      cancelled = true;
      if (selectionMutationEpochRef.current === epoch) selectionMutationEpochRef.current += 1;
    };
  }, [conversationId, effectiveJobStatus, interactionBindingKey, interactionRetryVersion, job?.id, lang, project.id, selectedArtifactName, viewedRevision, viewerAdapter]);

  const handleSelectionChange = useCallback((next: ArtifactSelection | null) => {
    const epoch = selectionMutationEpochRef.current;
    const version = selectionMutationVersionRef.current + 1;
    selectionMutationVersionRef.current = version;
    const previousVisible = visibleSelectionRef.current;
    setSelectionError('');
    if (!next) {
      visibleSelectionRef.current = null;
      setArtifactSelection(null);
      if (!previousVisible?.selectionId) return;
      selectionMutationQueueRef.current = selectionMutationQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            await deleteResultStudioSelection({ language: lang, selectionId: previousVisible.selectionId! });
            if (selectionMutationEpochRef.current !== epoch) return;
            committedSelectionRef.current = null;
          } catch (error) {
            if (selectionMutationEpochRef.current !== epoch
                || selectionMutationVersionRef.current !== version) return;
            const rollback = committedSelectionRef.current;
            visibleSelectionRef.current = rollback;
            setArtifactSelection(rollback);
            setSelectionError(error instanceof Error ? error.message : '清除选择失败');
          }
        });
      return;
    }
    const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const selectionId = previousVisible?.selectionId
      || committedSelectionRef.current?.selectionId
      || `sel_${randomId}`;
    const optimistic = { ...next, selectionId, compatibility: 'compatible' as const };
    visibleSelectionRef.current = optimistic;
    setArtifactSelection(optimistic);
    selectionMutationQueueRef.current = selectionMutationQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const saved = await saveResultStudioSelection({
            language: lang,
            selection: optimistic,
            selectionId,
            projectId: project.id,
            conversationId,
          });
          if (selectionMutationEpochRef.current !== epoch) return;
          const committed = { ...saved, compatibility: 'compatible' as const };
          committedSelectionRef.current = committed;
          if (selectionMutationVersionRef.current === version) {
            visibleSelectionRef.current = committed;
            setArtifactSelection(committed);
          }
        } catch (error) {
          if (selectionMutationEpochRef.current !== epoch
              || selectionMutationVersionRef.current !== version) return;
          const rollback = committedSelectionRef.current;
          visibleSelectionRef.current = rollback;
          setArtifactSelection(rollback);
          setSelectionError(error instanceof Error ? error.message : '保存选择失败');
        }
      });
  }, [conversationId, lang, project.id]);

  /** 版本切换（ChangeSetPanel 回调）时清空选择与乐观投影（原内联三连清空）。 */
  const resetInteractionSelection = useCallback(() => {
    setArtifactSelection(null);
    visibleSelectionRef.current = null;
    committedSelectionRef.current = null;
  }, []);

  // BLOCK-139（评审 P1-1 生产接线）：本 hook 是选择总线的生产绑定执行点与镜像源。
  // ① D1「切换 artifact 即换上下文」在此发生：交互 manifest 绑定/解绑时同步
  //    setSelectionBusArtifact（同上下文重复绑定幂等，不会清掉活跃选择）。
  // ② shell 可见选择（用户写入 / 后端恢复 / 清除 / 保存回滚）统一镜像进总线，
  //    生产下游（composer 注入、继续分析）读到的即生产真相。
  // ③ viewer 保持回调模式：摘两 prop 会绕过 saveResultStudioSelection 持久化流
  //    （保存/删除/回滚 + selectionId 戳记）；总线是镜像读真相，不是第二写入通道。
  useEffect(() => {
    setSelectionBusArtifact(boundInteractionManifest
      ? { artifactId: boundInteractionManifest.artifactId, revisionId: boundInteractionManifest.revisionId }
      : { artifactId: '', revisionId: null });
  }, [boundInteractionManifest]);

  useEffect(() => {
    setSelectionBusSelection(boundArtifactSelection, { idField: boundInteractionManifest?.idField ?? null });
  }, [boundArtifactSelection, boundInteractionManifest]);

  return {
    interactionBindingKey,
    interactionPreviewKey,
    setInteractionPreviewKey,
    boundInteractionManifest,
    boundInteractionRevision,
    boundInteractionBackingTable,
    boundArtifactSelection,
    interactionError,
    selectionError,
    setInteractionRetryVersion,
    handleSelectionChange,
    resetInteractionSelection,
  };
}
