// ============================================================
// ProjectWorkspace — UI-REFACTOR Phase3
// Three-column layout: left=resources, center=results+agent, right=history+results
// Collapsible panels. Route: /project/:projectId
// ============================================================

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icons/Icon';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import { BottomTerminal } from '@/components/workspace-panels/BottomTerminal';
import { CenterPanel, type CenterPanelContext } from '@/components/workspace-panels/CenterPanel';
import { LeftPanel, type LeftPanelContext } from '@/components/workspace-panels/LeftPanel';
import { RightPanel, type RightPanelContext } from '@/components/workspace-panels/RightPanel';
import { ColumnHeader } from '@/components/desktop/titlebar/ColumnizedTitleBar';
import { TitleBar } from '@/components/desktop/TitleBar';
import { getProject, listProjectJobs, listDatasetsByProject, listProjects, updateProject, createProject, setProjectStatus } from '@/lib/project-store';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { tools as staticTools } from '@/pages/_data';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import {
  isConversationRunning,
  useConversationRun,
} from '@/components/copilot/conversationRunStore';
import { listConversations, createConversation, forkConversation, renameConversation, archiveConversation, type ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import {
  useConversations,
  useOtherConversations,
} from '@/hooks/useConversations';
import {
  artifactAfterJobSelection,
  canCommitJobOpen,
  useConversationJobs,
} from '@/hooks/useConversationJobs';
import { useResizableColumns } from '@/hooks/useResizableColumns';
import { useWorkspaceLayout } from '@/hooks/useWorkspaceLayout';
import { useRightPanelTabs } from '@/hooks/useRightPanelTabs';
import { segmentToMode, modeToSegment, type WorkspaceMode } from '@/hooks/useWorkspaceRouting';
import { isDirectRecoveryAction, useHarnessWorkflowStatus } from '@/hooks/useHarnessWorkflowStatus';
import { useSetCopilotContext } from '@/lib/copilotContextProvider';
import type { CopilotContext, HarnessContextSummary } from '@/lib/copilotContext';
import { gewuEvents, subscribeGewuEvent, dispatchGewuEvent } from '@/lib/events';
import { usePendingScroll } from '@/lib/pendingScrollContext';
import type { DiffRevision, EditorApi } from '@/components/editor/CodeMirror/types';
// BLOCK-42 — pending-scroll 消费侧挂载（UI-194）：预览编辑器切 CodeMirror
import { WorkspaceFilePreviewBridge } from '@/components/editor';
import { useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';
import { fileExtension, isImageFile, isTextFile, isMarkdownFile, workspaceFileUrlFor, formatPreviewText } from '@/lib/previewFileUtils';
import type { ActiveArtifact, JobStats } from '@/components/workspace-panels/ResultView';
import {
  fetchHarnessIndex,
  type HarnessIndexSummary,
} from '@/lib/harness-client';
import { buildResultTitleBarTitle } from '@/lib/result-title-bar';
import {
  summarizeSelectionForAgent,
} from '@/lib/artifact-selection';
import { isResultWorkspaceMode, resultFocusTransition } from '@/components/result-studio/resultFocusLayout';
import {
  fetchResultStudioContext,
  type ResultStudioEditControls,
} from '@/lib/result-studio-interaction-client';
import type { ResultEditSubmission } from '@/components/result-studio/ResultEditPanel';
import {
  buildResultEditCopilotAsk,
  isResultStudioContextToken,
} from '@/lib/result-edit-agent-bridge';
import {
  beginResultSurfaceMeasure,
  requestedArtifactRequestKey,
  RESULT_SURFACE_PERFORMANCE_MARKS,
  shouldApplyRequestedArtifact,
} from '@/components/result-studio/resultSurface';
import { getBridge } from '@/lib/desktopBridge';
import styles from './project-workspace.module.css';
import type { ActiveWorkspaceFile } from './project-workspace/types';

// Re-export for backward compatibility — consumers still import from the page.
export type { ActiveWorkspaceFile } from './project-workspace/types';

export type { ActiveArtifact, JobStats } from '@/components/workspace-panels/ResultView';

export type RightPanelMode = 'home' | 'results' | 'files' | 'terminal' | 'browser' | 'chat' | 'analyze' | 'review' | 'io';

const RIGHT_PANEL_ITEMS: Array<{ id: RightPanelMode; label: string; icon: IconName }> = [
  { id: 'results', label: '结果', icon: 'bar-chart' },
  { id: 'files', label: '文件', icon: 'folder' },
  { id: 'terminal', label: '后端', icon: 'cpu' },
  { id: 'browser', label: '浏览器', icon: 'globe' },
  { id: 'chat', label: '聊天', icon: 'sidebar' },
  { id: 'analyze', label: '分析', icon: 'sparkles' },
  // BLOCK-28.5 — 审阅并入右侧边栏 tab 体系（与其它入口同级，不再是浮层另类）
  { id: 'review', label: '审阅', icon: 'git-branch' },
  // BLOCK-68 / UI-317 — 模型 I/O 信息流从 composer ⋯ 菜单迁入 tab 体系（绑会话，只读）
  { id: 'io', label: '模型 I/O', icon: 'list-details' },
];

function toCopilotHarnessSummary(index: HarnessIndexSummary | null | undefined): HarnessContextSummary | undefined {
  if (!index) return undefined;
  return {
    fileCount: index.fileCount || 0,
    truncated: index.truncated,
    byKind: index.byKind,
    byRole: index.byRole,
    entries: (index.entries || []).slice(0, 24).map((entry) => ({
      relativePath: entry.relativePath,
      kind: entry.kind,
      role: entry.role,
      readable: entry.readable,
      table: entry.table
        ? {
            headers: (entry.table.headers || []).slice(0, 12),
            columnCount: entry.table.columnCount,
            rowSampleCount: entry.table.rowSampleCount,
            matrixOrientation: entry.table.matrixOrientation,
          }
        : undefined,
    })),
  };
}

export function ProjectWorkspace(): React.ReactElement {
  const shell = useWorkspacePanelsContext();
  const updateTitleBar = shell.updateTitleBar;
  const { projectId, '*': modeSplat } = useParams<{ projectId: string; '*'?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [project, setProject] = useState<Project | null>(null);
  const [jobs, setJobs] = useState<ToolJob[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  // T85: mode is derived from the URL sub-path (`/project/:id/<mode>`), not the
  // `?mode=` query param. This makes views deep-linkable, refresh-stable and
  // breadcrumb-ready without touching the three-column render tree.
  const workspaceMode = segmentToMode(modeSplat || undefined);
  const requestedJobId = searchParams.get('job');
  const requestedArtifactName = searchParams.get('artifact');
  const requestedFilePath = searchParams.get('file');

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const autoOpenedJobRef = useRef<string | null>(null);
  const openResultRequestSequenceRef = useRef(0);
  const [activeArtifact, setActiveArtifact] = useState<ActiveArtifact | null>(null);
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<ActiveWorkspaceFile | null>(null);
  // G0-RS-P3: Agent 上下文就绪状态。真相来自后端 context-envelope 投影，
  // 前端不自行判断"坐标是否齐备"，也不把缺失坐标伪装成可用。
  const [resultContextState, setResultContextState] = useState<{
    status: 'ready' | 'blocked' | 'loading';
    bindingKey: string;
    contextToken?: string | null;
    reason?: string | null;
    selectionUsable?: boolean;
    selectionCompatibility?: 'compatible' | 'stale' | 'invalid' | null;
    publicPhases?: string[];
  } | null>(null);
  // G0-RS-P4: Schema 驱动控件与该 Job 真实执行过的参数值。两者都由后端
  // descriptor 投影，前端不合成控件也不用默认值冒充"当前生效值"。
  const [resultEditControls, setResultEditControls] = useState<ResultStudioEditControls | null>(null);
  const [resultEditSubmitting, setResultEditSubmitting] = useState(false);
  // P4R-3: result Composer drafts live above the conditional result surface,
  // keyed by exact result/revision/selection so result↔chat does not discard a
  // draft and a draft can never silently move onto a different context.
  const [resultAgentDrafts, setResultAgentDrafts] = useState<Record<string, string>>({});
  const [browserCanGoBack, setBrowserCanGoBack] = useState(false);
  const [browserCanGoForward, setBrowserCanGoForward] = useState(false);
  const [openWorkspaceFiles, setOpenWorkspaceFiles] = useState<ActiveWorkspaceFile[]>([]);
  const [copilotHarnessIndex, setCopilotHarnessIndex] = useState<HarnessIndexSummary | null>(null);
  const [activeJobHarnessIndex, setActiveJobHarnessIndex] = useState<HarnessIndexSummary | null>(null);
  const [workflowRefreshKey, setWorkflowRefreshKey] = useState(0);
  // Pending artifact name captured from an external trigger (chat click,
  // cross-project navigation, etc.) — applied once the manifest is loaded
  // inside ResultArtifactShell via the imperative handle.
  const pendingArtifactNameRef = useRef<string | null>(null);
  const pendingArtifactJobIdRef = useRef<string | null>(null);
  const appliedRequestedArtifactKeyRef = useRef<string | null>(null);
  const [pendingArtifactName, setPendingArtifactName] = useState<string | null>(null);

  // Conversation state — current project's conversations + active conversation.
  // Plan 1.6 §4.3 — useConversations is the shared SWR hook (cache lives
  // in a module-level Map so SimpleChat and the sidebar read the same list).
  const {
    list: conversations,
    refresh: refreshConversations,
    create: createConversationInProject,
  } = useConversations(projectId);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const {
    jobs: conversationJobs,
    error: conversationJobsError,
    refresh: refreshConversationJobs,
  } = useConversationJobs(projectId, activeConvId);
  const activeConversationRun = useConversationRun(activeConvId);
  const resultEditBusy = resultEditSubmitting || activeConversationRun?.status === 'running';

  useEffect(() => {
    if (!conversationJobsError) return;
    setWorkspaceNotice('当前会话的结果列表暂时无法刷新，已保留上一次可用结果。');
  }, [conversationJobsError]);

  useEffect(() => {
    if (!workspaceNotice) return undefined;
    const timer = window.setTimeout(() => setWorkspaceNotice(''), 4_500);
    return () => window.clearTimeout(timer);
  }, [workspaceNotice]);

  const bindActiveJob = useCallback((jobId: string | null) => {
    setActiveArtifact((current) => artifactAfterJobSelection(current, activeJobId, jobId));
    setActiveJobId(jobId);
  }, [activeJobId]);

  const activeSelectionBindingKey = useMemo(() => {
    const selection = activeArtifact?.selection;
    if (!selection) return '';
    return JSON.stringify({
      selectionId: activeArtifact?.selectionId || null,
      entityIdsHash: selection.entityIdsHash,
      filterHash: selection.filterHash || null,
      fields: selection.fields,
      sort: selection.sort,
      compatibility: selection.compatibility || null,
      createdAt: selection.createdAt,
    });
  }, [
    activeArtifact?.selectionId,
    activeArtifact?.selection?.entityIdsHash,
    activeArtifact?.selection?.filterHash,
    activeArtifact?.selection?.fields,
    activeArtifact?.selection?.sort,
    activeArtifact?.selection?.compatibility,
    activeArtifact?.selection?.createdAt,
  ]);
  const resultContextBindingKey = useMemo(() => {
    if (!projectId || !activeArtifact) return '';
    return [
      projectId,
      activeConvId || '',
      activeArtifact.jobId,
      activeArtifact.name,
      activeArtifact.revisionId || '',
      activeArtifact.artifactFamilyId || '',
      activeSelectionBindingKey,
    ].join('\u0000');
  }, [
    projectId,
    activeConvId,
    activeArtifact?.jobId,
    activeArtifact?.name,
    activeArtifact?.revisionId,
    activeArtifact?.artifactFamilyId,
    activeSelectionBindingKey,
  ]);
  const effectiveResultContextState = !activeArtifact
    ? null
    : resultContextState?.bindingKey === resultContextBindingKey
      ? resultContextState
      : !activeConvId
        ? {
            status: 'blocked' as const,
            bindingKey: resultContextBindingKey,
            contextToken: null,
            reason: '请先创建或选择一个 Agent 会话，再修改当前结果。',
          }
        : { status: 'loading' as const, bindingKey: resultContextBindingKey, contextToken: null };
  const effectiveResultEditControls = resultContextState?.bindingKey === resultContextBindingKey
    ? resultEditControls
    : null;

  const resultAgentDraftKey = useMemo(() => {
    if (!activeArtifact) return '';
    return [
      projectId || '',
      activeConvId || '',
      activeArtifact.jobId,
      activeArtifact.name,
      activeArtifact.revisionId || '',
      activeArtifact.artifactFamilyId || '',
      activeArtifact.selectionId || '',
      activeSelectionBindingKey,
    ].join('\u0000');
  }, [
    projectId,
    activeConvId,
    activeArtifact?.jobId,
    activeArtifact?.name,
    activeArtifact?.revisionId,
    activeArtifact?.artifactFamilyId,
    activeArtifact?.selectionId,
    activeSelectionBindingKey,
  ]);
  const resultAgentDraft = resultAgentDraftKey ? resultAgentDrafts[resultAgentDraftKey] || '' : '';
  const setResultAgentDraft = useCallback((draft: string) => {
    if (!resultAgentDraftKey) return;
    setResultAgentDrafts((current) => {
      const next = { ...current, [resultAgentDraftKey]: draft };
      const keys = Object.keys(next);
      for (const key of keys.slice(0, Math.max(0, keys.length - 24))) delete next[key];
      return next;
    });
  }, [resultAgentDraftKey]);

  // Plan 1.6 §4.3 — optimistic prepend for cross-project creations
  // (sidebar adds a conv under another project without switching pages).
  // useOtherConversations below reads from the shared cache; this seed
  // map is only the "just-created, not yet in cache" delta.
  const [otherSeed, setOtherSeed] = useState<Record<string, ConversationSummary[]>>({});
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [createError, setCreateError] = useState(''); // UI-304 简化版 — 创建项目错误提示
  // §2 dedup: use the App-level Context directly (5s poll), drop the standalone
  // 10s polling hook and the local state sync layer.
  const backendStatus = useBackendStatus();
  // Resizable panel dimensions — Plan 1.6 §4.4 [HIGH]. State + drag
  // handlers now live in useResizableColumns (stable refs, no stale
  // closure on drag), so the splitter drags don't tear with re-renders.
  const {
    leftWidth,
    setLeftWidth,
    rightWidth,
    setRightWidth,
    inputHeight,
    setInputHeight,
    bottomTerminalHeight,
    setBottomTerminalHeight,
    startColumnResize,
    startBottomTerminalResize,
  } = useResizableColumns();

  const {
    leftOpen,
    setLeftOpen,
    rightOpen,
    setRightOpen,
    compactLayout,
    bottomTerminalOpen,
    setBottomTerminalOpen,
    summaryOpen,
    setSummaryOpen,
    centerColRef,
    sessionFrameRef,
    sessionFrameWidth,
  } = useWorkspaceLayout();
  const resultPanelRestoreRef = useRef<{ leftOpen: boolean; rightOpen: boolean } | null>(null);
  const resultFocusActiveRef = useRef(false);

  useEffect(() => {
    const transition = resultFocusTransition(resultFocusActiveRef.current, workspaceMode);
    if (transition === 'enter') {
      if (!resultPanelRestoreRef.current) {
        resultPanelRestoreRef.current = { leftOpen, rightOpen };
      }
      resultFocusActiveRef.current = true;
      setLeftOpen(false);
      setRightOpen(false);
      return;
    }
    if (transition !== 'exit') return;
    const restore = resultPanelRestoreRef.current;
    if (restore) {
      setLeftOpen(restore.leftOpen);
      setRightOpen(restore.rightOpen);
    }
    resultPanelRestoreRef.current = null;
    resultFocusActiveRef.current = false;
  }, [leftOpen, rightOpen, setLeftOpen, setRightOpen, workspaceMode]);

  const {
    rightTab,
    setRightTab,
    openRightTabs,
    setOpenRightTabs,
    rightToolMenuOpen,
    setRightToolMenuOpen,
    browserUrl,
    setBrowserUrl,
    closeRightPanelTab,
    // openRightPanel is NOT returned — it lives in project-workspace
    // with compactLayout awareness (setLeftOpen).
  } = useRightPanelTabs();

  // Every right-side tool shares one width. Switching to Results must not
  // jump to a separately constrained layout or change the drag feel.
  const effectiveRightWidth = rightWidth;

  // BLOCK-22 P4.5: Access PendingScrollContext so we can dispatch pending scroll
  // requests (line scroll + inline-diff) to WorkspaceFilePreviewBridge.
  const { setPendingRequest } = usePendingScroll();

  useEffect(() => {
    if (!rightOpen) setRightToolMenuOpen(false);
  }, [rightOpen, setRightToolMenuOpen]);

  // T85: legacy `?mode=` deep links (and the 5 direct navigations that still
  // build `?mode=`) are normalized to the URL sub-path form on arrival. Runs
  // whenever `?mode=` is present, so in-place navigations are covered too.
  useEffect(() => {
    const legacyMode = searchParams.get('mode');
    if (!legacyMode) return;
    const target = segmentToMode(legacyMode);
    const seg = modeToSegment(target);
    const base = seg ? `/project/${projectId}/${seg}` : `/project/${projectId}`;
    const next = new URLSearchParams(searchParams);
    next.delete('mode');
    const query = next.toString();
    navigate(query ? `${base}?${query}` : base, { replace: true });
  }, [searchParams, projectId, navigate]);

  // Derived summary visibility (semantic + pixel dimensions).
  const summaryVisibility = useMemo<'hidden' | 'compact' | 'expanded'>(() => {
    if (sessionFrameWidth === 0) return 'expanded';
    if (sessionFrameWidth >= 1120) return 'expanded';
    if (sessionFrameWidth >= 780) return 'compact';
    return 'hidden';
  }, [sessionFrameWidth]);

  // Bottom-terminal drag comes from useResizableColumns above; we clamp
  // the height to the workspace viewport (140-520) inline so the
  // terminal never eats the entire screen.
  const handleBottomTerminalResize = useCallback(
    (event: React.MouseEvent) => {
      startBottomTerminalResize(event, { min: 140, max: 520 });
    },
    [startBottomTerminalResize]
  );

  // T85: navigation now pushes the mode into the URL sub-path
  // (`/project/:id/<mode>?job=...`) instead of the `?mode=` query param. The
  // `?job=`/`?artifact=`/`?file=` query params are preserved for deep links.
  const updateWorkspaceMode = useCallback((nextMode: WorkspaceMode, replace = true, jobId?: string | null) => {
    const currentIsResult = isResultWorkspaceMode(workspaceMode);
    const nextIsResult = isResultWorkspaceMode(nextMode);
    if (nextIsResult && !currentIsResult) {
      // Capture the conversation layout before result-opening handlers enqueue
      // their own panel changes. React batches those setters, so waiting for the
      // result-mode effect would otherwise remember the already-forced layout.
      if (!resultPanelRestoreRef.current) {
        resultPanelRestoreRef.current = { leftOpen, rightOpen };
      }
      beginResultSurfaceMeasure(RESULT_SURFACE_PERFORMANCE_MARKS.openStart);
    } else if (nextMode === 'chat' && currentIsResult) {
      beginResultSurfaceMeasure(RESULT_SURFACE_PERFORMANCE_MARKS.returnStart);
    }
    const seg = modeToSegment(nextMode);
    const base = seg ? `/project/${projectId}/${seg}` : `/project/${projectId}`;
    const nextParams = new URLSearchParams(searchParams);
    const nextCarriesJob = (nextMode === 'scheduled' || nextMode === 'result' || nextMode === 'code' || nextMode === 'compare' || nextMode === 'history') && Boolean(jobId);
    if (!nextCarriesJob || nextParams.get('job') !== jobId) {
      openResultRequestSequenceRef.current += 1;
    }
    if (nextCarriesJob && jobId) {
      if (nextParams.get('job') !== jobId) nextParams.delete('artifact');
      nextParams.set('job', jobId);
    } else {
      nextParams.delete('job');
      nextParams.delete('artifact');
    }
    // mode now lives in the path segment, not the query string.
    nextParams.delete('mode');
    const query = nextParams.toString();
    navigate(query ? `${base}?${query}` : base, { replace });
  }, [leftOpen, rightOpen, searchParams, navigate, projectId, workspaceMode]);

  // openRightPanel: collapses left in compactLayout, opens right tab.
  const openRightPanel = useCallback((tab: RightPanelMode) => {
    if (compactLayout) setLeftOpen(false);
    setOpenRightTabs((current) => current.includes(tab) ? current : [...current, tab]);
    setRightTab(tab);
    setRightOpen(true);
  }, [compactLayout]);

  // BLOCK-28.7 — 聊天区改动卡片点击：打开审阅 tab（文件选中由 useWorkingTreeReview 监听）
  useEffect(() => {
    return subscribeGewuEvent(gewuEvents.reviewOpenFile, () => {
      openRightPanel('review');
    });
  }, [openRightPanel]);

  const [allProjects, setAllProjects] = useState<Project[]>([]);

  // UI-305 P1.2 — 左栏项目树展开 + 会话搜索状态簇整簇抽入 useProjectTreeState，
  // 零行为变化（调用点在 allProjects 声明之后）。
  const {
    expandedProjects,
    toggleProjectExpand,
    expandProject,
    workspaceSearchQuery,
    setWorkspaceSearchQuery,
    searchConversationIndex,
    ensureSearchConversationIndex,
  } = useProjectTreeState(projectId, allProjects);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listProjects();
        if (!cancelled) setAllProjects(list);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const workspacePath = project?.workspacePath || '';
  const compactWorkspacePath = useMemo(() => {
    if (!workspacePath) return '工作目录初始化中';
    const homeMatch = workspacePath.match(/^\/Users\/[^/]+/);
    const displayPath = homeMatch
      ? workspacePath.replace(homeMatch[0], '~')
      : workspacePath;
    if (displayPath.length <= 72) return displayPath;
    const parts = displayPath.split('/').filter(Boolean);
    if (parts.length <= 4) return displayPath;
    return `.../${parts.slice(-4).join('/')}`;
  }, [workspacePath]);

  const titleBarTabs = useMemo(
    () =>
      openRightTabs
        .filter((tab) => tab !== 'home')
        .map((tab) => {
          const item = RIGHT_PANEL_ITEMS.find((candidate) => candidate.id === tab);
          return {
            id: tab,
            label: item?.label || tab,
            icon: item?.icon || 'folder',
            closable: true,
          };
        }),
    [openRightTabs]
  );

  const titleBarResultItems = useMemo(() => conversationJobs.map((job) => {
    const status = job.status === 'done'
      ? '完成'
      : job.status === 'failed'
        ? '失败'
        : job.status === 'running'
          ? '运行中'
          : '排队中';
    return {
      id: job.id,
      label: job.name || job.tool_id || '分析结果',
      status: `${status} · ${new Date(job.created_at).toLocaleTimeString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })}`,
    };
  }), [conversationJobs]);

  const handleSelectTitleBarResult = useCallback((jobId: string) => {
    if (!conversationJobs.some((job) => job.id === jobId)) return;
    bindActiveJob(jobId);
    setRightOpen(true);
    openRightPanel('results');
    updateWorkspaceMode('result', true, jobId);
  }, [bindActiveJob, conversationJobs, openRightPanel, setRightOpen, updateWorkspaceMode]);

  const switchToProject = useCallback((id: string) => {
    if (id !== projectId) navigate(`/project/${id}`);
  }, [navigate, projectId]);

  useEffect(() => {
    setActiveWorkspaceFile(null);
    setOpenWorkspaceFiles([]);
  }, [projectId]);

  const handleOpenWorkspaceFile = useCallback((file: ActiveWorkspaceFile) => {
    setOpenWorkspaceFiles((prev) => (
      prev.some((item) => item.path === file.path) ? prev : [...prev, file]
    ));
    setActiveWorkspaceFile(file);
  }, []);

  const handleCloseWorkspaceFile = useCallback((pathToClose: string) => {
    setOpenWorkspaceFiles((prev) => {
      const closingIndex = prev.findIndex((item) => item.path === pathToClose);
      const next = prev.filter((item) => item.path !== pathToClose);
      setActiveWorkspaceFile((current) => {
        if (current?.path !== pathToClose) return current;
        return next[Math.min(Math.max(closingIndex, 0), next.length - 1)] || null;
      });
      return next;
    });
  }, []);

  // Plan 1.6 §4.3 — the SWR hook already handles initial load + cleanup on
  // projectId change (it seeds from the shared cache and resets state when
  // projectId is null). What it doesn't know about is the auto-select rule
  // "if no conversation is active, pick the most recent one for this project".
  useEffect(() => {
    if (!projectId) return;
    if (activeConvId) return;
    if (conversations.length === 0) return;
    setActiveConvId(conversations[0].id);
  }, [projectId, conversations, activeConvId]);

  // Reset active conv when the project changes — hook re-seeds the list.
  useEffect(() => {
    setActiveConvId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Plan 1.6 §4.3 — single source for "other project" conversation lists.
  // Replaces the old per-project useState map that re-fetched on every
  // expansion. Reads / writes the same shared cache as useConversations.
  const { byProjectId: projectConversations, refresh: refreshOtherConversations } = useOtherConversations(
    expandedProjects,
    projectId
  );

  // Create new conversation in current project (Plan 1.6 §4.3 — uses the
  // shared SWR cache so sidebar + chat panel stay consistent without a
  // 5s polling timer).
  const handleNewConversation = useCallback(
    async (targetProjectId = projectId) => {
      if (!targetProjectId) return;
      updateWorkspaceMode('chat');
      const conv = await createConversation('新对话', undefined, targetProjectId);
      if (!conv) return;
      if (targetProjectId === projectId) {
        setActiveConvId(conv.id);
        // Hook already prepends optimistically; refresh keeps us honest if
        // the server enriched the row with id/timestamps we didn't pre-seed.
        refreshConversations();
      } else {
        // Cross-project creation: prepend into the local seed map so the
        // next render shows the new conv without an extra fetch.
        setOtherSeed((seed) => ({
          ...seed,
          [targetProjectId]: [conv, ...(seed[targetProjectId] || [])],
        }));
        navigate(`/project/${targetProjectId}`);
      }
    },
    [projectId, refreshConversations, navigate, updateWorkspaceMode]
  );

  // Switch conversation
  const handleSwitchConversation = useCallback((convId: string) => {
    updateWorkspaceMode('chat');
    setActiveJobId(null);
    setActiveArtifact(null);
    setActiveConvId(convId);
  }, [updateWorkspaceMode]);

  const handleShowChat = useCallback(() => updateWorkspaceMode('chat'), [updateWorkspaceMode]);
  const handleShowSearch = useCallback(() => {
    updateWorkspaceMode('search');
  }, [updateWorkspaceMode]);
  const handleShowScheduled = useCallback(() => {
    const currentJob = conversationJobs.find((job) => job.id === activeJobId);
    const nextJobId = currentJob?.id || conversationJobs[0]?.id || null;
    if (nextJobId) {
      bindActiveJob(nextJobId);
    }
    updateWorkspaceMode('scheduled', true, nextJobId);
  }, [activeJobId, bindActiveJob, conversationJobs, updateWorkspaceMode]);
  // Entering settings hides both side rails: settings is a global surface
  // that doesn't need project context (left: project/chat list) or job
  // artifacts (right: files/results/browser), so collapsing them gives the
  // settings panel more room. Leaving settings (back to chat / search /
  // scheduled / plugins) leaves `leftOpen` / `rightOpen` to the user — we
  // don't force them back open because they may have intentionally kept
  // them collapsed.
  const handleShowSettings = useCallback(() => {
    setLeftOpen(false);
    setRightOpen(false);
    updateWorkspaceMode('settings');
  }, [setLeftOpen, setRightOpen, updateWorkspaceMode]);

  const handleShowPlugins = useCallback(() => updateWorkspaceMode('plugins'), [updateWorkspaceMode]);

  const handleNavigateToSkills = useCallback(() => navigate('/skills'), [navigate]);

  const handleOpenRightTerminal = useCallback(() => {
    openRightPanel('terminal');
  }, [openRightPanel]);

  const handleOpenRightResults = useCallback(() => {
    openRightPanel('results');
    const currentJob = conversationJobs.find((job) => job.id === activeJobId);
    const nextJobId = currentJob?.id || conversationJobs[0]?.id || null;
    if (nextJobId) {
      bindActiveJob(nextJobId);
      updateWorkspaceMode('result', true, nextJobId);
    }
  }, [activeJobId, bindActiveJob, conversationJobs, openRightPanel, updateWorkspaceMode]);

  const handleOpenRightBrowser = useCallback(() => {
    openRightPanel('browser');
  }, [openRightPanel]);

  const handleOpenRightFiles = useCallback(() => {
    setRightOpen(true);
    openRightPanel('files');
  }, [openRightPanel, setRightOpen]);

  const handleOpenRightChat = useCallback(() => {
    openRightPanel('chat');
  }, [openRightPanel]);

  // TitleBar 注册 —— 8f3d55a5 曾误删整段（右侧工具菜单「+」/ 标签 pills / 结果
  // 选择器随之全部失效），UI-309 从 e689f867 恢复。BLOCK-62 P2：宽度两字段
  // （leftPanelWidth/rightPanelWidth）已从 TitleBarState 退役——regular 顶栏是
  // 列内 ColumnHeader（宽=aside 宽，同 commit），compact/loading/error 的 fixed
  // 条宽度改由本页 props 同树直传，不再每拖拽帧跨树推送 context。
  const titleBarTitle = useMemo(
    () => buildResultTitleBarTitle(workspaceMode, project?.name, activeArtifact?.label || activeArtifact?.name),
    [activeArtifact?.label, activeArtifact?.name, project?.name, workspaceMode],
  );

  useEffect(() => {
    updateTitleBar({
      title: titleBarTitle,
      tabs: titleBarTabs,
      activeTabId: rightTab === 'home' ? null : rightTab,
      onSelectTab: (tabId) => {
        if (tabId === 'results') {
          handleOpenRightResults();
          return;
        }
        setRightTab(tabId as RightPanelMode);
        setRightToolMenuOpen(false);
        setRightOpen(true);
      },
      onCloseTab: (tabId) => closeRightPanelTab(tabId as RightPanelMode),
      onMoreAction: () => setRightToolMenuOpen((value) => !value),
      toolMenuOpen: rightToolMenuOpen,
      toolMenuItems: RIGHT_PANEL_ITEMS.map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        isOpen: openRightTabs.includes(item.id),
      })),
      onSelectToolItem: (tabId) => {
        if (tabId === 'results') {
          handleOpenRightResults();
          setRightToolMenuOpen(false);
          return;
        }
        openRightPanel(tabId as RightPanelMode);
        setRightToolMenuOpen(false);
      },
      resultItems: titleBarResultItems,
      activeResultId: conversationJobs.some((job) => job.id === activeJobId) ? activeJobId : null,
      onSelectResult: handleSelectTitleBarResult,
      canGoBack: rightTab === 'browser' && browserCanGoBack,
      canGoForward: rightTab === 'browser' && browserCanGoForward,
      onGoBack:
        rightTab === 'browser' && browserCanGoBack
          ? () => dispatchGewuEvent(gewuEvents.browserBack)
          : null,
      onGoForward:
        rightTab === 'browser' && browserCanGoForward
          ? () => dispatchGewuEvent(gewuEvents.browserForward)
          : null,
      // Conversations for TitleBar selector
      conversations: conversations.map(c => ({
        id: c.id,
        title: c.title,
        parent_id: c.parent_id ?? null,
      })),
      activeConvId,
      onSelectConversation: handleSwitchConversation,
    });
    return () => {
      updateTitleBar({
        title: 'Gewu',
        tabs: [],
        activeTabId: null,
        onSelectTab: null,
        onCloseTab: null,
        onMoreAction: null,
        toolMenuOpen: false,
        toolMenuItems: [],
        onSelectToolItem: null,
        resultItems: [],
        activeResultId: null,
        onSelectResult: null,
        canGoBack: false,
        canGoForward: false,
        onGoBack: null,
        onGoForward: null,
      });
    };
  }, [
    activeJobId,
    closeRightPanelTab,
    browserCanGoBack,
    browserCanGoForward,
    openRightPanel,
    openRightTabs,
    project?.name,
    titleBarTitle,
    rightTab,
    handleOpenRightResults,
    handleSelectTitleBarResult,
    rightToolMenuOpen,
    setRightOpen,
    setRightToolMenuOpen,
    setRightTab,
    titleBarTabs,
    titleBarResultItems,
    updateTitleBar,
    // UI-309：旧版遗漏——缺失会让顶栏会话选择器持有过期闭包
    conversations,
    activeConvId,
    handleSwitchConversation,
  ]);



  // UI-282 — 拖拽目录直达创建：路径经校验后直接走创建链（UI-304 后无内联面板）
  const createProjectFromWorkspacePath = useCallback(async (selected: string) => {
    setCreateError('');
    const validate = window.biof3Desktop?.files?.validateDirectory;
    if (typeof validate !== 'function') {
      setCreateError('当前环境不支持路径校验');
      return;
    }

    setCreatingProject(true);
    try {
      const res = await validate(selected);
      if (!res.ok || !res.data?.path) {
        setCreateError(res.error || '所选路径无效');
        return;
      }

      const finalPath = res.data.path;
      const name = finalPath.split(/[\\/]/).pop()?.trim() || '新项目';
      const created = await createProject({
        name,
        modality: 'general',
        workspacePath: finalPath,
      });

      setAllProjects((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      expandProject(created.id);
      navigate(`/project/${created.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建项目失败');
    } finally {
      setCreatingProject(false);
    }
  }, [navigate]);

  const openCreatePanel = useCallback(async () => {
    setCreateError('');
    const dialog = window.biof3Desktop?.files?.openDirectoryDialog;
    if (typeof dialog !== 'function') {
      setCreateError('当前环境不支持原生文件夹选择（请在 Gewu 桌面应用中使用）');
      return;
    }

    const selected = await dialog();
    if (!selected) return; // 用户取消，什么都不做

    // 直接创建项目（对齐 Codex）
    await createProjectFromWorkspacePath(selected);
  }, [createProjectFromWorkspacePath]);

  const createConversationForProject = useCallback(async (targetProjectId = projectId) => {
    if (!targetProjectId || creatingConversation) return;
    updateWorkspaceMode('chat');
    expandProject(targetProjectId);
    setCreatingConversation(true);
    try {
      const conv = await createConversation('新对话', undefined, targetProjectId);
      if (!conv) return;
      if (targetProjectId === projectId) {
        setActiveConvId(conv.id);
        await refreshConversations();
      } else {
        // Cross-project creation: prepend into the local seed map so the
        // next render shows the new conv without an extra fetch.
        setOtherSeed((seed) => ({
          ...seed,
          [targetProjectId]: [conv, ...(seed[targetProjectId] || [])],
        }));
        navigate(`/project/${targetProjectId}`);
      }
    } finally {
      setCreatingConversation(false);
    }
  }, [creatingConversation, navigate, projectId, refreshConversations, updateWorkspaceMode]);

  const renameProjectInTree = useCallback(async (targetProjectId: string, name: string) => {
    const next = await updateProject(targetProjectId, { name });
    if (!next) return false;
    setAllProjects((current) => current.map((item) => item.id === next.id ? next : item));
    if (targetProjectId === projectId) setProject(next);
    return true;
  }, [projectId]);

  const renameConversationInTree = useCallback(async (conversationId: string, title: string) => {
    const ok = await renameConversation(conversationId, title);
    if (!ok) return false;
    await Promise.all([refreshConversations(), refreshOtherConversations()]);
    return true;
  }, [refreshConversations, refreshOtherConversations]);

  const archiveProjectFromTree = useCallback(async (targetProjectId: string) => {
    const archived = await setProjectStatus(targetProjectId, 'archived');
    if (!archived) return false;
    const remaining = allProjects.filter((item) => item.id !== targetProjectId);
    setAllProjects(remaining);
    if (targetProjectId === projectId) {
      navigate(remaining[0] ? `/project/${remaining[0].id}` : '/', { replace: true });
    }
    return true;
  }, [allProjects, navigate, projectId]);

  const archiveConversationFromTree = useCallback(async (conversationId: string) => {
    const ok = await archiveConversation(conversationId, true);
    if (!ok) return false;
    if (conversationId === activeConvId) setActiveConvId(null);
    await Promise.all([refreshConversations(), refreshOtherConversations()]);
    return true;
  }, [activeConvId, refreshConversations, refreshOtherConversations]);

  const forkConversationInTree = useCallback(async (conversationId: string, title?: string) => {
    const forked = await forkConversation(conversationId, title);
    if (!forked) return null;
    updateWorkspaceMode('chat');
    await Promise.all([refreshConversations(), refreshOtherConversations()]);
    setActiveConvId(forked.id);
    return forked;
  }, [updateWorkspaceMode, refreshConversations, refreshOtherConversations]);


  // Load conversations for other projects when expanded.
  // Plan 1.6 §4.3 — moved to useOtherConversations hook above; the
  // `projectConversations` variable is now derived from the shared
  // cache + cross-project seed map.

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    try {
      const p = await getProject(projectId);
      if (!p) {
        // 项目被删除/无权访问：清空 project，走全屏错误（致命，非瞬时）
        setProject(null);
        setError('项目不存在或无权访问');
        setLoading(false);
        return;
      }
      setProject(p);
      const [jobList, dsList] = await Promise.all([
        listProjectJobs(projectId),
        listDatasetsByProject(projectId),
      ]);
      setJobs(jobList);
      setDatasets(dsList);
      // 成功路径必须清除此前轮询留下的瞬时错误，否则错误屏永驻（P0-2）
      setError('');
    } catch (e: any) {
      // 轮询瞬时失败：保留已加载数据，错误以非阻塞横幅呈现，下一轮成功即自愈
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setCopilotHarnessIndex(null);
      return;
    }
    let cancelled = false;
    fetchHarnessIndex({ scope: 'project', projectId, maxFiles: 80 })
      .then((response) => {
        if (!cancelled) setCopilotHarnessIndex(response.index || null);
      })
      .catch(() => {
        if (!cancelled) setCopilotHarnessIndex(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleOpenWorkspacePath = useCallback(async () => {
    if (!project?.workspacePath) return;
    const result = await window.biof3Desktop?.files?.openPath?.(project.workspacePath);
    if (result && !result.ok) {
      setWorkspaceNotice(result.error || '无法打开工作目录');
    }
  }, [project?.workspacePath]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 15_000);
    return () => clearInterval(id);
  }, [fetchData]);

  useEffect(() => {
    const handler = () => {
      fetchData();
      void refreshConversationJobs();
      refreshConversations();
      listProjects()
        .then(setAllProjects)
        .catch(() => {});
    };
    const unsub = subscribeGewuEvent(gewuEvents.softRefresh, handler);
    return unsub;
  }, [fetchData, refreshConversationJobs, refreshConversations]);

  // Listen for conversation fork events from SimpleChat (RightPanel or CenterPanel)
  // to refresh the LeftPanel conversation list after a branch is created.
  useEffect(() => {
    const handler = async (_detail: { newConversationId: string; projectId: string }) => {
      updateWorkspaceMode('chat');
      await Promise.all([refreshConversations(), refreshOtherConversations()]);
    };
    const unsub = subscribeGewuEvent(gewuEvents.conversationForked, handler);
    return unsub;
  }, [updateWorkspaceMode, refreshConversations, refreshOtherConversations]);

  useEffect(() => {
    if (workspaceMode === 'search') {
      ensureSearchConversationIndex().catch(() => {});
    }
  }, [ensureSearchConversationIndex, workspaceMode]);

  const activeJob = useMemo(() => {
    if (!activeConvId || !activeJobId) return null;
    const candidate = conversationJobs.find((job) => job.id === activeJobId)
      || jobs.find((job) => job.id === activeJobId)
      || null;
    return candidate?.conversationId === activeConvId ? candidate : null;
  }, [activeConvId, activeJobId, conversationJobs, jobs]);

  useEffect(() => {
    if (!activeJob || activeJob.status !== 'done') {
      setActiveJobHarnessIndex(null);
      return;
    }
    let cancelled = false;
    fetchHarnessIndex({ scope: 'artifact', jobId: activeJob.id, maxFiles: 80 })
      .then((response) => {
        if (!cancelled) setActiveJobHarnessIndex(response.index || null);
      })
      .catch(() => {
        if (!cancelled) setActiveJobHarnessIndex(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeJob?.id, activeJob?.status]);

  const jobStats = useMemo(() => {
    let running = 0;
    let failed = 0;
    let done = 0;
    let pending = 0;
    conversationJobs.forEach((job) => {
      if (job.status === 'running') running += 1;
      else if (job.status === 'failed') failed += 1;
      else if (job.status === 'done') done += 1;
      else pending += 1;
    });
    return { running, failed, done, pending };
  }, [conversationJobs]);

  const liveJobsPreview = useMemo(
    () =>
      conversationJobs
        .filter((job) => job.status === 'running' || job.status === 'pending')
        .slice(0, 3),
    [conversationJobs]
  );

  const showPinnedSummary = workspaceMode === 'chat' || workspaceMode === 'scheduled';
  const summaryOpenWidth = sessionFrameWidth === 0
    ? 300
    : summaryVisibility === 'expanded'
      ? Math.min(312, Math.max(292, Math.round(sessionFrameWidth * 0.26)))
      : Math.min(292, Math.max(276, Math.round(sessionFrameWidth * 0.32)));
  const summaryCardOpen = summaryVisibility !== 'hidden' && summaryOpen;
  const { workflow: activeWorkflow } = useHarnessWorkflowStatus(
    activeJob?.id,
    !!activeJob && (
      summaryCardOpen ||
      (rightOpen && rightTab === 'results') ||
      workspaceMode === 'result' ||
      workspaceMode === 'code' ||
      workspaceMode === 'compare' ||
      workspaceMode === 'history'
    ),
    workflowRefreshKey,
  );

  const copilotActiveArtifact = useMemo<NonNullable<CopilotContext['activeArtifact']> | null>(() => {
    if (!activeArtifact) return null;
    const contextToken = effectiveResultContextState?.status === 'ready'
      && isResultStudioContextToken(effectiveResultContextState.contextToken)
      ? effectiveResultContextState.contextToken
      : null;
    return {
      jobId: activeArtifact.jobId,
      toolId: activeArtifact.toolId,
      name: activeArtifact.name,
      type: activeArtifact.type,
      label: activeArtifact.label,
      url: activeArtifact.url,
      revisionId: activeArtifact.revisionId,
      artifactFamilyId: activeArtifact.artifactFamilyId,
      entityType: activeArtifact.entityType,
      idField: activeArtifact.idField,
      selectionId: activeArtifact.selection?.compatibility === 'compatible'
        ? activeArtifact.selectionId
        : null,
      selection: activeArtifact.selection?.compatibility === 'compatible'
        ? summarizeSelectionForAgent(activeArtifact.selection)
        : null,
      selectionCompatibility: activeArtifact.selection?.compatibility || null,
      contextToken,
    };
  }, [activeArtifact, effectiveResultContextState?.contextToken, effectiveResultContextState?.status]);

  // 6.3 — Inject project context into SimpleChat (via shared copilot context).
  // Replaces the original useEffect that did an in-place setCopilotContext
  // patch on every render. useSetCopilotContext resets before applying,
  // so a project switch gets a clean context instead of merging into the
  // previous project's datasets/jobs.
  useSetCopilotContext(
    project
      ? {
          page: 'desktop-project',
          pageTitle: project.name,
          projectId,
          projectName: project.name,
          projectModality: project.modality,
          projectDatasets: datasets.map((d) => ({
            id: d.id,
            name: d.name,
            type: d.nCells != null ? 'single-cell' : undefined,
            rows: d.nCells,
          })),
          projectJobs: jobs.map((j) => ({
            id: j.id,
            toolId: j.tool_id,
            status: j.status,
            name: j.name,
            createdAt: j.created_at,
          })),
          projectHarnessSummary: toCopilotHarnessSummary(copilotHarnessIndex),
          activeJobHarnessSummary: toCopilotHarnessSummary(activeJobHarnessIndex),
          activeJobId: activeJobId ?? undefined,
          activeArtifact: copilotActiveArtifact,
        }
      : {}
  );

  useEffect(() => {
    setActiveArtifact(null);
    setResultContextState(null);
    setResultEditControls(null);
  }, [activeJobId]);

  // G0-RS-P3: 每当打开的结果或其版本变化，就从后端重新投影一次上下文。
  // 这里只提供 job/文件名/revision 线索，坐标齐备与否由后端裁决；
  // 409 时如实记录阻断原因，UI 不把它显示成"Agent 可以直接改"。
  useEffect(() => {
    if (!projectId || !activeArtifact?.jobId || !activeArtifact.name) {
      setResultContextState(null);
      setResultEditControls(null);
      return;
    }
    if (!activeConvId) {
      setResultContextState({
        status: 'blocked',
        bindingKey: resultContextBindingKey,
        contextToken: null,
        reason: '请先创建或选择一个 Agent 会话，再修改当前结果。',
      });
      setResultEditControls(null);
      return;
    }
    let cancelled = false;
    setResultContextState({ status: 'loading', bindingKey: resultContextBindingKey, contextToken: null });
    setResultEditControls(null);
    fetchResultStudioContext({
      language: 'r',
      projectId,
      conversationId: activeConvId,
      jobId: activeArtifact.jobId,
      artifact: activeArtifact.name,
      revisionId: activeArtifact.revisionId ?? null,
    })
      .then((result) => {
        if (cancelled) return;
        if (result.status === 'blocked') {
          setResultContextState({
            status: 'blocked',
            bindingKey: resultContextBindingKey,
            contextToken: null,
            reason: result.diagnostics[0]?.message || null,
          });
          setResultEditControls(null);
          return;
        }
        const contextToken = result.agentView?.contextToken ?? null;
        if (!isResultStudioContextToken(contextToken)) {
          setResultContextState({
            status: 'blocked',
            bindingKey: resultContextBindingKey,
            contextToken: null,
            reason: '本地服务没有返回可验证的结果上下文，请刷新后重试。',
          });
          setResultEditControls(null);
          return;
        }
        setResultContextState({
          status: 'ready',
          bindingKey: resultContextBindingKey,
          contextToken,
          selectionUsable: result.agentView?.selectionState.usableByAgent === true,
          selectionCompatibility: result.agentView?.selectionState.compatibility ?? null,
          publicPhases: result.agentView?.publicPhases || [],
        });
        // G0-RS-P4: 控件 schema 与 Agent 可见参数出自同一后端投影。
        setResultEditControls(result.editControls ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setResultContextState({
            status: 'blocked',
            bindingKey: resultContextBindingKey,
            contextToken: null,
            reason: '无法连接本地服务读取结果上下文。',
          });
          setResultEditControls(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    activeConvId,
    activeArtifact?.jobId,
    activeArtifact?.name,
    activeArtifact?.revisionId,
    activeArtifact?.artifactFamilyId,
    activeArtifact?.selectionId,
    activeSelectionBindingKey,
    resultContextBindingKey,
  ]);

  useEffect(() => {
    if (loading) return;
    if (activeJobId || conversationJobs.length === 0) return;
    const firstJob = conversationJobs[0];
    if (!firstJob) return;
    bindActiveJob(firstJob.id);
  }, [activeJobId, bindActiveJob, conversationJobs, loading]);

  const normalizeToolStatus = useCallback((status: unknown): ToolJob['status'] => {
    if (status === 'completed' || status === 'done') return 'done';
    if (status === 'failed') return 'failed';
    if (status === 'running') return 'running';
    return 'pending';
  }, []);

  const handleOpenResult = useCallback(async (
    jobId: string,
    targetProjectId?: string | null,
    options?: { preserveWorkspaceMode?: boolean; workspaceMode?: WorkspaceMode },
  ) => {
    const targetMode = options?.workspaceMode ?? (options?.preserveWorkspaceMode ? 'chat' : 'result');
    const openRequestId = ++openResultRequestSequenceRef.current;
    const currentProjectId = projectId || null;
    const resolvedTargetProjectId = targetProjectId ?? currentProjectId;
    if (resolvedTargetProjectId && currentProjectId && resolvedTargetProjectId !== currentProjectId) {
      navigate(`/project/${resolvedTargetProjectId}?mode=${targetMode}&job=${encodeURIComponent(jobId)}`);
      return;
    }

    let nextJob = conversationJobs.find((job) => job.id === jobId)
      || jobs.find((job) => job.id === jobId)
      || null;
    let nextProjectId = resolvedTargetProjectId;
    if (!nextJob) {
      try {
        const token = getToken();
        const resp = await fetch(getApiPrefix() + '/tools/status/' + encodeURIComponent(jobId), {
          headers: token ? { Authorization: 'Bearer ' + token } : {},
        });
        const data = await resp.json();
        if (!canCommitJobOpen(openRequestId, openResultRequestSequenceRef.current)) return;
        if (data && data.ok) {
          nextJob = {
            id: String(data.id || jobId),
            tool_id: String(data.toolId || ''),
            status: normalizeToolStatus(data.status),
            created_at: Number(data.createdAt || Date.now()),
            completed_at: data.completedAt ? Number(data.completedAt) : undefined,
            error: data.error ? String(data.error) : undefined,
            name: data.toolId ? `${data.toolId} via agent` : undefined,
            project_id: data.projectId ? String(data.projectId) : (resolvedTargetProjectId || null),
            conversationId: data.conversationId == null ? null : String(data.conversationId),
          };
          nextProjectId = nextJob.project_id || nextProjectId;
          if (nextProjectId && currentProjectId && nextProjectId !== currentProjectId) {
            navigate(`/project/${nextProjectId}?mode=${targetMode}&job=${encodeURIComponent(nextJob.id)}`);
            return;
          }
          setJobs((prev) => (prev.some((j) => j.id === nextJob!.id) ? prev : [nextJob!, ...prev]));
        }
      } catch {
        /* keep the current panel state if the status lookup fails */
      }
      if (!canCommitJobOpen(openRequestId, openResultRequestSequenceRef.current)) return;
    }
    if (!nextJob) {
      bindActiveJob(null);
      setWorkspaceNotice('找不到这个结果，或当前项目无权访问它。');
      if (!options?.preserveWorkspaceMode) updateWorkspaceMode('chat', true, null);
      return;
    }
    if (!nextJob.conversationId) {
      bindActiveJob(null);
      setWorkspaceNotice('这个旧结果没有可信的会话归属，不能混入当前会话。');
      if (!options?.preserveWorkspaceMode) updateWorkspaceMode('chat', true, null);
      return;
    }
    if (nextJob) {
      if (nextJob.conversationId !== activeConvId) {
        setActiveConvId(nextJob.conversationId);
      }
      bindActiveJob(nextJob.id);
      setRightOpen(true);
      openRightPanel('results');
      if (!options?.preserveWorkspaceMode) {
        updateWorkspaceMode('result', true, nextJob.id);
      }
    }
  }, [activeConvId, bindActiveJob, conversationJobs, jobs, navigate, normalizeToolStatus, openRightPanel, projectId, setRightOpen, updateWorkspaceMode]);

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
    if (activeWorkspaceFile?.path === requestedFilePath) return;
    const file: ActiveWorkspaceFile = {
      path: requestedFilePath,
      name: requestedFilePath.split('/').pop() || requestedFilePath,
      url: workspaceFileUrlFor(projectId, requestedFilePath),
      workspaceDir: project?.workspacePath,
    };
    handleOpenWorkspaceFile(file);
    openRightPanel('files');
  }, [activeWorkspaceFile?.path, handleOpenWorkspaceFile, loading, openRightPanel, projectId, requestedFilePath]);

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

  /** Dispatch a copilot-ask event so the embedded SimpleChat picks it up */
  const handleAskAgent = useCallback((prompt: string, options?: { analysisMode?: boolean }) => {
    if (activeConvId && isConversationRunning(activeConvId)) {
      setWorkspaceNotice('当前 Agent 仍在处理上一个请求；完成或停止后再开始新分析。');
      return false;
    }
    setWorkspaceNotice('');
    dispatchGewuEvent(gewuEvents.copilotAsk, { prompt, analysisMode: options?.analysisMode });
    return true;
  }, [activeConvId]);

  // P4R-3: 焦点 Composer 与高级控件在这里汇合。可见 prompt 只包含用户目标/
  // 手动 patch；opaque token + Artifact/Revision/Selection 快照走事件 context，
  // 不进入消息文字。后端仍会重新投影真相并拒绝陈旧 token。
  const handleResultEditSubmit = useCallback((submission: ResultEditSubmission) => {
    if (!activeConvId || isConversationRunning(activeConvId)) {
      setWorkspaceNotice('当前 Agent 仍在处理上一条请求；完成或停止后可继续修改结果。');
      return false;
    }
    setResultEditSubmitting(true);
    try {
      const detail = buildResultEditCopilotAsk({
        submission,
        activeArtifact: copilotActiveArtifact,
        currentContextToken: effectiveResultContextState?.status === 'ready'
          ? effectiveResultContextState.contextToken
          : null,
      });
      if (!detail) {
        setWorkspaceNotice('当前结果上下文已经变化，请等待上下文刷新后再提交。');
        return false;
      }
      setWorkspaceNotice('');
      dispatchGewuEvent(gewuEvents.copilotAsk, detail);
      return true;
    } finally {
      setResultEditSubmitting(false);
    }
  }, [activeConvId, copilotActiveArtifact, effectiveResultContextState?.contextToken, effectiveResultContextState?.status]);

  const openScheduledResults = useCallback(() => {
    const currentJob = conversationJobs.find((job) => job.id === activeJobId);
    const nextJobId = currentJob?.id || conversationJobs[0]?.id || null;
    if (nextJobId) {
      bindActiveJob(nextJobId);
      updateWorkspaceMode('result', true, nextJobId);
    }
    setRightOpen(true);
    openRightPanel('results');
  }, [activeJobId, bindActiveJob, conversationJobs, openRightPanel, setRightOpen, updateWorkspaceMode]);

  if (loading) {
    return (
      <div className={styles.earlyReturnWrap}>
        <TitleBar />
        <div className={styles.loadingWrap}>
          <p>加载项目中…</p>
        </div>
      </div>
    );
  }

  // 只有"尚未加载到项目"时错误才全屏；已加载项目的轮询瞬时错误走顶部横幅，不卸载整页
  if (error && !project) {
    return (
      <div className={styles.earlyReturnWrap}>
        <TitleBar />
        <div className={styles.errorWrap}>
          <p>{error}</p>
          <Link to="/" className={styles.backLink}>← 返回工作台</Link>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className={styles.earlyReturnWrap}>
        <TitleBar />
        <div className={styles.errorWrap}>
          <p>项目不存在</p>
          <Link to="/" className={styles.backLink}>← 返回工作台</Link>
        </div>
      </div>
    );
  }

  // CenterPanel ctx — bundles every piece of state/handler the middle column
  // needs to render its 8 workspaceMode layouts. ProjectWorkspace remains the
  // single source of truth; CenterPanel is a pure renderer.
  const centerPanelCtx: CenterPanelContext = {
    columnHeader: compactLayout ? undefined : <ColumnHeader side="center" />,
    project: project as Project,
    projectId,
    allProjects,
    activeConvId,
    conversations,
    projectConversations,
    searchConversationIndex,
    workspaceMode,
    workspaceSearchQuery,
    showPinnedSummary,
    centerColRef: centerColRef as React.RefObject<HTMLElement>,
    sessionFrameRef: sessionFrameRef as React.RefObject<HTMLDivElement>,
    bottomTerminalOpen,
    bottomTerminalHeight,
    leftOpen,
    rightOpen,
    inputHeight,
    summaryCardOpen,
    summaryVisibility,
    summaryOpenWidth,
    activeJob,
    activeWorkflow,
    activeArtifact,
    resultContext: effectiveResultContextState,
    resultEditSubmitting: resultEditBusy,
    resultAgentDraft,
    activeJobId,
    pendingArtifactName: pendingArtifactJobIdRef.current === activeJob?.id ? pendingArtifactName : null,
    recentJobs: conversationJobs,
    liveJobsPreview,
    jobStats,
    backendStatus,
    jobs,
    datasets,
    updateWorkspaceMode,
    setWorkspaceSearchQuery,
    openRightPanel,
    switchToProject,
    navigate,
    handleSwitchConversation,
    setActiveConvId,
    setActiveJobId,
    setActiveArtifact,
    setResultAgentDraft,
    onResultEditSubmit: handleResultEditSubmit,
    setBottomTerminalOpen,
    setSummaryOpen,
    setLeftOpen,
    setRightOpen,
    handleShowPlugins,
    handleOpenResult,
    handleAskAgent,
    handleOpenWorkspacePath,
    onPendingArtifactConsumed: () => {
      pendingArtifactNameRef.current = null;
      pendingArtifactJobIdRef.current = null;
      setPendingArtifactName(null);
    },
    onWorkflowChanged: () => setWorkflowRefreshKey((value) => value + 1),
    openRevisionWorkspaceFile: (relativePath: string) => {
      dispatchGewuEvent(gewuEvents.projectOpenWorkspaceFile, {
        projectId: projectId || '',
        relativePath,
        name: relativePath.split('/').pop() || relativePath,
        openWithSystemApp: false,
      });
    },
    openResultBrowser: (url: string) => {
      setBrowserUrl(url);
      openRightPanel('browser');
    },
    openScheduledResults,
    startColumnResize,
  };

  const leftPanelCtx: LeftPanelContext = {
    width: leftWidth,
    columnHeader: compactLayout ? undefined : <ColumnHeader side="left" />,
    project: project as Project,
    workspacePath,
    compactWorkspacePath,
    visibleProjects: allProjects,
    projectConversations,
    projectId,
    conversations,
    activeConvId,
    expandedProjects,
    creatingProject,
    creatingConversation,
    // UI-304 简化版 — 点 + 直接创建，无面板
    createPanel: {
      open: false, // 不再需要面板
      error: createError,
      onOpen: openCreatePanel,
      onPickExternal: createProjectFromWorkspacePath,
    },
    createConversationForProject,
    renameProject: renameProjectInTree,
    renameConversation: renameConversationInTree,
    archiveProject: archiveProjectFromTree,
    archiveConversation: archiveConversationFromTree,
    forkConversation: forkConversationInTree,
    workspaceMode,
    handleShowSearch,
    handleShowScheduled,
    handleShowPlugins,
    handleShowSettings,
    handleNavigateToSkills,
    switchToProject,
    handleSwitchConversation,
    toggleProjectExpand,
    handleOpenWorkspacePath,
  };

  const rightPanelCtx: RightPanelContext = {
    width: effectiveRightWidth,
    columnHeader: compactLayout ? undefined : <ColumnHeader side="right" />,
    project: project as Project,
    projectId,
    activeConvId,
    openRightTabs,
    rightTab,
    rightToolMenuOpen,
    setRightTab,
    setRightToolMenuOpen,
    openRightPanel,
    closeRightPanelTab,
    activeJob,
    activeWorkflow,
    onWorkflowChanged: () => setWorkflowRefreshKey((value) => value + 1),
    activeArtifact,
    setActiveArtifact,
    resultContext: effectiveResultContextState,
    resultEditControls: effectiveResultEditControls,
    resultEditSubmitting: resultEditBusy,
    onResultEditSubmit: handleResultEditSubmit,
    openWorkspaceFiles,
    activeWorkspaceFile,
    setActiveWorkspaceFile,
    pendingArtifactName: pendingArtifactJobIdRef.current === activeJob?.id ? pendingArtifactName : null,
    onPendingArtifactConsumed: () => {
      pendingArtifactNameRef.current = null;
      pendingArtifactJobIdRef.current = null;
      setPendingArtifactName(null);
    },
    backendStatus,
    browserUrl,
    setBottomTerminalOpen,
    setRightOpen,
    setActiveConvId,
    handleAskAgent,
    handleOpenWorkspaceFile,
    handleCloseWorkspaceFile,
    handleOpenResult,
    handleOpenRightResults,
    handleOpenRightTerminal,
    handleOpenRightBrowser,
    handleOpenRightFiles,
    handleOpenRightChat,
    setBrowserUrl,
    setBrowserCanGoBack,
    setBrowserCanGoForward,
  };

  // backendStatus.rRuntime 可为 null（状态查询失败 = 未知）。用 `=== false`
  // 严格判定"确认缺失"，避免偶发 IPC 异常时误弹缺失横幅。
  const rRuntimeMissing = backendStatus.rRuntime === false;
  const pyRuntimeMissing = backendStatus.pyRuntime === false;

  const showRuntimeBanner =
    backendStatus.loaded &&
    workspaceMode !== 'plugins' &&
    (rRuntimeMissing || pyRuntimeMissing);

  let runtimeBannerMessage: string;
  if (rRuntimeMissing && pyRuntimeMissing) {
    runtimeBannerMessage = 'R 与 Python 运行时均未安装，分析功能暂不可用。';
  } else if (rRuntimeMissing) {
    runtimeBannerMessage = 'R 运行时未安装，依赖 R 的分析无法运行。';
  } else {
    runtimeBannerMessage = 'Python 运行时未安装，依赖 Python 的分析无法运行。';
  }

  return (
    <div className={`${styles.workspaceRoot} ${compactLayout ? styles.workspaceRootCompact : ''}`}>
      {/* BLOCK-62 P1b — compact（≤960px）列变浮层、无「列宽」语义 → fixed 整条
          回归（ctx 注入的列内 header 已同步禁用）；regular 顶栏由三个列内
          ColumnHeader 承载（AppShell 在本路由不渲染全局条）。
          P2：浮层列打开时 fixed 条 grid span 与 aside 实际宽对齐 → 栏宽经 props
          同树直传（同一次 commit），不再走 updateTitleBar context 跨树推送。 */}
      {compactLayout && <TitleBar leftPanelWidth={leftWidth} rightPanelWidth={effectiveRightWidth} />}
      {showRuntimeBanner && (
        <div
          className={`${styles.runtimeMissingBanner} ${compactLayout ? '' : styles.runtimeMissingBannerOverlay}`}
          role="alert"
        >
          <span className={styles.runtimeMissingBannerText}>
            <Icon name="cpu" size={15} />
            <span>{runtimeBannerMessage}</span>
          </span>
          <button
            type="button"
            className={styles.runtimeMissingBannerBtn}
            onClick={handleShowPlugins}
          >
            去插件商店安装
          </button>
        </div>
      )}
      {workspaceNotice && (
        <div className={styles.workspaceNotice} role="status" aria-live="polite">
          {workspaceNotice}
        </div>
      )}
      {error && (
        <div className={styles.workspaceNotice} role="alert" aria-live="assertive">
          数据刷新暂时失败：{error}（将在下一轮自动重试）
        </div>
      )}
      <div className={styles.workspaceBody}>
        {compactLayout && (leftOpen || rightOpen) && (
          <button
            className={styles.panelBackdrop}
            onClick={() => {
              setLeftOpen(false);
              setRightOpen(false);
            }}
            aria-label="关闭侧栏"
          />
        )}

        {/* Left column — Project list + conversations (AionUi style) */}
        {leftOpen && (
          <>
            <LeftPanel ctx={leftPanelCtx} />
            <div className={styles.resizeHandleV} onMouseDown={startColumnResize('left')} />
          </>
        )}

        {/* Center column — Simple chat (conversation-driven) */}
        <CenterPanel ctx={centerPanelCtx} />

        <RightPanel
          ctx={rightPanelCtx}
          visible={rightOpen}
          workspaceMode={workspaceMode}
          onResize={startColumnResize('right')}
        />
        <BottomTerminal
          open={bottomTerminalOpen}
          height={bottomTerminalHeight}
          leftOffset={leftOpen ? `var(--gewu-live-left-span, ${leftWidth + 1}px)` : 0}
          rightOffset={rightOpen ? `var(--gewu-live-right-span, ${effectiveRightWidth + 1}px)` : 0}
          workspacePath={project.workspacePath}
          onResize={handleBottomTerminalResize}
          onClose={() => setBottomTerminalOpen(false)}
        />
      </div>
    </div>
  );
}

// ============================================================
// FileTreeList — recursive file tree rendering
// ============================================================


// ── UI-305 P1 — 尾部 11 个内联组件外迁 ./project-workspace/ 子目录（零行为变化）──
// FileTreeList / FileTreeItem / RightFileTree / WorkspaceFilePreview / BinaryPreviewCard /
// OfficePreviewPane / PreviewAssets / TextBlock / TerminalPanel / BrowserPanel / EmptyResult。
// 导出类组件按既有惯例在此再导出，'@/pages/project-workspace' 导入路径零破坏。
export { RightFileTree } from './project-workspace/RightFileTree';
export { TerminalPanel } from './project-workspace/TerminalPanel';
export { BrowserPanel } from './project-workspace/BrowserPanel';
export { EmptyResult } from './project-workspace/EmptyResult';
import { RightFileTree } from './project-workspace/RightFileTree';
import { TerminalPanel } from './project-workspace/TerminalPanel';
import { BrowserPanel } from './project-workspace/BrowserPanel';
import { EmptyResult } from './project-workspace/EmptyResult';
import { FileTreeList } from './project-workspace/FileTreeList';
import { WorkspaceFilePreview } from './project-workspace/WorkspaceFilePreview';
import { useProjectTreeState } from './project-workspace/useProjectTreeState';
