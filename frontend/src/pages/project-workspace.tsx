// ============================================================
// ProjectWorkspace — UI-REFACTOR Phase3
// Three-column layout: left=resources, center=results+agent, right=history+results
// Collapsible panels. Route: /project/:projectId
// ============================================================

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Icon, type IconName } from '@/components/icons/Icon';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import { BottomTerminal } from '@/components/workspace-panels/BottomTerminal';
import { CenterPanel, type CenterPanelContext } from '@/components/workspace-panels/CenterPanel';
import { LeftPanel, type LeftPanelContext } from '@/components/workspace-panels/LeftPanel';
import { RightPanel, type RightPanelContext } from '@/components/workspace-panels/RightPanel';
import { DataIntakeControl } from '@/components/workspace-panels/DataIntakeControl';
import { WorkspaceFileIcon } from '@/components/workspace-panels/WorkspaceFileIcon';
import { getProject, listProjectJobs, listDatasetsByProject, listProjects, updateProject, createProject, setProjectStatus } from '@/lib/project-store';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { tools as staticTools } from '@/pages/_data';
import { buildPreviewTable } from '@/lib/file-preview/buildPreviewTable';
import type { Tool } from '@/pages/_data';
import { Lightbox } from '@/components/ui/Lightbox';
import { HighlightedCode, codeLanguageForFile } from '@/components/ui/CodeHighlight';
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
import { usePluginStore } from '@/hooks/usePluginStore';
import { segmentToMode, modeToSegment, type WorkspaceMode } from '@/hooks/useWorkspaceRouting';
import { isDirectRecoveryAction, useHarnessWorkflowStatus } from '@/hooks/useHarnessWorkflowStatus';
import { useSetCopilotContext } from '@/lib/copilotContextProvider';
import type { CopilotContext, HarnessContextSummary } from '@/lib/copilotContext';
import { biof3Events, subscribeBioF3Event, dispatchBioF3Event } from '@/lib/events';
import { usePendingScroll } from '@/lib/pendingScrollContext';
import type { DiffRevision } from '@/components/editor/CodeMirror/types';
import { getBrowserViewportSize, isBioF3LocalBrowserUrl, normalizeBrowserUrl } from '@/lib/browser-url';
import { useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';
import { useTheme } from '@/themes/ThemeProvider';
import { fileExtension, isImageFile, isTextFile, isMarkdownFile, workspaceFileUrlFor, formatPreviewText } from '@/lib/previewFileUtils';
import type { ActiveArtifact, JobStats } from '@/components/workspace-panels/ResultView';
import {
  fetchHarnessIndex,
  runHarnessWorkflowAction,
  type HarnessIndexSummary,
  type HarnessWorkflowJobState,
} from '@/lib/harness-client';
import {
  normalizeResultManifest,
  classifyArtifact,
  buildResultArtifactNavigation,
  findArtifactByName,
  pickPreferredArtifact,
  artifactKindLabel,
  type ResultArtifactKind,
  type ResultArtifactRecord,
} from '@/lib/result-manifest';
import {
  artifactFormatLabel,
  buildResultArtifactPickerGroups,
  filterResultArtifactRelatedSections,
  findResultArtifactPickerOption,
  isRelatedArtifactKind,
} from '@/lib/result-artifact-display';
import { buildResultTitleBarTitle } from '@/lib/result-title-bar';
import {
  summarizeSelectionForAgent,
  type ArtifactInteractionManifest,
  type ArtifactSelection,
  type InteractionCapability,
} from '@/lib/artifact-selection';
import { PluginStorePanel } from '@/components/desktop/PluginStorePanel';
import { DesktopSettingsPanel } from '@/components/desktop/DesktopSettingsPanel';
import { ResultStudioChangeSetPanel } from '@/components/result-studio/ResultStudioChangeSetPanel';
import { isSameActiveArtifactProjection } from '@/components/result-studio/activeArtifactProjection';
import { isResultWorkspaceMode, resultFocusTransition } from '@/components/result-studio/resultFocusLayout';
import { RevisionCodeView } from '@/components/result-studio/RevisionCodeView';
import { revisionArtifactUrl, type ArtifactRevision } from '@/components/result-studio/resultStudioClient';
import { shouldShowWorkflowBar } from '@/components/result-studio/resultFirstScreen';
import {
  canCommitResultFetch,
  nextResultBodyState,
  type ResultBodyState,
} from '@/components/result-studio/resultBodyState';
import { getResultScrollPosition, setResultScrollPosition } from '@/components/result-studio/resultScrollMemory';
import { ScientificInteractionViewer } from '@/components/result-studio/ScientificInteractionViewer';
import { CompactResultNavigator } from '@/components/result-studio/CompactResultNavigator';
import {
  deleteResultStudioSelection,
  fetchArtifactInteraction,
  fetchResultStudioContext,
  restoreResultStudioSelection,
  saveResultStudioSelection,
  type ResultStudioEditControls,
  type ResultTableQuery,
} from '@/lib/result-studio-interaction-client';
import type { ResultEditSubmission } from '@/components/result-studio/ResultEditPanel';
import {
  buildResultEditCopilotAsk,
  isResultStudioContextToken,
} from '@/lib/result-edit-agent-bridge';
import {
  beginResultSurfaceMeasure,
  chooseResultArtifactName,
  completeResultSurfaceMeasure,
  describeTruthStatus,
  requestedArtifactRequestKey,
  RESULT_SURFACE_PERFORMANCE_MARKS,
  resolveResultArtifactUrl,
  resolveResultViewerAdapter,
  shouldApplyRequestedArtifact,
  shouldRequestArtifactInteraction,
  shouldShowResultInteraction,
  shouldSurfaceInteractionFailure,
  type ResultSurfaceMode,
} from '@/components/result-studio/resultSurface';
import type { BackendStatus } from '@/lib/electron';
import { getBridge } from '@/lib/desktopBridge';
import {
  describeOfficeKind,
  loadOfficePreview,
  revokeOfficePreviewBlobs,
  suggestedOpener,
  type OfficePreviewAsset,
  type OfficePreviewKind,
  type OfficePreviewModel,
} from '@/lib/office-file-preview';
import styles from './project-workspace.module.css';
import type { ActiveWorkspaceFile } from './project-workspace/types';
import { isCsvFile, isPdfFile, isHtmlFile, isJsonFile, withReportTheme, detectOfficeKind, fallbackKindForExtension, formatSize } from './project-workspace/helpers';

// Re-export for backward compatibility — consumers still import from the page.
export type { ActiveWorkspaceFile } from './project-workspace/types';

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ['className']],
    span: [...(defaultSchema.attributes?.span || []), ['className']],
    div: [...(defaultSchema.attributes?.div || []), ['className']],
  },
};

export type { ActiveArtifact, JobStats } from '@/components/workspace-panels/ResultView';

export type RightPanelMode = 'home' | 'results' | 'files' | 'terminal' | 'browser' | 'chat' | 'analyze';

