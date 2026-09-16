import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { Project } from '@/lib/project-types';
import type { ActiveWorkspaceFile } from './types';
import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';
import { gewuEvents, subscribeGewuEvent, dispatchGewuEvent } from '@/lib/events';
import { usePendingScroll } from '@/lib/pendingScrollContext';
import type { DiffRevision } from '@/components/editor/CodeMirror/types';
import { workspaceFileUrlFor } from '@/lib/previewFileUtils';
import { getBridge } from '@/lib/desktopBridge';
import {
  requestedArtifactRequestKey,
  shouldApplyRequestedArtifact,
} from '@/components/result-studio/resultSurface';

// BLOCK-92 Wave B-1 — 结果/文件打开事件 effects 簇外迁（原 ProjectWorkspace 内联，纯搬运零行为变化）。
// 覆盖：URL 请求参数自动打开（job/artifact/file）、projectOpenResult、
// projectOpenArtifact（含跨项目导航）、指挥中心独立窗 relay、
// projectOpenWorkspaceFile（含行跳转与系统应用打开）。

type SetPendingRequest = ReturnType<typeof usePendingScroll>['setPendingRequest'];

interface UseWorkspaceOpenEffectsOptions {
  projectId: string | undefined;
  project: Project | null;
  workspacePath: string;
  loading: boolean;
  workspaceMode: WorkspaceMode;
  requestedJobId: string | null;
  requestedArtifactName: string | null;
  requestedFilePath: string | null;
  searchParams: URLSearchParams;
  activeJobId: string | null;
  // jobs 仅作依赖项（保持原 effect 依赖数组逐字不变）
  jobs: readonly unknown[];
  activeWorkspaceFilePath: string | undefined;
  openResultRequestSequenceRef: MutableRefObject<number>;
  autoOpenedJobRef: MutableRefObject<string | null>;
  appliedRequestedArtifactKeyRef: MutableRefObject<string | null>;
  pendingArtifactNameRef: MutableRefObject<string | null>;
  pendingArtifactJobIdRef: MutableRefObject<string | null>;
  setPendingArtifactName: Dispatch<SetStateAction<string | null>>;
  handleOpenResult: (
    jobId: string,
    targetProjectId?: string | null,
    options?: { preserveWorkspaceMode?: boolean; workspaceMode?: WorkspaceMode }
  ) => Promise<void>;
  handleOpenWorkspaceFile: (file: ActiveWorkspaceFile) => void;
  openRightPanel: (tab: 'results' | 'files' | 'browser' | 'chat' | 'analyze' | 'review' | 'io' | 'jobs' | 'agent' | 'home') => void;
  navigate: NavigateFunction;
  setPendingRequest: SetPendingRequest;
}