const RIGHT_PANEL_ITEMS: Array<{ id: RightPanelMode; label: string; icon: IconName }> = [
  { id: 'results', label: '结果', icon: 'bar-chart' },
  { id: 'files', label: '文件', icon: 'folder' },
  { id: 'terminal', label: '后端', icon: 'cpu' },
  { id: 'browser', label: '浏览器', icon: 'globe' },
  { id: 'chat', label: '聊天', icon: 'sidebar' },
  { id: 'analyze', label: '分析', icon: 'sparkles' },
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
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set([projectId || '']));
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState('');
  const [searchConversationIndex, setSearchConversationIndex] = useState<Record<string, ConversationSummary[]>>({});
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

  const [allProjects, setAllProjects] = useState<Project[]>([]);

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

  const ensureSearchConversationIndex = useCallback(async () => {
    const targets = allProjects.filter((item) => !searchConversationIndex[item.id]);
    if (targets.length === 0) return;
    const loaded = await Promise.all(
      targets.map(async (item) => [item.id, await listConversations('active', item.id)] as const)
    );
    setSearchConversationIndex((prev) => {
      const next = { ...prev };
      loaded.forEach(([id, list]) => {
        next[id] = list;
      });
      return next;
    });
  }, [allProjects, searchConversationIndex]);

  const chooseWorkspaceDirectory = useCallback(async () => {
    const selected = await window.biof3Desktop?.files?.openDirectoryDialog?.();
    return selected || '';
  }, []);

  const createProjectFromDirectory = useCallback(async () => {
    if (creatingProject) return;
    setCreatingProject(true);
    try {
      const selectedPath = await chooseWorkspaceDirectory();
      if (!selectedPath) return;
      const normalizedPath = selectedPath.replace(/[\\/]+$/, '');
      const name = normalizedPath.split(/[\\/]/).pop()?.trim() || '新项目';
      const created = await createProject({
        name,
        modality: 'general',
        workspacePath: selectedPath,
      });
      setAllProjects((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        next.add(created.id);
        return next;
      });
      navigate(`/project/${created.id}`);
    } finally {
      setCreatingProject(false);
    }
  }, [chooseWorkspaceDirectory, creatingProject, navigate]);

  const createConversationForProject = useCallback(async (targetProjectId = projectId) => {
    if (!targetProjectId || creatingConversation) return;
    updateWorkspaceMode('chat');
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.add(targetProjectId);
      return next;
    });
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

  // Toggle project expansion in left panel
  const toggleProjectExpand = useCallback((pid: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }, []);

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

  const handleChangeWorkspacePath = useCallback(async () => {
    if (!projectId) return;
    const selected = await chooseWorkspaceDirectory();
    if (!selected) return;
    const next = await updateProject(projectId, { workspacePath: selected });
    if (next) {
      setProject(next);
      setWorkspaceNotice('工作目录已更新');
      listProjects()
        .then(setAllProjects)
        .catch(() => {});
      window.setTimeout(() => setWorkspaceNotice(''), 2400);
    } else {
      setWorkspaceNotice('工作目录更新失败');
    }
  }, [chooseWorkspaceDirectory, projectId]);

  const titleBarTitle = useMemo(
    () => buildResultTitleBarTitle(workspaceMode, project?.name, activeArtifact?.label || activeArtifact?.name),
    [activeArtifact?.label, activeArtifact?.name, project?.name, workspaceMode],
  );

  useEffect(() => {
    updateTitleBar({
      title: titleBarTitle,
      leftPanelWidth: leftWidth,
      rightPanelWidth: effectiveRightWidth,
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
      })).concat([]),
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
          ? () => dispatchBioF3Event(biof3Events.browserBack)
          : null,
      onGoForward:
        rightTab === 'browser' && browserCanGoForward
          ? () => dispatchBioF3Event(biof3Events.browserForward)
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
        title: 'BioF3',
        leftPanelWidth: 240,
        rightPanelWidth: 340,
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
    leftWidth,
    openRightPanel,
    openRightTabs,
    project?.name,
    titleBarTitle,
    project?.workspacePath,
    rightTab,
    effectiveRightWidth,
    handleOpenRightResults,
    handleSelectTitleBarResult,
    rightToolMenuOpen,
    setRightOpen,
    setRightToolMenuOpen,
    setRightTab,
    titleBarTabs,
    titleBarResultItems,
    updateTitleBar,
  ]);

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
    const unsub = subscribeBioF3Event(biof3Events.softRefresh, handler);
    return unsub;
  }, [fetchData, refreshConversationJobs, refreshConversations]);

  // Listen for conversation fork events from SimpleChat (RightPanel or CenterPanel)
  // to refresh the LeftPanel conversation list after a branch is created.
  useEffect(() => {
    const handler = async (_detail: { newConversationId: string; projectId: string }) => {
      updateWorkspaceMode('chat');
      await Promise.all([refreshConversations(), refreshOtherConversations()]);
    };
    const unsub = subscribeBioF3Event(biof3Events.conversationForked, handler);
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
    options?: { preserveWorkspaceMode?: boolean },
  ) => {
    const openRequestId = ++openResultRequestSequenceRef.current;
    const currentProjectId = projectId || null;
    const resolvedTargetProjectId = targetProjectId ?? currentProjectId;
    if (resolvedTargetProjectId && currentProjectId && resolvedTargetProjectId !== currentProjectId) {
      const mode = options?.preserveWorkspaceMode ? 'chat' : 'result';
      navigate(`/project/${resolvedTargetProjectId}?mode=${mode}&job=${encodeURIComponent(jobId)}`);
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
            const mode = options?.preserveWorkspaceMode ? 'chat' : 'result';
            navigate(`/project/${nextProjectId}?mode=${mode}&job=${encodeURIComponent(nextJob.id)}`);
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
        preserveWorkspaceMode: workspaceMode === 'chat',
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
    const unsub = subscribeBioF3Event(biof3Events.projectOpenResult, handler);
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
    const unsub = subscribeBioF3Event(biof3Events.projectOpenArtifact, handler);
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
          timestamp: Date.now(),
        });
      }
      if (detail.openWithSystemApp && workspacePath) {
        void getBridge('files')?.openWorkspaceFile(workspacePath, detail.relativePath);
      }
    };
    const unsub = subscribeBioF3Event(biof3Events.projectOpenWorkspaceFile, handler);
    return unsub;
  }, [handleOpenWorkspaceFile, navigate, openRightPanel, projectId, workspacePath, setPendingRequest]);

  /** Dispatch a copilot-ask event so the embedded SimpleChat picks it up */
  const handleAskAgent = useCallback((prompt: string, options?: { analysisMode?: boolean }) => {
    if (activeConvId && isConversationRunning(activeConvId)) {
      setWorkspaceNotice('当前 Agent 仍在处理上一个请求；完成或停止后再开始新分析。');
      return false;
    }
    setWorkspaceNotice('');
    dispatchBioF3Event(biof3Events.copilotAsk, { prompt, analysisMode: options?.analysisMode });
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
      dispatchBioF3Event(biof3Events.copilotAsk, detail);
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
      <div className={styles.loadingWrap}>
        <p>加载项目中…</p>
      </div>
    );
  }

  // 只有"尚未加载到项目"时错误才全屏；已加载项目的轮询瞬时错误走顶部横幅，不卸载整页
  if (error && !project) {
    return (
      <div className={styles.errorWrap}>
        <p>{error}</p>
        <Link to="/" className={styles.backLink}>← 返回工作台</Link>
      </div>
    );
  }

  if (!project) {
    return (
      <div className={styles.errorWrap}>
        <p>项目不存在</p>
        <Link to="/" className={styles.backLink}>← 返回工作台</Link>
      </div>
    );
  }

  // CenterPanel ctx — bundles every piece of state/handler the middle column
  // needs to render its 8 workspaceMode layouts. ProjectWorkspace remains the
  // single source of truth; CenterPanel is a pure renderer.
  const centerPanelCtx: CenterPanelContext = {
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
      dispatchBioF3Event(biof3Events.projectOpenWorkspaceFile, {
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
    createProjectFromDirectory,
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
    handleChangeWorkspacePath,
  };

  const rightPanelCtx: RightPanelContext = {
    width: effectiveRightWidth,
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
    <div className={styles.workspaceRoot}>
      {showRuntimeBanner && (
        <div className={styles.runtimeMissingBanner} role="alert">
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
          leftOffset={leftOpen ? leftWidth + 1 : 0}
          rightOffset={rightOpen ? effectiveRightWidth + 1 : 0}
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

interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  size?: number;
  modifiedAt?: number;
}

function FileTreeList({
  entries,
  prefix,
  expandedDirs,
  onToggleDir,
  onFetchDir,
  fileUrlFor,
  onOpenFile,
  activePath,
  refreshVersion,
  depth = 0,
  workspaceDir,
}: {
  entries: FileEntry[];
  prefix: string;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onFetchDir: (prefix: string) => Promise<FileEntry[]>;
  fileUrlFor: (path: string) => string;
  onOpenFile: (file: ActiveWorkspaceFile) => void;
  activePath?: string | null;
  refreshVersion: number;
  depth?: number;
  workspaceDir?: string;
}): React.ReactElement {
  const orderedEntries = useMemo(
    () => [...entries].sort((left, right) => {
      if (left.type !== right.type) return left.type === 'dir' ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
    }),
    [entries]
  );

  return (
    <ul className={styles.fileTree} role={depth === 0 ? 'tree' : 'group'}>
      {orderedEntries.map((entry) => {
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const isExpanded = expandedDirs.has(fullPath);
        return (
          <FileTreeItem
            key={fullPath}
            entry={entry}
            fullPath={fullPath}
            isExpanded={isExpanded}
            depth={depth}
            expandedDirs={expandedDirs}
            onToggleDir={onToggleDir}
            onFetchDir={onFetchDir}
            fileUrlFor={fileUrlFor}
            onOpenFile={onOpenFile}
            activePath={activePath}
            refreshVersion={refreshVersion}
            workspaceDir={workspaceDir}
          />
        );
      })}
    </ul>
  );
}

function FileTreeItem({
  entry,
  fullPath,
  isExpanded,
  depth,
  expandedDirs,
  onToggleDir,
  onFetchDir,
  fileUrlFor,
  onOpenFile,
  activePath,
  refreshVersion,
  workspaceDir,
}: {
  entry: FileEntry;
  fullPath: string;
  isExpanded: boolean;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onFetchDir: (prefix: string) => Promise<FileEntry[]>;
  fileUrlFor: (path: string) => string;
  onOpenFile: (file: ActiveWorkspaceFile) => void;
  activePath?: string | null;
  refreshVersion: number;
  workspaceDir?: string;
}): React.ReactElement {
  const [children, setChildren] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (isExpanded && entry.type === 'dir') {
      onFetchDir(fullPath).then(setChildren);
    }
  }, [isExpanded, entry.type, fullPath, onFetchDir, refreshVersion]);

  const fileUrl = fileUrlFor(fullPath);
  const isActive = entry.type === 'file' && activePath === fullPath;

  return (
    <li className={styles.fileTreeNode} role="none">
      <button
        type="button"
        className={`${styles.fileTreeRow} ${isActive ? styles.fileTreeRowActive : ''}`}
        style={{ paddingLeft: 5 + depth * 16 }}
        onClick={() => {
          if (entry.type === 'dir') {
            onToggleDir(fullPath);
            return;
          }
          onOpenFile({
            path: fullPath,
            name: entry.name,
            url: fileUrl,
            size: entry.size,
            workspaceDir,
          });
        }}
        role="treeitem"
        aria-expanded={entry.type === 'dir' ? isExpanded : undefined}
        aria-selected={entry.type === 'file' ? isActive : undefined}
        title={entry.type === 'dir' ? `${isExpanded ? '收起' : '展开'} ${entry.name}` : `预览 ${entry.name}`}
      >
        {entry.type === 'dir' ? (
          <>
            <span className={styles.fileTreeChevron}>
              <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={13} />
            </span>
            <WorkspaceFileIcon name={entry.name} type="dir" />
            <span className={styles.fileTreeName}>{entry.name}</span>
          </>
        ) : (
          <>
            <span className={styles.fileTreeChevron} />
            <WorkspaceFileIcon name={entry.name} type="file" />
            <span className={styles.fileTreeLink}>{entry.name}</span>
            {entry.size != null && (
              <span className={styles.fileTreeSize}>{formatSize(entry.size)}</span>
            )}
          </>
        )}
      </button>
      {isExpanded && entry.type === 'dir' && children.length > 0 && (
        <FileTreeList
          entries={children}
          prefix={fullPath}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
          onFetchDir={onFetchDir}
          fileUrlFor={fileUrlFor}
          onOpenFile={onOpenFile}
          activePath={activePath}
          refreshVersion={refreshVersion}
          depth={depth + 1}
          workspaceDir={workspaceDir}
        />
      )}
    </li>
  );
}

// ============================================================
// RightFileTree — file tree for the right panel (current workspace)



export function RightFileTree({
  project,
  active,
  openFiles,
  activeFile,
  onOpenFile,
  onCloseFile,
  onAskAgent,
}: {
  project: Project;
  active: boolean;
  openFiles: ActiveWorkspaceFile[];
  activeFile: ActiveWorkspaceFile | null;
  onOpenFile: (file: ActiveWorkspaceFile) => void;
  onCloseFile: (path: string) => void;
  onAskAgent: (prompt: string) => boolean | void;
}): React.ReactElement {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [treeOpen, setTreeOpen] = useState(true);
  const [treeWidth, setTreeWidth] = useState(220);

  const [refreshVersion, setRefreshVersion] = useState(0);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [openError, setOpenError] = useState('');
  const [opening, setOpening] = useState(false);
  const activeFileSignatureRef = useRef<string | null>(null);

  const fetchDir = useCallback(async (prefix: string) => {
    try {
      const resp = await fetch(
        getApiPrefix() + `/workspaces/${encodeURIComponent(project.id)}/tree?prefix=${encodeURIComponent(prefix)}`
      );
      const data = await resp.json();
      if (data.ok) return data.entries as FileEntry[];
    } catch { /* ignore */ }
    return [];
  }, [project.id]);

  const refreshFiles = useCallback(async (forcePreview = false) => {
    const rootEntries = await fetchDir('');
    setTree(rootEntries);
    setLoading(false);
    setRefreshVersion((value) => value + 1);

    if (!activeFile?.path) return;
    const segments = activeFile.path.split('/').filter(Boolean);
    const fileName = segments.pop() || activeFile.name;
    const parent = segments.join('/');
    const entries = parent ? await fetchDir(parent) : rootEntries;
    const current = entries.find((entry) => entry.type === 'file' && entry.name === fileName);
    const signature = current
      ? `${current.size ?? -1}:${current.modifiedAt ?? -1}`
      : 'missing';
    const previous = activeFileSignatureRef.current;
    activeFileSignatureRef.current = signature;
    if (forcePreview || (previous !== null && previous !== signature)) {
      setPreviewVersion((value) => value + 1);
    }
  }, [activeFile?.name, activeFile?.path, fetchDir]);

  useEffect(() => {
    activeFileSignatureRef.current = null;
    setOpenError('');
    setOpening(false);
    if (activeFile?.path) {
      const segments = activeFile.path.split('/').filter(Boolean);
      segments.pop();
      setExpandedDirs((current) => {
        const next = new Set(current);
        segments.forEach((_segment, index) => {
          next.add(segments.slice(0, index + 1).join('/'));
        });
        return next;
      });
    }
  }, [activeFile?.path]);

  useEffect(() => {
    setLoading(true);
    void refreshFiles();
  }, [project.id, refreshFiles]);

  useEffect(() => {
    if (!active) return;
    void refreshFiles();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refreshFiles();
    }, 2000);
    const unsubscribe = subscribeBioF3Event(biof3Events.projectWorkspaceChanged, (detail) => {
      if (detail.projectId === project.id) {
        void refreshFiles(true);
      }
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [active, project.id, refreshFiles]);

  const toggleDir = useCallback(async (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);

  const handleOpenFile = useCallback((file: ActiveWorkspaceFile) => {
    onOpenFile(file);
  }, [onOpenFile]);

  const activePreviewUrl = useMemo(() => {
    if (!activeFile?.url) return '';
    const separator = activeFile.url.includes('?') ? '&' : '?';
    return `${activeFile.url}${separator}workspaceRevision=${previewVersion}`;
  }, [activeFile?.url, previewVersion]);

  const openWithSystemApp = useCallback(async () => {
    if (!activeFile || !project.workspacePath) return;
    const filesBridge = getBridge('files');
    if (!filesBridge?.openWorkspaceFile) {
      setOpenError('桌面文件打开能力不可用');
      return;
    }
    setOpening(true);
    setOpenError('');
    try {
      const result = await filesBridge.openWorkspaceFile(project.workspacePath, activeFile.path);
      if (!result.ok) setOpenError(result.error || '系统应用无法打开该文件');
    } catch (error) {
      setOpenError((error as Error).message || '系统应用无法打开该文件');
    } finally {
      setOpening(false);
    }
  }, [activeFile, project.workspacePath]);

  const downloadActiveFile = useCallback(() => {
    if (!activeFile || !activePreviewUrl) return;
    const link = document.createElement('a');
    link.href = activePreviewUrl;
    link.download = activeFile.name;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [activeFile, activePreviewUrl]);

  const breadcrumbSegments = useMemo(
    () => activeFile?.path.split('/').filter(Boolean) || [],
    [activeFile?.path]
  );
  const workspaceRootName = useMemo(() => {
    const pathSegments = String(project.workspacePath || '').split(/[\\/]/).filter(Boolean);
    return pathSegments[pathSegments.length - 1] || project.name;
  }, [project.name, project.workspacePath]);

  const revealBreadcrumbDirectory = useCallback((index: number) => {
    setTreeOpen(true);
    setExpandedDirs((current) => {
      const next = new Set(current);
      for (let cursor = 0; cursor <= index; cursor += 1) {
        next.add(breadcrumbSegments.slice(0, cursor + 1).join('/'));
      }
      return next;
    });
  }, [breadcrumbSegments]);

  const startTreeResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = treeWidth;
    const onMove = (moveEvent: MouseEvent) => {
      setTreeWidth(Math.min(320, Math.max(96, startWidth - (moveEvent.clientX - startX))));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [treeWidth]);

  return (
    <div className={styles.workspaceFiles}>
      <div className={styles.workspaceFilesToolbar}>
        <div className={styles.workspaceBreadcrumb} title={activeFile?.path || project.workspacePath || project.name}>
          <button
            type="button"
            className={styles.workspaceBreadcrumbSegment}
            onClick={() => setTreeOpen(true)}
          >
            {workspaceRootName}
          </button>
          {breadcrumbSegments.map((segment, index) => {
            const isFile = index === breadcrumbSegments.length - 1;
            return (
              <React.Fragment key={`${segment}-${index}`}>
                <Icon name="chevron-right" size={12} className={styles.workspaceBreadcrumbSeparator} />
                {isFile ? (
                  <span className={styles.workspaceBreadcrumbFile}>{segment}</span>
                ) : (
                  <button
                    type="button"
                    className={styles.workspaceBreadcrumbSegment}
                    onClick={() => revealBreadcrumbDirectory(index)}
                  >
                    {segment}
                  </button>
                )}
              </React.Fragment>
            );
          })}
          {!activeFile && <span className={styles.workspaceBreadcrumbEmpty}>选择文件预览</span>}
        </div>
        <DataIntakeControl projectId={project.id} onAskAgent={onAskAgent} />
        <button
          className={styles.workspaceTreeToggle}
          onClick={() => setTreeOpen((value) => !value)}
          title={treeOpen ? '收起文件树' : '展开文件树'}
        >
          <Icon name={treeOpen ? 'chevron-down' : 'chevron-right'} size={13} />
          <Icon name="folder" size={14} />
        </button>
        {activeFile && (
          <button
            type="button"
            className={styles.workspaceTreeToggle}
            onClick={() => onCloseFile(activeFile.path)}
            title={openFiles.length > 1 ? `关闭当前文件（另有 ${openFiles.length - 1} 个已打开文件）` : '关闭当前文件'}
            aria-label="关闭当前文件"
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
      <div className={styles.workspaceFilesMain}>
        <div className={styles.workspaceFilePreviewPane}>
          <WorkspaceFilePreview
            file={activeFile}
            refreshVersion={previewVersion}
            openError={openError}
            opening={opening}
            onOpen={openWithSystemApp}
            onDownload={downloadActiveFile}
            onOpenFile={handleOpenFile}
            projectId={project.id}
          />
        </div>
        {treeOpen && (
          <aside
            className={styles.workspaceFileTreePaneWrap}
            style={{ width: treeWidth, maxWidth: '65%' }}
          >
            <div
              className={styles.workspaceFileTreeResize}
              onMouseDown={startTreeResize}
              title="拖拽调整文件树宽度"
            />
            <div className={styles.workspaceFileTreePane}>
              {loading ? (
                <p className={styles.panelEmpty}>加载文件树…</p>
              ) : tree.length === 0 ? (
                <p className={styles.panelEmpty}>当前工作区暂无文件</p>
              ) : (
                <FileTreeList
                  entries={tree}
                  prefix=""
                  expandedDirs={expandedDirs}
                  onToggleDir={toggleDir}
                  onFetchDir={fetchDir}
                  fileUrlFor={(path) =>
                    getApiPrefix() + `/workspaces/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(path)}`
                  }
                  onOpenFile={handleOpenFile}
                  activePath={activeFile?.path || null}
                  refreshVersion={refreshVersion}
                  depth={0}
                  workspaceDir={project.workspacePath}
                />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function WorkspaceFilePreview({
  file,
  refreshVersion,
  openError,
  opening,
  onOpen,
  onDownload,
  onOpenFile,
  projectId,
}: {
  file: ActiveWorkspaceFile | null;
  refreshVersion: number;
  openError: string;
  opening: boolean;
  onOpen: () => void | Promise<void>;
  onDownload: () => void;
  onOpenFile?: (file: ActiveWorkspaceFile) => void;
  projectId?: string;
}): React.ReactElement {
  const { resolvedTheme } = useTheme();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'unsupported' | 'error'>('idle');
  const [previewData, setPreviewData] = useState<string[][] | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [officePreview, setOfficePreview] = useState<OfficePreviewModel | null>(null);
  const [officeStatus, setOfficeStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  // BLOCK-20 — tracks the last-saved text so isDirty can compare against it
  const [textSaved, setTextSaved] = useState<string>('');
  // BLOCK-21 — Markdown view toggle: 'edit' | 'preview'; resets on file switch
  const [mdView, setMdView] = useState<'edit' | 'preview'>('preview');

  const isImage = isImageFile(file?.name);
  const isText = isTextFile(file?.name);
  const isMarkdown = isMarkdownFile(file?.name);
  const isCsv = isCsvFile(file?.name);
  const isPdf = isPdfFile(file?.name);
  const isHtml = isHtmlFile(file?.name);
  const isJson = isJsonFile(file?.name);
  const officeKind = detectOfficeKind(file?.name);
  const codeLanguage = codeLanguageForFile(file?.name);
  const previewUrl = useMemo(() => {
    if (!file?.url) return '';
    const separator = file.url.includes('?') ? '&' : '?';
    return `${file.url}${separator}workspaceRevision=${refreshVersion}`;
  }, [file?.url, refreshVersion]);

  useEffect(() => {
    let cancelled = false;
    setText('');
    setPreviewData(null);
    setOfficePreview(null);
    setOfficeStatus('idle');
    if (!file) {
      setStatus('idle');
      return () => { cancelled = true; };
    }
    if (isImage || isPdf || isHtml) {
      setStatus('ready');
      return () => { cancelled = true; };
    }
    if (officeKind) {
      setOfficeStatus('loading');
      loadOfficePreview({
        url: previewUrl,
        name: file.name,
        authToken: getToken() || undefined,
      })
        .then((model) => {
          if (cancelled) return;
          setOfficePreview(model);
          setOfficeStatus(model.fallback ? 'error' : 'ready');
          setStatus(model.fallback ? 'unsupported' : 'ready');
        })
        .catch(() => {
          if (cancelled) return;
          setOfficePreview(null);
          setOfficeStatus('error');
          setStatus('unsupported');
        });
      return () => { cancelled = true; revokeOfficePreviewBlobs(); };
    }
    if (!isText && !isCsv && !isJson) {
      setStatus('unsupported');
      return () => { cancelled = true; };
    }
    setStatus('loading');
    fetch(previewUrl, { cache: 'no-store' })
      .then((resp) => {
        if (!resp.ok) throw new Error('preview failed');
        return resp.text();
      })
      .then((body) => {
        if (cancelled) return;
        if (isCsv) {
          setPreviewData(buildPreviewTable(body, file.name, { maxRows: 200 }));
          setStatus('ready');
          return;
        }
        const clipped = body.length > 120_000
          ? `${body.slice(0, 120_000)}\n\n... 文件较大，仅预览前 120KB`
          : body;
        setText(formatPreviewText(file.name, clipped));
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => { cancelled = true; };
  }, [file, isCsv, isHtml, isImage, isJson, isPdf, isText, officeKind, previewUrl]);

  // BLOCK-20 — 文件切换时重置保存基准线和 Markdown 视图
  useEffect(() => {
    setTextSaved('');
    setMdView('preview');
  }, [file?.path]);

  const handleSaveCurrent = useCallback(async () => {
    if (!file) return;
    try {
      if (file.workspaceDir) {
        const wbridge = getBridge('workspace');
        if (!wbridge) return;
        const resp = await wbridge.writeTextFile(file.workspaceDir, file.path, text);
        if (!resp.ok) return;
      }
      setTextSaved(text);
    } catch {
      // silent
    }
  }, [file, text]);

  const handleDiscard = useCallback(() => {
    if (!file) return;
    setText(textSaved);
  }, [file, textSaved]);

  if (!file) {
    return (
      <div className={styles.workspacePreviewEmpty}>
        <Icon name="file" size={18} />
        <span>选择一个文本、图片或 PDF 文件预览</span>
      </div>
    );
  }

  const fallbackKind: 'csv' | 'pdf' | 'html' | 'json' | 'markdown' | 'image' | 'text' | 'binary' =
    isCsv ? 'csv'
    : isPdf ? 'pdf'
    : isHtml ? 'html'
    : isJson ? 'json'
    : isMarkdown ? 'markdown'
    : isImage ? 'image'
    : isText ? 'text'
    : 'binary';

  return (
    <div className={styles.workspacePreview}>
      {openError && <div className={styles.workspacePreviewError}>{openError}</div>}
      <div className={styles.workspacePreviewBody}>
        {(isMarkdown || fallbackKind === 'text' || fallbackKind === 'json') && (
          <div className={styles.workspaceMarkdownDiffToolbar}>
            {isMarkdown && (
              <div className={styles.workspaceMarkdownDiffTabs}>
                <button
                  type="button"
                  className={`${styles.workspaceMarkdownDiffTab} ${mdView === 'edit' ? styles.workspaceMarkdownDiffTabActive : ''}`}
                  onClick={() => setMdView('edit')}
                  aria-pressed={mdView === 'edit'}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className={`${styles.workspaceMarkdownDiffTab} ${mdView === 'preview' ? styles.workspaceMarkdownDiffTabActive : ''}`}
                  onClick={() => setMdView('preview')}
                  aria-pressed={mdView === 'preview'}
                >
                  预览
                </button>
              </div>
            )}
            <div className={styles.workspaceMarkdownDiffActions}>
              {text !== textSaved && (
                <span className={styles.workspaceMarkdownDiffHint}>有未保存修改</span>
              )}
              <button
                type="button"
                className={styles.workspaceMarkdownSave}
                disabled={text === textSaved}
                onClick={() => void handleSaveCurrent()}
                title="保存到文件"
              >
                保存
              </button>
              <button
                type="button"
                className={styles.workspaceMarkdownSave}
                disabled={text === textSaved}
                onClick={() => void handleDiscard()}
                title="放弃修改"
              >
                恢复
              </button>
            </div>
          </div>
        )}
        {status === 'loading' && <p className={styles.panelEmpty}>加载预览…</p>}
        {status === 'error' && <p className={styles.panelEmpty}>预览失败</p>}
        {status === 'unsupported' && !officePreview && (
          <BinaryPreviewCard
            file={file}
            opening={opening}
            onOpen={onOpen}
            onDownload={onDownload}
          />
        )}
        {status === 'unsupported' && officePreview && officePreview.fallback && (
          <BinaryPreviewCard
            file={file}
            opening={opening}
            onOpen={onOpen}
            onDownload={onDownload}
            reason={officePreview.fallback.reason}
          />
        )}
        {officeStatus === 'loading' && (
          <p className={styles.panelEmpty}>解析 {file.name} 的内容…</p>
        )}
        {officeStatus === 'ready' && officePreview && !officePreview.fallback && (
          <OfficePreviewPane preview={officePreview} onAssetOpen={setLightboxSrc} />
        )}
        {status === 'ready' && fallbackKind === 'image' && (
          <button className={styles.workspaceImageButton} onClick={() => setLightboxSrc(previewUrl)}>
            <img src={previewUrl} alt={file.name} className={styles.workspaceImagePreview} />
          </button>
        )}
        {status === 'ready' && fallbackKind === 'pdf' && (
          <object
            data={previewUrl}
            type="application/pdf"
            className={styles.workspacePdfObject}
            aria-label={file.name}
          >
            <iframe
              src={previewUrl}
              title={file.name}
              className={styles.workspacePdfIframe}
            />
          </object>
        )}
        {status === 'ready' && fallbackKind === 'html' && (
          <iframe
            src={withReportTheme(previewUrl, resolvedTheme)}
            title={file.name}
            className={styles.workspaceHtmlIframe}
            sandbox=""
          />
        )}
        {status === 'ready' && fallbackKind === 'csv' && previewData && previewData.length > 0 && (
          <div className={styles.workspaceCsvPreview}>
            <table>
              <thead>
                <tr>
                  {previewData[0].map((cell, idx) => (
                    <th key={`${cell || 'col'}-${idx}`}>{cell || `列 ${idx + 1}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewData.slice(1, 41).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {previewData[0].map((_, cellIndex) => (
                      <td key={cellIndex}>{row[cellIndex] || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {previewData.length > 41 && (
              <p className={styles.workspaceCsvHint}>
                已展示前 40 行 / 共 {previewData.length - 1} 行，完整数据请在外部工具打开。
              </p>
            )}
          </div>
        )}
        {status === 'ready' && fallbackKind === 'markdown' && mdView === 'preview' && (
          <div className={styles.workspaceMarkdownPreview}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight, [rehypeSanitize, markdownSanitizeSchema]]}
              components={{
                a: ({ href, children, ...props }) => {
                  if (!href || !onOpenFile || !file) return <a {...props} href={href}>{children}</a>;
                  // Skip external links and anchors
                  if (href.startsWith('http') || href.startsWith('mailto') || href.startsWith('#')) {
                    return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
                  }
                  // Resolve relative path against current file's directory
                  const fileDir = file.path.split('/').slice(0, -1).join('/');
                  const resolvedPath = fileDir ? `${fileDir}/${href}` : href;
                  const normalizedPath = resolvedPath.replace(/\/+/g, '/').replace(/\/\.\//g, '/');
                  const linkedFile: ActiveWorkspaceFile = {
                    path: normalizedPath,
                    name: normalizedPath.split('/').pop() || normalizedPath,
                    url: getApiPrefix() + `/workspaces/${encodeURIComponent(projectId || '')}/file?path=${encodeURIComponent(normalizedPath)}`,
                  };
                  return (
                    <a
                      {...props}
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        onOpenFile(linkedFile);
                      }}
                      style={{ color: 'var(--biof3-accent, #4f86ff)', textDecoration: 'underline', cursor: 'pointer' }}
                    >
                      {children}
                    </a>
                  );
                },
              }}
            >
              {text}
            </ReactMarkdown>
          </div>
        )}
        {status === 'ready' && fallbackKind === 'markdown' && mdView === 'edit' && (
          <textarea
            className={styles.workspaceMarkdownEditor}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-label="markdown 编辑器"
          />
        )}
        {status === 'ready' && fallbackKind === 'text' && (
          <textarea
            className={styles.workspaceMarkdownEditor}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-label={codeLanguage ? '代码编辑器' : '文本编辑器'}
          />
        )}
        {status === 'ready' && fallbackKind === 'json' && (
          <textarea
            className={styles.workspaceMarkdownEditor}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-label="JSON 编辑器"
          />
        )}
      </div>
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}



function BinaryPreviewCard({
  file,
  opening,
  onOpen,
  onDownload,
  reason,
}: {
  file: ActiveWorkspaceFile;
  opening: boolean;
  onOpen: () => void;
  onDownload: () => void;
  reason?: string;
}): React.ReactElement {
  const ext = fileExtension(file.name);
  const kind = describeOfficeKind(detectOfficeKind(file.name) || fallbackKindForExtension(ext));
  const opener = suggestedOpener(detectOfficeKind(file.name) || fallbackKindForExtension(ext));
  return (
    <div className={styles.workspaceBinaryFallback}>
      <Icon name="file" size={20} />
      <p className={styles.workspaceBinaryTitle}>{kind}</p>
      {reason && <p className={styles.workspaceBinaryMeta}>{reason}</p>}
      <p className={styles.workspaceBinaryMeta}>
        推荐用 {opener} 打开 · 也可以下载副本用本地工具查看。
      </p>
      <div className={styles.workspacePreviewActions}>
        <button
          type="button"
          className={styles.workspacePreviewOpen}
          onClick={onOpen}
          disabled={opening}
        >
          <Icon name="file" size={13} />
          {opening ? '打开中' : '使用系统应用打开'}
        </button>
        <button type="button" className={styles.workspacePreviewOpen} onClick={onDownload}>
          <Icon name="download" size={13} />
          下载副本
        </button>
      </div>
    </div>
  );
}


function OfficePreviewPane({
  preview,
  onAssetOpen,
}: {
  preview: OfficePreviewModel;
  onAssetOpen: (url: string) => void;
}): React.ReactElement {
  if (preview.sheet) {
    return (
      <div className={styles.workspaceOfficeSheet}>
        <div className={styles.workspaceOfficeHeader}>{preview.sheet.name}</div>
        <table>
          <tbody>
            {preview.sheet.rows.length === 0 && (
              <tr><td>未读取到任何行内容，建议在外部表格工具打开</td></tr>
            )}
            {preview.sheet.rows.map((row, idx) => (
              <tr key={idx}>
                {row.cells.map((cell, cellIdx) => (
                  <td key={cellIdx}>{cell || '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {preview.sheet.rows.length >= 80 && (
          <p className={styles.workspaceOfficeHint}>仅展示前 80 行，完整内容请在外部工具打开。</p>
        )}
        <PreviewAssets assets={preview.assets} onAssetOpen={onAssetOpen} />
        <TextBlock text={preview.text} />
      </div>
    );
  }
  if (preview.contents && preview.contents.length > 0) {
    return (
      <div className={styles.workspaceOfficeListing}>
        <p className={styles.workspaceOfficeHint}>
          Apple iWork 容器列出了 {preview.contents.length} 个内嵌资源；如需完整版式，请在系统应用（Pages / Numbers / Keynote）中打开。
        </p>
        <ul>
          {preview.contents.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className={styles.workspaceOfficeDoc}>
      <TextBlock text={preview.text} />
      <PreviewAssets assets={preview.assets} onAssetOpen={onAssetOpen} />
    </div>
  );
}

function PreviewAssets({
  assets,
  onAssetOpen,
}: {
  assets?: OfficePreviewAsset[];
  onAssetOpen: (url: string) => void;
}): React.ReactElement | null {
  if (!assets || assets.length === 0) return null;
  return (
    <div className={styles.workspaceOfficeAssets}>
      {assets.map((asset) => (
        <button
          key={asset.name}
          type="button"
          className={styles.workspaceOfficeAsset}
          onClick={() => onAssetOpen(asset.url)}
          title={asset.name}
        >
          <img src={asset.url} alt={asset.name} />
          <span>{asset.name}</span>
        </button>
      ))}
    </div>
  );
}

function TextBlock({ text }: { text?: string }): React.ReactElement | null {
  if (!text) return null;
  const clipped = text.length > 12_000 ? `${text.slice(0, 12_000)}\n…` : text;
  return <pre className={styles.workspaceOfficeText}>{clipped}</pre>;
}

// ============================================================
// WorkspaceSearchPanel — center column global search view
// ============================================================







// EmbeddedTerminalPanel moved to @/components/workspace-panels/BottomTerminal (PR-3.1)

export function TerminalPanel({
  project,
  backendStatus,
}: {
  project: Project;
  backendStatus: BackendStatus;
}): React.ReactElement {
  const [snapshot, setSnapshot] = useState<{
    ok: boolean;
    logDir?: string;
    dataDir?: string;
    processes?: Array<{
      id: string;
      label: string;
      command: string;
      status: 'running' | 'stopped';
      pid?: number | null;
      logPath?: string;
      output: string;
    }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.biof3Desktop?.terminal?.snapshot?.();
      setSnapshot(result || null);
    } catch {
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const visibleProcesses = useMemo(
    () => (snapshot?.processes || []).filter((proc) => proc.id !== 'plumber'),
    [snapshot]
  );

  return (
    <div className={styles.terminalPanel}>
      <div className={styles.terminalPanelHead}>
        <div className={styles.terminalPanelTitleWrap}>
          <div className={styles.terminalPanelTitle}>后端</div>
          <div className={styles.terminalPanelMeta}>
            {project.workspacePath || '当前项目'} · R {backendStatus.rRuntime ? '已就绪' : '未安装'} · Python {backendStatus.pyRuntime ? '已就绪' : '未安装'}
          </div>
        </div>
        <div className={styles.terminalPanelActions}>
          <button type="button" className={styles.terminalPanelActionBtn} onClick={refresh}>
            刷新
          </button>
          <button
            type="button"
            className={styles.terminalPanelActionBtn}
            onClick={() => window.biof3Desktop?.terminal?.openLogDir?.()}
          >
            打开日志
          </button>
          <button
            type="button"
            className={styles.terminalPanelActionBtn}
            onClick={() => window.biof3Desktop?.terminal?.openShell?.(project.workspacePath)}
          >
            系统终端
          </button>
        </div>
      </div>

      {backendStatus.downReason && (
        <div className={styles.terminalPanelHint}>{backendStatus.downReason}</div>
      )}

      <div className={styles.terminalPanelList}>
        {loading && !snapshot && <div className={styles.panelEmpty}>加载后端状态…</div>}
        {visibleProcesses.map((proc) => (
          <details key={proc.id} className={styles.terminalProcessCard} open>
            <summary className={styles.terminalProcessSummary}>
              <span className={styles.terminalProcessName}>
                <span className={styles.terminalProcessDot} data-status={proc.status} />
                {proc.label}
              </span>
              <span className={styles.terminalProcessMeta}>
                {proc.status === 'running' ? '运行中' : '未运行'}
                {proc.pid ? ` · PID ${proc.pid}` : ''}
              </span>
            </summary>
            <div className={styles.terminalProcessCommand}>{proc.command}</div>
            <pre className={styles.terminalProcessOutput}>
              {loading && !snapshot ? '加载后端状态…' : proc.output || '暂无日志输出'}
            </pre>
          </details>
        ))}
        {!loading && snapshot && visibleProcesses.length === 0 && (
          <div className={styles.panelEmpty}>没有可显示的后端状态</div>
        )}
      </div>
    </div>
  );
}

export function BrowserPanel({
  initialUrl,
  onUrlChange,
  onNavigationStateChange,
  obscured = false,
}: {
  initialUrl: string;
  onUrlChange: (url: string) => void;
  onNavigationStateChange?: (state: { canGoBack: boolean; canGoForward: boolean }) => void;
  obscured?: boolean;
}): React.ReactElement {
  const startUrlRef = useRef(normalizeBrowserUrl(initialUrl));
  const hostRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<any>(null);
  const [inputUrl, setInputUrl] = useState(() => normalizeBrowserUrl(initialUrl));
  const [frameUrl, setFrameUrl] = useState(() =>
    isBioF3LocalBrowserUrl(startUrlRef.current) ? startUrlRef.current : ''
  );
  const [frameKey, setFrameKey] = useState(0);
  const [title, setTitle] = useState('浏览器');
  const [loading, setLoading] = useState(true);
  const [browserError, setBrowserError] = useState('');

  const syncWebviewViewport = useCallback(() => {
    const host = hostRef.current;
    const webview = webviewRef.current;
    if (!host || !webview) return;
    const bounds = host.getBoundingClientRect();
    const viewport = getBrowserViewportSize(bounds.width, bounds.height);
    if (!viewport) return;
    webview.style.setProperty('width', `${viewport.width}px`, 'important');
    webview.style.setProperty('height', `${viewport.height}px`, 'important');
  }, []);

  useEffect(() => {
    if (!webviewRef.current) return;
    webviewRef.current.style.visibility = obscured ? 'hidden' : 'visible';
    webviewRef.current.style.pointerEvents = obscured ? 'none' : 'auto';
    if (!obscured) {
      requestAnimationFrame(() => requestAnimationFrame(syncWebviewViewport));
    }
  }, [obscured, syncWebviewViewport]);

  const navigate = useCallback(
    (value: string) => {
      const nextUrl = normalizeBrowserUrl(value);
      startUrlRef.current = nextUrl;
      setInputUrl(nextUrl);
      onUrlChange(nextUrl);
      if (isBioF3LocalBrowserUrl(nextUrl)) {
        setFrameUrl(nextUrl);
        setBrowserError('');
        setLoading(true);
        onNavigationStateChange?.({ canGoBack: false, canGoForward: false });
        return;
      }
      setFrameUrl('');
      if (webviewRef.current) {
        try {
          webviewRef.current.loadURL(nextUrl);
        } catch {
          webviewRef.current.src = nextUrl;
        }
      }
    },
    [onNavigationStateChange, onUrlChange]
  );

  useEffect(() => {
    const nextUrl = normalizeBrowserUrl(initialUrl);
    if (nextUrl !== startUrlRef.current) navigate(nextUrl);
  }, [initialUrl, navigate]);

  useEffect(() => {
    if (frameUrl) return;
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';

    const webview = document.createElement('webview') as any;
    webview.style.border = '0';
    webview.style.display = 'flex';
    webview.setAttribute('partition', 'persist:biof3-browser');
    webview.setAttribute('allowpopups', 'true');
    webview.src = startUrlRef.current;

    const syncState = () => {
      try {
        const current = typeof webview.getURL === 'function' ? webview.getURL() : webview.src;
        if (current) {
          startUrlRef.current = current;
          setInputUrl(current);
          onUrlChange(current);
        }
        if (typeof webview.getTitle === 'function') {
          setTitle(webview.getTitle() || '浏览器');
        }
        onNavigationStateChange?.({
          canGoBack: Boolean(webview.canGoBack?.()),
          canGoForward: Boolean(webview.canGoForward?.()),
        });
      } catch {
        /* noop */
      }
    };

    const onStart = () => {
      setLoading(true);
      setBrowserError('');
      webview.style.visibility = obscured ? 'hidden' : 'visible';
    };
    const onStop = () => {
      setLoading(false);
      syncWebviewViewport();
      syncState();
    };
    const onTitle = (event: any) => {
      setTitle(String(event?.title || '浏览器'));
    };
    const onFail = (event: any) => {
      if (Number(event?.errorCode) === -3) return;
      setLoading(false);
      setBrowserError(String(event?.errorDescription || '网页加载失败'));
      webview.style.visibility = 'hidden';
      onNavigationStateChange?.({ canGoBack: false, canGoForward: false });
    };
    const onNewWindow = (event: any) => {
      event.preventDefault?.();
      const next = String(event?.url || event?.targetURL || '').trim();
      if (next) navigate(next);
    };

    webview.addEventListener('did-start-loading', onStart);
    webview.addEventListener('did-stop-loading', onStop);
    webview.addEventListener('did-navigate', onStop);
    webview.addEventListener('did-navigate-in-page', onStop);
    webview.addEventListener('page-title-updated', onTitle);
    webview.addEventListener('did-fail-load', onFail);
    webview.addEventListener('new-window', onNewWindow);

    host.appendChild(webview);
    webviewRef.current = webview;
    const resizeObserver = new ResizeObserver(syncWebviewViewport);
    resizeObserver.observe(host);
    const initialResizeFrame = requestAnimationFrame(syncWebviewViewport);
    window.addEventListener('resize', syncWebviewViewport);
    setTitle('浏览器');
    setLoading(true);

    return () => {
      try {
        webview.removeEventListener('did-start-loading', onStart);
        webview.removeEventListener('did-stop-loading', onStop);
        webview.removeEventListener('did-navigate', onStop);
        webview.removeEventListener('did-navigate-in-page', onStop);
        webview.removeEventListener('page-title-updated', onTitle);
        webview.removeEventListener('did-fail-load', onFail);
        webview.removeEventListener('new-window', onNewWindow);
      } catch {}
      cancelAnimationFrame(initialResizeFrame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncWebviewViewport);
      host.innerHTML = '';
      webviewRef.current = null;
      onNavigationStateChange?.({ canGoBack: false, canGoForward: false });
    };
  }, [frameUrl, navigate, onNavigationStateChange, onUrlChange, startUrlRef, syncWebviewViewport]);

  const goBack = useCallback(() => {
    try {
      webviewRef.current?.canGoBack?.() && webviewRef.current.goBack();
    } catch {}
  }, []);

  const goForward = useCallback(() => {
    try {
      webviewRef.current?.canGoForward?.() && webviewRef.current.goForward();
    } catch {}
  }, []);

  const reload = useCallback(() => {
    if (frameUrl) {
      setLoading(true);
      setFrameKey((value) => value + 1);
      return;
    }
    try {
      webviewRef.current?.reload?.();
    } catch {}
  }, [frameUrl]);

  useEffect(() => {
    const offBack = subscribeBioF3Event(biof3Events.browserBack, () => goBack());
    const offForward = subscribeBioF3Event(biof3Events.browserForward, () => goForward());
    return () => {
      offBack();
      offForward();
    };
  }, [goBack, goForward]);

  const submitUrl = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      navigate(inputUrl);
    },
    [inputUrl, navigate]
  );

  return (
    <div className={`${styles.browserPanel} ${obscured ? styles.browserPanelObscured : ''}`}>
      <div className={styles.browserPanelHead}>
        <div className={styles.browserPanelControls}>
          <button type="button" className={styles.browserControlBtn} onClick={goBack} title="后退">
            <Icon name="arrow-left" size={14} />
          </button>
          <button type="button" className={styles.browserControlBtn} onClick={goForward} title="前进">
            <Icon name="chevron-right" size={14} />
          </button>
          <button type="button" className={styles.browserControlBtn} onClick={reload} title="刷新">
            <Icon name="refresh" size={14} />
          </button>
        </div>
        <form className={styles.browserUrlBar} onSubmit={submitUrl}>
          <input
            value={inputUrl}
            onChange={(event) => setInputUrl(event.target.value)}
            placeholder="输入网址或搜索词"
            spellCheck={false}
          />
          <button type="submit" className={styles.browserGoBtn}>
            打开
          </button>
        </form>
      </div>
      <div className={styles.browserMetaRow}>
        <span>{title}</span>
        {loading && <span>加载中…</span>}
      </div>
      {frameUrl ? (
        <iframe
          key={frameKey}
          className={styles.browserFrame}
          src={frameUrl}
          title="BioF3 HTML 报告"
          onLoad={() => {
            setLoading(false);
            setBrowserError('');
          }}
        />
      ) : (
        <div className={styles.browserHost} ref={hostRef} />
      )}
      {browserError && (
        <div className={styles.browserError}>
          <Icon name="globe" size={22} />
          <strong>无法打开网页</strong>
          <span>{browserError}</span>
          <button className="biof3-btn biof3-btn--ghost biof3-btn--sm" type="button" onClick={reload}>重新加载</button>
        </div>
      )}
    </div>
  );
}


export function EmptyResult({
  project,
  onOpenResults,
  onOpenTerminal,
  onOpenBrowser,
  onOpenFiles,
  onOpenChat,
}: {
  project: Project;
  onOpenResults?: () => void;
  onOpenTerminal?: () => void;
  onOpenBrowser?: () => void;
  onOpenFiles?: () => void;
  onOpenChat?: () => void;
}): React.ReactElement {
  return (
    <div className={styles.emptyResult}>
      <div className={styles.emptyResultIcon}>
        <Icon name="zap" size={40} />
      </div>
      <h2 className={styles.emptyResultTitle}>开始工作</h2>
      <p className={styles.emptyResultDesc}>
        打开后端、浏览器、文件或侧边聊天，继续当前项目的分析与协作。
      </p>
      <p className={styles.emptyResultProject}>项目：{project.name}</p>
      <div className={styles.emptyResultLaunchpad}>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenResults} disabled={!onOpenResults}>
          <Icon name="bar-chart" size={16} />
          <div className={styles.emptyResultLaunchText}>
            <span>结果</span>
            <small>查看当前分析产物</small>
          </div>
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenTerminal} disabled={!onOpenTerminal}>
          <Icon name="terminal" size={16} />
          <div className={styles.emptyResultLaunchText}>
            <span>后端</span>
            <small>查看服务状态与日志</small>
          </div>
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenBrowser} disabled={!onOpenBrowser}>
          <Icon name="globe" size={16} />
          <div className={styles.emptyResultLaunchText}>
            <span>浏览器</span>
            <small>打开网页或本地站点</small>
          </div>
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenFiles} disabled={!onOpenFiles}>
          <Icon name="folder" size={16} />
          <div className={styles.emptyResultLaunchText}>
            <span>文件</span>
            <small>浏览项目目录</small>
          </div>
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenChat} disabled={!onOpenChat}>
          <Icon name="sidebar" size={16} />
          <div className={styles.emptyResultLaunchText}>
            <span>侧边聊天</span>
            <small>打开右侧会话面板</small>
          </div>
        </button>
      </div>
    </div>
  );
}