export function useWorkspaceOpenEffects(options: UseWorkspaceOpenEffectsOptions): void {
  const {
    projectId,
    project,
    workspacePath,
    loading,
    workspaceMode,
    requestedJobId,
    requestedArtifactName,
    requestedFilePath,
    searchParams,
    activeJobId,
    jobs,
    activeWorkspaceFilePath,
    openResultRequestSequenceRef,
    autoOpenedJobRef,
    appliedRequestedArtifactKeyRef,
    pendingArtifactNameRef,
    pendingArtifactJobIdRef,
    setPendingArtifactName,
    handleOpenResult,
    handleOpenWorkspaceFile,
    openRightPanel,
    navigate,
    setPendingRequest,
  } = options;

  useEffect(() => {
    autoOpenedJobRef.current = null;
  }, [projectId]);
  useEffect(() => {
    if (loading || !projectId) return;
    if (searchParams.get('mode')) return;
    if (requestedJobId) {
      const requestKey = requestedArtifactRequestKey({
        projectId,
        jobId: requestedJobId,
        artifactName: requestedArtifactName,
      });
      if (!requestKey) appliedRequestedArtifactKeyRef.current = null;
      if (shouldApplyRequestedArtifact(appliedRequestedArtifactKeyRef.current, requestKey)) {
        appliedRequestedArtifactKeyRef.current = requestKey;
        pendingArtifactNameRef.current = requestedArtifactName;
        pendingArtifactJobIdRef.current = requestedJobId;
        setPendingArtifactName(requestedArtifactName);
      }
      if (
        activeJobId === requestedJobId &&
        (workspaceMode === 'result' || workspaceMode === 'code' || workspaceMode === 'compare' || workspaceMode === 'history' || workspaceMode === 'chat')
      ) return;
      if (autoOpenedJobRef.current === requestedJobId) return;
      autoOpenedJobRef.current = requestedJobId;
      void handleOpenResult(requestedJobId, projectId, {
        preserveWorkspaceMode: workspaceMode === 'chat' || workspaceMode === 'history',
        workspaceMode,
      });
      return;
    }
    appliedRequestedArtifactKeyRef.current = null;
  }, [activeJobId, handleOpenResult, jobs, loading, projectId, requestedArtifactName, requestedJobId, workspaceMode]);
  useEffect(() => {
    if (loading || !projectId || !requestedFilePath) return;
    if (activeWorkspaceFilePath === requestedFilePath) return;
    const file: ActiveWorkspaceFile = {
      path: requestedFilePath,
      name: requestedFilePath.split('/').pop() || requestedFilePath,
      url: workspaceFileUrlFor(projectId, requestedFilePath),
      workspaceDir: project?.workspacePath,
      workspaceKind: project?.workspaceKind,
    };
    handleOpenWorkspaceFile(file);
    openRightPanel('files');
  }, [activeWorkspaceFilePath, handleOpenWorkspaceFile, loading, openRightPanel, projectId, requestedFilePath]);
  useEffect(() => {
    const handler = (detail: { toolJobId: string; projectId?: string | null }) => {
      const d = detail;
      if (d?.toolJobId) {
        handleOpenResult(d.toolJobId, d.projectId || null);
      }
    };
    const unsub = subscribeGewuEvent(gewuEvents.projectOpenResult, handler);
    return unsub;
  }, [handleOpenResult]);
  useEffect(() => {
    const handler = (detail: { jobId: string; artifactName: string; projectId?: string | null }) => {
      if (!detail?.jobId || !detail?.artifactName) return;
      const targetProjectId = detail.projectId || projectId;
      pendingArtifactNameRef.current = detail.artifactName;
      pendingArtifactJobIdRef.current = detail.jobId;
      setPendingArtifactName(detail.artifactName);
      if (targetProjectId && targetProjectId !== projectId) {
        navigate(
          `/project/${encodeURIComponent(targetProjectId)}?mode=chat&job=${encodeURIComponent(detail.jobId)}&artifact=${encodeURIComponent(detail.artifactName)}`,
        );
        return;
      }
      void handleOpenResult(detail.jobId, targetProjectId || null, { preserveWorkspaceMode: true });
    };
    const unsub = subscribeGewuEvent(gewuEvents.projectOpenArtifact, handler);
    return unsub;
  }, [handleOpenResult, navigate, projectId]);
  // UI-385 — 指挥中心独立窗下钻 relay（agent/result 独立窗退役）：主窗 preload
  // 收到 window:relay-to-main 后回调，这里转派既有 projectOpenArtifact 处理链
  // （跨项目自动导航；单一事实走同一条结果打开链路）。
  useEffect(() => {
    const wm = getBridge('windowManager');
    if (!wm?.onRelayToMain) return;
    return wm.onRelayToMain((payload) => {
      if (payload?.type !== gewuEvents.projectOpenArtifact) return;
      dispatchGewuEvent(gewuEvents.projectOpenArtifact, payload.detail as { jobId: string; artifactName: string; projectId?: string | null });
    });
  }, []);
  useEffect(() => {
    const handler = (detail: {
      projectId: string;
      relativePath: string;
      name?: string;
      openWithSystemApp?: boolean;
      line?: number;
      column?: number;
      diffRevision?: { filePath: string; originalText: string; modifiedText: string };
    }) => {
      if (!detail?.projectId || !detail?.relativePath) return;
      if (detail.projectId !== projectId) {
        // Cross-project workspace files are out of scope for the desktop
        // workspace (each project has its own file tree); the chat host
        // can decide to navigate or surface a toast.
        navigate(`/project/${encodeURIComponent(detail.projectId)}?mode=chat&file=${encodeURIComponent(detail.relativePath)}`);
        return;
      }
      const file: ActiveWorkspaceFile = {
        path: detail.relativePath,
        name: detail.name || detail.relativePath.split('/').pop() || detail.relativePath,
        url: workspaceFileUrlFor(projectId || '', detail.relativePath),
        workspaceDir: project?.workspacePath,
      workspaceKind: project?.workspaceKind,
      };
      handleOpenWorkspaceFile(file);
      openRightPanel('files');
      // BLOCK-22 P4.5: Dispatch pending scroll request so WorkspaceFilePreviewBridge
      // can scroll to the target line and/or enter inline-diff mode.
      if (detail.line !== undefined) {
        const diffRevision: DiffRevision | undefined = detail.diffRevision
          ? {
              filePath: detail.diffRevision.filePath,
              originalText: detail.diffRevision.originalText,
              modifiedText: detail.diffRevision.modifiedText,
            }
          : undefined;
        setPendingRequest({
          filePath: detail.relativePath,
          line: detail.line,
          column: detail.column,
          diffRevision,
          // BLOCK-42 P4：事件驱动的跳转（聊天卡片/审阅联动）补 pulse 高亮，
          // 与 highlight:true 简写（3000ms）及 WTR review 跳行行为一致。
          pulseMs: 3000,
          timestamp: Date.now(),
        });
      }
      if (detail.openWithSystemApp && workspacePath) {
        void getBridge('files')?.openWorkspaceFile(workspacePath, detail.relativePath);
      }
    };
    const unsub = subscribeGewuEvent(gewuEvents.projectOpenWorkspaceFile, handler);
    return unsub;
  }, [handleOpenWorkspaceFile, navigate, openRightPanel, projectId, workspacePath, setPendingRequest]);
}
