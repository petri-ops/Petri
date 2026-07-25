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
import { WorkspaceFileIcon } from '@/components/workspace-panels/WorkspaceFileIcon';
import { getProject, listProjectJobs, listDatasetsByProject, listProjects, updateProject, createProject, setProjectStatus } from '@/lib/project-store';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { tools as staticTools } from '@/pages/_data';
import type { Tool } from '@/pages/_data';
import { Lightbox } from '@/components/ui/Lightbox';
import { HighlightedCode, codeLanguageForFile } from '@/components/ui/CodeHighlight';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import { listConversations, createConversation, renameConversation, archiveConversation, type ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import {
  useConversations,
  useOtherConversations,
} from '@/hooks/useConversations';
import { useResizableColumns } from '@/hooks/useResizableColumns';
import { useWorkspaceLayout } from '@/hooks/useWorkspaceLayout';
import { useRightPanelTabs } from '@/hooks/useRightPanelTabs';
import { usePluginStore } from '@/hooks/usePluginStore';
import { isDirectRecoveryAction, useHarnessWorkflowStatus } from '@/hooks/useHarnessWorkflowStatus';
import { useSetCopilotContext } from '@/lib/copilotContextProvider';
import type { HarnessContextSummary } from '@/lib/copilotContext';
import { biof3Events, subscribeBioF3Event, dispatchBioF3Event } from '@/lib/events';
import { getBrowserViewportSize, isBioF3LocalBrowserUrl, normalizeBrowserUrl } from '@/lib/browser-url';
import { useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';
import { useTheme } from '@/themes/ThemeProvider';
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
  countArtifactsByKind,
  findArtifactByName,
  inferSectionDisplayKind,
  pickPreferredArtifact,
  artifactKindLabel,
  type ResultArtifactKind,
  type ResultArtifactRecord,
  type NormalizedResultManifest,
} from '@/lib/result-manifest';
import {
  isSameSelection,
  type ArtifactInteractionManifest,
  type ArtifactSelection,
  type InteractionCapability,
} from '@/lib/artifact-selection';
import { PluginStorePanel } from '@/components/desktop/PluginStorePanel';
import { DesktopSettingsPanel } from '@/components/desktop/DesktopSettingsPanel';
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

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ['className']],
    span: [...(defaultSchema.attributes?.span || []), ['className']],
    div: [...(defaultSchema.attributes?.div || []), ['className']],
  },
};

/**
 * G0-RS3：activeArtifact 从"文件级"升级为 revision / semantic / selection-aware。
 *
 * 升级前它只是 `{jobId, toolId, name, type, label?, url?}` —— 一个文件坐标，
 * 无法回答"这是哪个版本""这些行是哪些基因""用户当前选了什么"。
 *
 * 三个新维度都是可选字段：
 * - revision 维度（`revisionId` / `artifactFamilyId`）由 RS5/RS6 接入 RS2 的
 *   `artifact_revisions` 后填充；RS3 只把类型与身份比较打通，不伪造数据。
 * - semantic 维度（`entityType` / `idField` / `selectionDurable`）来自后端
 *   `GET /api/result-studio/interaction`，它基于**完整文件**判定稳定 ID 列；
 *   浏览器侧 40 行预览样本没有资格做这个判定。
 * - selection 维度（`selection`）由表格行列/过滤/排序与图形点选产生。
 */
interface ActiveArtifact {
  jobId: string;
  toolId: string;
  name: string;
  type: string;
  label?: string;
  url?: string;
  revisionId?: string | null;
  artifactFamilyId?: string | null;
  semanticKind?: ResultArtifactKind;
  entityType?: string | null;
  idField?: string | null;
  selectionDurable?: boolean;
  interactionCapabilities?: InteractionCapability[];
  selection?: ArtifactSelection | null;
}

interface ActiveWorkspaceFile {
  path: string;
  name: string;
  url: string;
  size?: number;
}

interface JobStats {
  running: number;
  failed: number;
  done: number;
  pending: number;
}

export type {
  ActiveArtifact,
  ActiveWorkspaceFile,
  JobStats,
};

type WorkspaceMode =
  | 'chat'
  | 'search'
  | 'scheduled'
  | 'plugins'
  | 'settings';

export type RightPanelMode = 'home' | 'results' | 'files' | 'terminal' | 'browser' | 'chat';

const RIGHT_PANEL_ITEMS: Array<{ id: RightPanelMode; label: string; icon: IconName }> = [
  { id: 'results', label: '结果', icon: 'bar-chart' },
  { id: 'files', label: '文件', icon: 'folder' },
  { id: 'terminal', label: '后端', icon: 'cpu' },
  { id: 'browser', label: '浏览器', icon: 'globe' },
  { id: 'chat', label: '聊天', icon: 'sidebar' },
];

const WORKSPACE_MODES: WorkspaceMode[] = [
  'chat',
  'search',
  'scheduled',
  'plugins',
  'settings',
];

function parseWorkspaceMode(value: string | null): WorkspaceMode | null {
  if (!value) return null;
  return WORKSPACE_MODES.includes(value as WorkspaceMode) ? (value as WorkspaceMode) : null;
}

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
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [project, setProject] = useState<Project | null>(null);
  const [jobs, setJobs] = useState<ToolJob[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(
    () => parseWorkspaceMode(searchParams.get('mode')) || 'chat'
  );
  const requestedJobId = searchParams.get('job');
  const requestedArtifactName = searchParams.get('artifact');
  const requestedFilePath = searchParams.get('file');

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const autoOpenedJobRef = useRef<string | null>(null);
  const [activeArtifact, setActiveArtifact] = useState<ActiveArtifact | null>(null);
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<ActiveWorkspaceFile | null>(null);
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
    viewportWidth,
    bottomTerminalOpen,
    setBottomTerminalOpen,
    summaryOpen,
    setSummaryOpen,
    centerColRef,
    sessionFrameRef,
    sessionFrameWidth,
  } = useWorkspaceLayout();

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

  useEffect(() => {
    if (!rightOpen) setRightToolMenuOpen(false);
  }, [rightOpen, setRightToolMenuOpen]);

  useEffect(() => {
    const nextMode = parseWorkspaceMode(searchParams.get('mode')) || 'chat';
    setWorkspaceMode((current) => (current === nextMode ? current : nextMode));
  }, [searchParams]);

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

  // Bidirectional sync: setWorkspaceMode + URL param. Exists here (not in
  // useWorkspaceRouting) because project-workspace owns workspaceMode state.
  const updateWorkspaceMode = useCallback((nextMode: WorkspaceMode, replace = true, jobId?: string | null) => {
    setWorkspaceMode(nextMode);
    const nextParams = new URLSearchParams(searchParams);
    if (nextMode === 'chat') nextParams.delete('mode');
    else nextParams.set('mode', nextMode);
    if (nextMode === 'scheduled' && jobId) nextParams.set('job', jobId);
    else nextParams.delete('job');
    setSearchParams(nextParams, { replace });
  }, [searchParams, setSearchParams]);

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
    setActiveConvId(convId);
  }, [updateWorkspaceMode]);

  const handleShowChat = useCallback(() => updateWorkspaceMode('chat'), [updateWorkspaceMode]);
  const handleShowSearch = useCallback(() => {
    updateWorkspaceMode('search');
  }, [updateWorkspaceMode]);
  const handleShowScheduled = useCallback(() => {
    const nextJobId = activeJobId || jobs[0]?.id || null;
    if (nextJobId) {
      setActiveJobId(nextJobId);
    }
    updateWorkspaceMode('scheduled', true, nextJobId);
  }, [activeJobId, jobs, updateWorkspaceMode]);
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

  const handleOpenRightTerminal = useCallback(() => {
    openRightPanel('terminal');
  }, [openRightPanel]);

  const handleOpenRightResults = useCallback(() => {
    openRightPanel('results');
  }, [openRightPanel]);

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
    } catch (e: any) {
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

  useEffect(() => {
    updateTitleBar({
      title: project?.name || '梳理开发进展',
      leftPanelWidth: leftWidth,
      rightPanelWidth: effectiveRightWidth,
      tabs: titleBarTabs,
      activeTabId: rightTab === 'home' ? null : rightTab,
      onSelectTab: (tabId) => {
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
        openRightPanel(tabId as RightPanelMode);
        setRightToolMenuOpen(false);
      },
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
    project?.workspacePath,
    rightTab,
    effectiveRightWidth,
    rightToolMenuOpen,
    setRightOpen,
    setRightToolMenuOpen,
    setRightTab,
    titleBarTabs,
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
      refreshConversations();
      listProjects()
        .then(setAllProjects)
        .catch(() => {});
    };
    const unsub = subscribeBioF3Event(biof3Events.softRefresh, handler);
    return unsub;
  }, [fetchData, refreshConversations]);

  useEffect(() => {
    if (workspaceMode === 'search') {
      ensureSearchConversationIndex().catch(() => {});
    }
  }, [ensureSearchConversationIndex, workspaceMode]);

  const activeJob = useMemo(
    () => jobs.find((j) => j.id === activeJobId) || null,
    [jobs, activeJobId]
  );

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
    jobs.forEach((job) => {
      if (job.status === 'running') running += 1;
      else if (job.status === 'failed') failed += 1;
      else if (job.status === 'done') done += 1;
      else pending += 1;
    });
    return { running, failed, done, pending };
  }, [jobs]);

  const liveJobsPreview = useMemo(
    () =>
      jobs
        .filter((job) => job.status === 'running' || job.status === 'pending')
        .slice(0, 3),
    [jobs]
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
    !!activeJob && (summaryCardOpen || (rightOpen && rightTab === 'results')),
    workflowRefreshKey,
  );

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
          activeArtifact,
        }
      : {}
  );

  useEffect(() => {
    setActiveArtifact(null);
  }, [activeJobId]);

  useEffect(() => {
    if (loading) return;
    if (activeJobId || jobs.length === 0) return;
    const firstJob = jobs[0];
    if (!firstJob) return;
    setActiveJobId(firstJob.id);
    setRightOpen(true);
    openRightPanel('results');
  }, [activeJobId, jobs, loading, openRightPanel, setRightOpen]);

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
    const currentProjectId = projectId || null;
    const resolvedTargetProjectId = targetProjectId ?? currentProjectId;
    if (resolvedTargetProjectId && currentProjectId && resolvedTargetProjectId !== currentProjectId) {
      const mode = options?.preserveWorkspaceMode ? 'chat' : 'scheduled';
      navigate(`/project/${resolvedTargetProjectId}?mode=${mode}&job=${encodeURIComponent(jobId)}`);
      return;
    }

    let nextJob = jobs.find((j) => j.id === jobId) || null;
    let nextProjectId = resolvedTargetProjectId;
    if (!nextJob) {
      try {
        const token = getToken();
        const resp = await fetch(getApiPrefix() + '/tools/status/' + encodeURIComponent(jobId), {
          headers: token ? { Authorization: 'Bearer ' + token } : {},
        });
        const data = await resp.json();
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
          };
          nextProjectId = nextJob.project_id || nextProjectId;
          if (nextProjectId && currentProjectId && nextProjectId !== currentProjectId) {
            const mode = options?.preserveWorkspaceMode ? 'chat' : 'scheduled';
            navigate(`/project/${nextProjectId}?mode=${mode}&job=${encodeURIComponent(nextJob.id)}`);
            return;
          }
          setJobs((prev) => (prev.some((j) => j.id === nextJob!.id) ? prev : [nextJob!, ...prev]));
        }
      } catch {
        /* keep the current panel state if the status lookup fails */
      }
    }
    if (nextJob) {
      setActiveJobId(nextJob.id);
      setRightOpen(true);
      openRightPanel('results');
      if (!options?.preserveWorkspaceMode) {
        updateWorkspaceMode('scheduled', true, nextJob.id);
      }
    }
  }, [jobs, navigate, normalizeToolStatus, openRightPanel, projectId, setRightOpen, updateWorkspaceMode]);

  useEffect(() => {
    autoOpenedJobRef.current = null;
  }, [projectId]);

  useEffect(() => {
    if (loading || !projectId) return;

    if (requestedJobId) {
      if (requestedArtifactName && pendingArtifactNameRef.current !== requestedArtifactName) {
        pendingArtifactNameRef.current = requestedArtifactName;
        pendingArtifactJobIdRef.current = requestedJobId;
        setPendingArtifactName(requestedArtifactName);
      }
      if (activeJobId === requestedJobId && workspaceMode === 'scheduled') return;
      if (autoOpenedJobRef.current === requestedJobId) return;
      autoOpenedJobRef.current = requestedJobId;
      void handleOpenResult(requestedJobId, projectId, {
        preserveWorkspaceMode: workspaceMode === 'chat',
      });
      return;
    }

    if (activeJobId || jobs.length === 0) return;
    const firstJob = jobs[0];
    if (!firstJob || autoOpenedJobRef.current === firstJob.id) return;
    autoOpenedJobRef.current = firstJob.id;
    void handleOpenResult(firstJob.id, projectId);
  }, [activeJobId, handleOpenResult, jobs, loading, projectId, requestedArtifactName, requestedJobId, workspaceMode]);

  useEffect(() => {
    if (loading || !projectId || !requestedFilePath) return;
    if (activeWorkspaceFile?.path === requestedFilePath) return;
    const file: ActiveWorkspaceFile = {
      path: requestedFilePath,
      name: requestedFilePath.split('/').pop() || requestedFilePath,
      url: workspaceFileUrlFor(projectId, requestedFilePath),
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
      };
      handleOpenWorkspaceFile(file);
      openRightPanel('files');
      if (detail.openWithSystemApp && workspacePath) {
        void getBridge('files')?.openWorkspaceFile(workspacePath, detail.relativePath);
      }
    };
    const unsub = subscribeBioF3Event(biof3Events.projectOpenWorkspaceFile, handler);
    return unsub;
  }, [handleOpenWorkspaceFile, navigate, openRightPanel, projectId, workspacePath]);

  /** Dispatch a copilot-ask event so the embedded SimpleChat picks it up */
  const handleAskAgent = useCallback((prompt: string) => {
    dispatchBioF3Event(biof3Events.copilotAsk, { prompt });
  }, []);

  const openScheduledResults = useCallback(() => {
    const nextJobId = activeJobId || jobs[0]?.id || null;
    if (nextJobId) {
      setActiveJobId(nextJobId);
    }
    setRightOpen(true);
    openRightPanel('results');
  }, [activeJobId, jobs, openRightPanel, setRightOpen]);

  if (loading) {
    return (
      <div className={styles.loadingWrap}>
        <p>加载项目中…</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className={styles.errorWrap}>
        <p>{error || '项目不存在'}</p>
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
    activeJobId,
    recentJobs: jobs,
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
    setActiveConvId,
    setActiveJobId,
    setActiveArtifact,
    setBottomTerminalOpen,
    setSummaryOpen,
    setLeftOpen,
    setRightOpen,
    handleShowPlugins,
    handleOpenResult,
    handleAskAgent,
    handleOpenWorkspacePath,
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
    workspaceMode,
    handleShowSearch,
    handleShowScheduled,
    handleShowPlugins,
    handleShowSettings,
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

  return (
    <div className={styles.workspaceRoot}>
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
        />
      )}
    </li>
  );
}

// ============================================================
// RightFileTree — file tree for the right panel (current workspace)
// ============================================================

function fileExtension(name?: string): string {
  const idx = name?.lastIndexOf('.') ?? -1;
  return idx >= 0 && name ? name.slice(idx + 1).toLowerCase() : '';
}

function isImageFile(name?: string): boolean {
  return ['png', 'apng', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'heif'].includes(fileExtension(name));
}

function isTextFile(name?: string): boolean {
  return [
    'txt', 'md', 'markdown', 'csv', 'tsv', 'tab', 'json', 'jsonl', 'log',
    'r', 'py', 'sh', 'bash', 'zsh',
    'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx',
    'css', 'scss', 'html', 'htm', 'xml',
    'yaml', 'yml', 'toml', 'ini', 'conf', 'sql',
    'sam', 'bed', 'gtf', 'gff', 'vcf', 'fasta', 'fa', 'fastq', 'fq',
  ].includes(fileExtension(name));
}

function isMarkdownFile(name?: string): boolean {
  return ['md', 'markdown'].includes(fileExtension(name));
}

/**
 * Build a controlled workspace file URL for the in-app preview. Mirrors the
 * URL the workspace file tree uses, so the same auth / cache invariants hold.
 */
function workspaceFileUrlFor(projectId: string, relativePath: string): string {
  return `${getApiPrefix()}/workspaces/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(relativePath)}`;
}

function formatPreviewText(name: string, text: string): string {
  if (fileExtension(name) === 'json') {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

function summarizeRecord(record?: Record<string, number>, limit = 4): string {
  const entries = Object.entries(record || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  return entries.length ? entries.map(([key, count]) => `${key}×${count}`).join(' · ') : '暂无';
}

function HarnessIndexCard({
  title,
  index,
  loading,
  error,
}: {
  title: string;
  index: HarnessIndexSummary | null;
  loading: boolean;
  error?: string;
}): React.ReactElement | null {
  if (!loading && !index && !error) return null;
  const entries = index?.entries || [];
  return (
    <div className={styles.harnessIndexCard}>
      <div className={styles.harnessIndexCardHeader}>
        <span>{title}</span>
        {loading && <em>识别中…</em>}
        {!loading && index && <em>{index.fileCount || 0} 个文件</em>}
      </div>
      {error && !loading ? (
        <p className={styles.harnessIndexMuted}>暂未生成识别摘要：{error}</p>
      ) : index ? (
        <>
          <div className={styles.harnessIndexStats}>
            <span>类型：{summarizeRecord(index.byKind)}</span>
            <span>角色：{summarizeRecord(index.byRole)}</span>
          </div>
          {entries.length > 0 && (
            <div className={styles.harnessIndexEntries}>
              {entries.slice(0, 4).map((entry) => (
                <div key={entry.relativePath} className={styles.harnessIndexEntry} title={entry.relativePath}>
                  <span>{entry.relativePath}</span>
                  <em>{entry.role || entry.kind}</em>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export function RightFileTree({
  project,
  active,
  openFiles,
  activeFile,
  onOpenFile,
  onCloseFile,
}: {
  project: Project;
  active: boolean;
  openFiles: ActiveWorkspaceFile[];
  activeFile: ActiveWorkspaceFile | null;
  onOpenFile: (file: ActiveWorkspaceFile) => void;
  onCloseFile: (path: string) => void;
}): React.ReactElement {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [treeOpen, setTreeOpen] = useState(true);
  const [treeWidth, setTreeWidth] = useState(220);
  const [harnessIndex, setHarnessIndex] = useState<HarnessIndexSummary | null>(null);
  const [harnessLoading, setHarnessLoading] = useState(false);
  const [harnessError, setHarnessError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [openError, setOpenError] = useState('');
  const [opening, setOpening] = useState(false);
  const activeFileSignatureRef = useRef<string | null>(null);
  const harnessRequestRef = useRef(0);

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

  const refreshHarnessIndex = useCallback(async (showLoading = false) => {
    const requestId = harnessRequestRef.current + 1;
    harnessRequestRef.current = requestId;
    if (showLoading) setHarnessLoading(true);
    setHarnessError('');
    try {
      const data = await fetchHarnessIndex({ scope: 'project', projectId: project.id, maxFiles: 120 });
      if (harnessRequestRef.current === requestId) setHarnessIndex(data.index || null);
    } catch (error) {
      if (harnessRequestRef.current !== requestId) return;
      setHarnessIndex(null);
      setHarnessError((error as Error).message || '识别失败');
    } finally {
      if (showLoading && harnessRequestRef.current === requestId) setHarnessLoading(false);
    }
  }, [project.id]);

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
        void refreshHarnessIndex(false);
      }
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [active, project.id, refreshFiles, refreshHarnessIndex]);

  useEffect(() => {
    void refreshHarnessIndex(true);
  }, [project.id, refreshHarnessIndex]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void refreshHarnessIndex(false);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [active, refreshHarnessIndex]);

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
}: {
  file: ActiveWorkspaceFile | null;
  refreshVersion: number;
  openError: string;
  opening: boolean;
  onOpen: () => void | Promise<void>;
  onDownload: () => void;
}): React.ReactElement {
  const { resolvedTheme } = useTheme();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'unsupported' | 'error'>('idle');
  const [previewData, setPreviewData] = useState<string[][] | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [officePreview, setOfficePreview] = useState<OfficePreviewModel | null>(null);
  const [officeStatus, setOfficeStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

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
          setPreviewData(buildWorkspacePreviewTable(body, file.name));
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
        {status === 'ready' && fallbackKind === 'markdown' && (
          <div className={styles.workspaceMarkdownPreview}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight, [rehypeSanitize, markdownSanitizeSchema]]}
            >
              {text}
            </ReactMarkdown>
          </div>
        )}
        {status === 'ready' && fallbackKind === 'text' && codeLanguage && (
          <pre className={styles.workspaceCodePreview}>
            <HighlightedCode code={text} language={codeLanguage} />
          </pre>
        )}
        {status === 'ready' && fallbackKind === 'text' && !codeLanguage && (
          <pre className={styles.workspaceTextPreview}>{text}</pre>
        )}
        {status === 'ready' && fallbackKind === 'json' && (
          <pre className={styles.workspaceCodePreview}>
            <HighlightedCode code={text} language="json" />
          </pre>
        )}
      </div>
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}

function buildWorkspacePreviewTable(text: string, fileName: string): string[][] {
  const lower = fileName.toLowerCase();
  const sep = lower.endsWith('.tsv') || text.includes('\t') ? '\t' : ',';
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 200)
    .map((line) => line.split(sep).map((cell) => cell.replace(/^"|"$/g, '').trim()));
}

function isCsvFile(name?: string): boolean {
  const ext = fileExtension(name);
  return ext === 'csv' || ext === 'tsv';
}

function isPdfFile(name?: string): boolean {
  return fileExtension(name) === 'pdf';
}

function isHtmlFile(name?: string): boolean {
  const ext = fileExtension(name);
  return ext === 'html' || ext === 'htm';
}

function withReportTheme(url: string, theme: 'light' | 'dark'): string {
  if (!url) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}theme=${theme}`;
}

function isJsonFile(name?: string): boolean {
  return fileExtension(name) === 'json' || fileExtension(name) === 'jsonl';
}

function detectOfficeKind(name?: string): OfficePreviewKind | null {
  if (!name) return null;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'docx':
    case 'docm':
    case 'dotx':
      return 'docx';
    case 'xlsx':
    case 'xlsm':
    case 'xltx':
    case 'xlsb':
      return 'xlsx';
    case 'pptx':
    case 'pptm':
    case 'ppsx':
    case 'potx':
      return 'pptx';
    case 'odt':
      return 'odt';
    case 'ods':
      return 'ods';
    case 'odp':
      return 'odp';
    case 'pages':
      return 'pages';
    case 'numbers':
      return 'numbers';
    case 'keynote':
      return 'keynote';
    default:
      return null;
  }
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

function fallbackKindForExtension(ext: string): OfficePreviewKind {
  switch (ext) {
    case 'rdata':
      return 'rdata';
    case 'rds':
      return 'rds';
    case 'h5ad':
      return 'h5ad';
    case 'loom':
      return 'loom';
    case 'h5':
    case 'hdf5':
      return 'hdf5';
    case 'mtx':
      return 'mtx';
    case 'rtf':
      return 'rtf';
    case 'epub':
      return 'epub';
    default:
      return 'binary';
  }
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

export function WorkspaceSearchPanel({
  query,
  onQueryChange,
  projects,
  currentProjectId,
  conversations,
  jobs,
  datasets,
  onOpenProject,
  onOpenConversation,
  onOpenScheduled,
  onOpenPlugins,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  projects: Project[];
  currentProjectId: string;
  conversations: ConversationSummary[];
  jobs: ToolJob[];
  datasets: Dataset[];
  onOpenProject: (id: string) => void;
  onOpenConversation: (projectId: string | null | undefined, convId: string) => void;
  onOpenScheduled: (jobId: string) => void;
  onOpenPlugins: () => void;
}): React.ReactElement {
  const normalizedQuery = query.trim().toLowerCase();

  const projectMatches = useMemo(
    () =>
      projects.filter((item) => {
        if (!normalizedQuery) return true;
        return (
          item.name.toLowerCase().includes(normalizedQuery) ||
          (item.description || '').toLowerCase().includes(normalizedQuery) ||
          (item.modality || '').toLowerCase().includes(normalizedQuery)
        );
      }),
    [normalizedQuery, projects]
  );

  const uniqueConversations = useMemo(() => {
    const deduped = new Map<string, ConversationSummary>();
    conversations.forEach((item) => {
      if (!deduped.has(item.id)) deduped.set(item.id, item);
    });
    return Array.from(deduped.values());
  }, [conversations]);

  const conversationMatches = useMemo(
    () =>
      uniqueConversations.filter((item) => {
        if (!normalizedQuery) return true;
        return (
          item.title.toLowerCase().includes(normalizedQuery) ||
          (item.last_topic_shift_reason || '').toLowerCase().includes(normalizedQuery)
        );
      }),
    [normalizedQuery, uniqueConversations]
  );

  const datasetMatches = useMemo(
    () =>
      datasets.filter((item) => {
        if (!normalizedQuery) return true;
        return (
          item.name.toLowerCase().includes(normalizedQuery) ||
          (item.description || '').toLowerCase().includes(normalizedQuery)
        );
      }),
    [datasets, normalizedQuery]
  );

  const jobMatches = useMemo(
    () =>
      jobs.filter((item) => {
        if (!normalizedQuery) return true;
        return (
          (item.name || '').toLowerCase().includes(normalizedQuery) ||
          item.tool_id.toLowerCase().includes(normalizedQuery) ||
          item.status.toLowerCase().includes(normalizedQuery)
        );
      }),
    [jobs, normalizedQuery]
  );

  const hasQuery = normalizedQuery.length > 0;

  return (
    <div className={styles.workspaceSearch}>
      <div className={styles.workspaceSearchHeader}>
        <div>
          <h2 className={styles.workspaceSearchTitle}>搜索</h2>
          <p className={styles.workspaceSearchDesc}>在项目、对话、结果和当前工作记录里快速跳转。</p>
        </div>
        <div className={styles.workspaceSearchActions}>
          <button className={styles.workspaceSearchAction} onClick={onOpenPlugins}>
            <Icon name="puzzle" size={14} />
            <span>插件</span>
          </button>
        </div>
      </div>

      <div className={styles.workspaceSearchBar}>
        <Icon name="search" size={16} />
        <input
          className={styles.workspaceSearchInput}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索项目、对话、结果、任务…"
          autoFocus
        />
      </div>

      <div className={styles.workspaceSearchBody}>
        {!hasQuery && (
          <div className={styles.workspaceSearchHint}>
            <div className={styles.workspaceSearchHintCard}>
              <span>项目</span>
              <strong>{projects.length}</strong>
            </div>
            <div className={styles.workspaceSearchHintCard}>
              <span>对话</span>
              <strong>{uniqueConversations.length}</strong>
            </div>
            <div className={styles.workspaceSearchHintCard}>
              <span>任务</span>
              <strong>{jobs.length}</strong>
            </div>
            <div className={styles.workspaceSearchHintCard}>
              <span>分析项</span>
              <strong>{staticTools.length}</strong>
            </div>
          </div>
        )}

        <SearchResultSection title="项目" count={projectMatches.length}>
          {projectMatches.slice(0, 8).map((item) => (
            <button key={item.id} className={styles.searchResultItem} onClick={() => onOpenProject(item.id)}>
              <Icon name="folder" size={14} />
              <div className={styles.searchResultMeta}>
                <span className={styles.searchResultTitle}>{item.name}</span>
                <span className={styles.searchResultSub}>
                  {item.id === currentProjectId ? '当前项目' : item.modality || item.description || '项目'}
                </span>
              </div>
            </button>
          ))}
        </SearchResultSection>

        <SearchResultSection title="对话" count={conversationMatches.length}>
          {conversationMatches.slice(0, 8).map((item) => (
            <button
              key={item.id}
              className={styles.searchResultItem}
              onClick={() => onOpenConversation(item.project_id, item.id)}
            >
              <Icon name="message-circle" size={14} />
              <div className={styles.searchResultMeta}>
                <span className={styles.searchResultTitle}>{item.title}</span>
                <span className={styles.searchResultSub}>
                  {item.project_id === currentProjectId ? '当前项目' : item.project_id || '未绑定项目'}
                </span>
              </div>
            </button>
          ))}
        </SearchResultSection>

        <SearchResultSection title="任务与结果" count={jobMatches.length}>
          {jobMatches.slice(0, 6).map((item) => (
            <button key={item.id} className={styles.searchResultItem} onClick={() => onOpenScheduled(item.id)}>
              <Icon name="clock" size={14} />
              <div className={styles.searchResultMeta}>
                <span className={styles.searchResultTitle}>{item.name || item.tool_id}</span>
                <span className={styles.searchResultSub}>{item.status}</span>
              </div>
            </button>
          ))}
        </SearchResultSection>

        <SearchResultSection title="数据集" count={datasetMatches.length}>
          {datasetMatches.slice(0, 6).map((item) => (
            <div key={item.id} className={styles.searchResultStatic}>
              <Icon name="database" size={14} />
              <div className={styles.searchResultMeta}>
                <span className={styles.searchResultTitle}>{item.name}</span>
                <span className={styles.searchResultSub}>{formatSize(item.size)}</span>
              </div>
            </div>
          ))}
        </SearchResultSection>
      </div>
    </div>
  );
}

function SearchResultSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}): React.ReactElement | null {
  if (count === 0) return null;
  return (
    <section className={styles.searchResultSection}>
      <div className={styles.searchResultHeader}>
        <h3>{title}</h3>
        <span>{count}</span>
      </div>
      <div className={styles.searchResultList}>{children}</div>
    </section>
  );
}

// ============================================================
// ScheduledWorkspacePanel — center column shell for scheduled mode
// ============================================================

export function ScheduledWorkspacePanel({
  onBackToChat,
}: {
  onBackToChat: () => void;
}): React.ReactElement {
  return (
    <div className={styles.scheduledWorkspace}>
      <div className={styles.scheduledWorkspaceHeader}>
        <button className={styles.scheduledWorkspaceBack} onClick={onBackToChat}>
          <Icon name="message-circle" size={14} />
          <span>返回对话</span>
        </button>
      </div>
      <div className={styles.scheduledWorkspaceBody} />
    </div>
  );
}

// ============================================================
// HistoryPanel — right column (Phase7)
// ============================================================

function HistoryPanel({
  jobs,
  activeJobId,
  onSelectJob,
}: {
  jobs: ToolJob[];
  activeJobId: string | null;
  onSelectJob: (id: string) => void;
}): React.ReactElement {
  return (
    <div className={styles.panelInner}>
      <div className={styles.panelSection}>
        <h3 className={styles.panelHeading}>
          <Icon name="clock" size={14} /> 分析历史
        </h3>
        {jobs.length === 0 ? (
          <p className={styles.panelEmpty}>还没有分析记录</p>
        ) : (
          <ul className={styles.timeline}>
            {jobs.map((job) => (
              <li
                key={job.id}
                className={`${styles.timelineItem} ${
                  activeJobId === job.id ? styles.timelineItemActive : ''
                }`}
                onClick={() => onSelectJob(job.id)}
              >
                <div className={styles.timelineDot} data-status={job.status} />
                <div className={styles.timelineContent}>
                  <span className={styles.timelineTitle}>
                    {job.name || job.tool_id}
                  </span>
                  <span className={styles.timelineTime}>
                    {formatDate(job.created_at)}
                  </span>
                  <span className={styles.timelineStatus} data-status={job.status}>
                    {job.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ToolboxPanel — right column (Phase7: tool catalog + 7.3 plugin list)
// ============================================================

// Plan 1.6 §4.6 — InstalledPlugin / RemotePlugin shapes are now
// exported from `@/hooks/usePluginStore`. The local
// `InstalledPluginInfo` / `RemotePluginInfo` aliases were
// previously used inline; the hook now owns the canonical type
// and the panel reads through it.

const PLUGIN_TYPE_LABELS: Record<string, string> = {
  runtime: '运行时',
  tool: '工具',
};

function ToolboxPanel({
  onAskAgent,
}: {
  onAskAgent: (prompt: string) => void;
}): React.ReactElement {
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<string>('全部');
  const [tab, setTab] = useState<'tools' | 'plugins'>('tools');

  // --- Plugin state — Plan 1.6 §4.6 [HIGH] dedup ---
  // Shares the same SWR catalog as PluginStorePanel. `autoLoad: false`
  // because the toolbox only wants the catalog when its plugins tab
  // is opened (no point burning the bridge on every workspace mount).
  // We dispatch refresh() ourselves when the tab activates.
  const {
    installed,
    remote,
    install: hookInstall,
    uninstall: hookUninstall,
    refresh: refreshPluginCatalog,
  } = usePluginStore({ autoLoad: false });
  const [installing, setInstalling] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [pluginError, setPluginError] = useState<string | null>(null);

  // Group tools by category
  const categories = useMemo(() => {
    const cats = new Set<string>();
    staticTools.forEach((t) => cats.add(t.category));
    return ['全部', ...Array.from(cats).sort()];
  }, []);

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staticTools.filter((t) => {
      if (activeCat !== '全部' && t.category !== activeCat) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.subtitle.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
      );
    });
  }, [query, activeCat]);

  // --- Load plugins when tab is first activated ---
  useEffect(() => {
    if (tab !== 'plugins') return;
    // The shared cache may already have data from the sidebar
    // PluginStorePanel; refresh() will short-circuit the IPC
    // roundtrip via the cache hit (or fetch fresh if the user
    // hasn't visited the store yet).
    refreshPluginCatalog();
  }, [tab, refreshPluginCatalog]);

  async function handleInstall(pluginId: string) {
    setInstalling(pluginId);
    setPluginError(null);
    try {
      const result = await hookInstall(pluginId);
      if (!result.ok) {
        setPluginError(result.error || '安装失败');
      }
    } catch (e) {
      setPluginError(e instanceof Error ? e.message : '安装失败');
    } finally {
      setInstalling(null);
    }
  }

  async function handleUninstall(pluginId: string) {
    if (!confirm(`确定卸载插件「${pluginId}」？`)) return;
    setUninstalling(pluginId);
    setPluginError(null);
    try {
      const result = await hookUninstall(pluginId);
      if (!result.ok) {
        setPluginError(result.error || '卸载失败');
      }
    } catch (e) {
      setPluginError(e instanceof Error ? e.message : '卸载失败');
    } finally {
      setUninstalling(null);
    }
  }

  const remotePlugins = remote.plugins || {};

  const installedIds = useMemo(() => new Set(installed.map((p) => p.id)), [installed]);

  const availablePlugins = useMemo(() => {
    return Object.entries(remotePlugins)
      .filter(([id]) => !installedIds.has(id))
      .sort((a, b) => {
        const ta = a[1].title ?? a[0];
        const tb = b[1].title ?? b[0];
        return ta.localeCompare(tb);
      });
  }, [remotePlugins, installedIds]);

  return (
    <div className={styles.panelInner}>
      <div className={styles.panelSection}>
        <h3 className={styles.panelHeading}>
          <Icon name="wrench" size={14} /> 工具箱
        </h3>

        {/* Tab switcher */}
        <div className={styles.toolboxTabs}>
          <button
            className={`${styles.toolboxTab} ${tab === 'tools' ? styles.toolboxTabActive : ''}`}
            onClick={() => setTab('tools')}
          >
            工具
          </button>
          <button
            className={`${styles.toolboxTab} ${tab === 'plugins' ? styles.toolboxTabActive : ''}`}
            onClick={() => setTab('plugins')}
          >
            插件
            {installed.length > 0 && (
              <span className={styles.toolboxTabBadge}>{installed.length}</span>
            )}
          </button>
        </div>

        {tab === 'tools' ? (
          <>
            {/* Search box */}
            <input
              className={styles.toolSearch}
              type="text"
              placeholder="搜索工具…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            {/* Category chips */}
            <div className={styles.toolCats}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={`${styles.toolCat} ${
                    activeCat === cat ? styles.toolCatActive : ''
                  }`}
                  onClick={() => setActiveCat(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Tool list */}
            <ul className={styles.toolList}>
              {filteredTools.map((tool) => (
                <li
                  key={tool.id}
                  className={styles.toolItem}
                  onClick={() =>
                    onAskAgent(
                      `请帮我使用工具「${tool.title}」(${tool.id}) 进行分析。`
                    )
                  }
                  title={tool.description}
                >
                  <span
                    className={styles.toolDot}
                    style={{ background: tool.color }}
                  />
                  <div className={styles.toolMeta}>
                    <span className={styles.toolName}>{tool.title}</span>
                    <span className={styles.toolSub}>{tool.subtitle}</span>
                  </div>
                  {tool.comingSoon && (
                    <span className={styles.toolBadge}>即将上线</span>
                  )}
                </li>
              ))}
              {filteredTools.length === 0 && (
                <p className={styles.panelEmpty}>没有匹配的工具</p>
              )}
            </ul>
          </>
        ) : (
          <>
            {pluginError && (
              <p className={styles.pluginError}>{pluginError}</p>
            )}

            {/* Installed plugins */}
            <div className={styles.pluginSection}>
              <h4 className={styles.pluginSectionTitle}>
                已安装 ({installed.length})
              </h4>
              {installed.length === 0 ? (
                <p className={styles.panelEmpty}>暂无已安装插件</p>
              ) : (
                <ul className={styles.toolList}>
                  {installed.map((p) => {
                    const info = remotePlugins[p.id];
                    const label = PLUGIN_TYPE_LABELS[p.type ?? ''] ?? p.type ?? '插件';
                    return (
                      <li key={p.id} className={styles.pluginItem}>
                        <div className={styles.pluginMeta}>
                          <span className={styles.pluginName}>
                            {info?.title ?? p.id}
                          </span>
                          <span className={styles.pluginSub}>
                            v{p.version} · {label}
                            {p.language ? ` · ${p.language}` : ''}
                          </span>
                        </div>
                        <button
                          className={styles.pluginBtnUninstall}
                          disabled={uninstalling === p.id}
                          onClick={() => handleUninstall(p.id)}
                        >
                          {uninstalling === p.id ? '…' : '卸载'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Available (remote) plugins */}
            <div className={styles.pluginSection}>
              <h4 className={styles.pluginSectionTitle}>
                可用 ({availablePlugins.length})
              </h4>
              {availablePlugins.length === 0 ? (
                <p className={styles.panelEmpty}>所有插件均已安装</p>
              ) : (
                <ul className={styles.toolList}>
                  {availablePlugins.map(([id, info]) => {
                    const label = PLUGIN_TYPE_LABELS[info.type ?? ''] ?? info.type ?? '插件';
                    return (
                      <li key={id} className={styles.pluginItem}>
                        <div className={styles.pluginMeta}>
                          <span className={styles.pluginName}>
                            {info.title ?? id}
                          </span>
                          <span className={styles.pluginSub}>
                            {info.version ? `v${info.version} · ` : ''}{label}
                            {info.language ? ` · ${info.language}` : ''}
                          </span>
                        </div>
                        <button
                          className={styles.pluginBtnInstall}
                          disabled={installing === id}
                          onClick={() => handleInstall(id)}
                        >
                          {installing === id ? '…' : '安装'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ResultView — center column result display (Phase5: actual results)
// ============================================================

interface JobResultFile {
  name: string;
  type: string;
  label?: string;
  title?: string;
  filename?: string;
  url?: string;
  preview?: boolean;
  download?: boolean;
}

interface DeliveryManifestSummary {
  status: 'valid' | 'degraded' | 'blocked';
  manifestHash?: string;
  artifacts?: Array<{ reproducibility?: { status?: 'available' | 'verified' | 'unavailable' } }>;
  summary?: {
    conclusion?: string;
    whatWasDone?: string;
    cautions?: string[];
  };
}

interface JobResult {
  artifacts?: JobResultFile[];
  files?: JobResultFile[];
  tool?: {
    id?: string;
    version?: string | null;
    language?: string | null;
  };
  outputs?: unknown;
  manifest?: unknown;
  stdout?: string;
  summary?: unknown;
  deliveryManifest?: DeliveryManifestSummary;
}

interface JobDetailMeta {
  params?: Record<string, unknown>;
  ackStatus?: string | null;
  projectId?: string | null;
}

function artifactName(file: JobResultFile): string {
  return file.name || file.filename || '';
}

function artifactKindIcon(kind: ResultArtifactKind): IconName {
  if (kind === 'report') return 'book';
  if (kind === 'plot') return 'svg';
  if (kind === 'table') return 'bar-chart';
  if (kind === 'text') return 'file';
  if (kind === 'data') return 'database';
  return 'file';
}

function artifactPreviewLabel(artifact: ResultArtifactRecord): string {
  const kind = classifyArtifact(artifact);
  if (artifact.preview === false) return '文件';
  if (kind === 'report') return 'HTML';
  if (kind === 'plot') return '图像';
  if (kind === 'table') return '表格';
  if (kind === 'text') return '文本';
  if (kind === 'data') return '数据';
  return '文件';
}

function compactArtifactKindSummary(artifacts: ResultArtifactRecord[]): string {
  const counts = countArtifactsByKind(artifacts);
  return (Object.keys(counts) as ResultArtifactKind[])
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${artifactKindLabel(kind)} ${counts[kind]}`)
    .join(' · ');
}

function workflowStageLabel(stage: string): string {
  return {
    inspect: '检查输入',
    infer: '识别结构',
    select: '选择工具',
    repair: '修复参数',
    confirm: '等待确认',
    run: '运行分析',
    verify: '校验产物',
    report: '生成报告',
  }[stage] || stage;
}

function buildPreviewTable(text: string, fileName: string): string[][] {
  const sep = fileName.toLowerCase().endsWith('.tsv') || text.includes('\t') ? '\t' : ',';
  return text
    .split('\n')
    .filter((line) => line.trim())
    .slice(0, 40)
    .map((line) => line.split(sep).map((cell) => cell.replace(/^"|"$/g, '').trim()));
}

function ResultArtifactShell({
  project,
  job,
  workflow,
  activeArtifact,
  onActiveArtifactChange,
  onAskAgent,
  onWorkflowChanged,
  variant,
  showHarnessIndex = false,
  pendingArtifactName = null,
  onPendingArtifactConsumed,
  onOpenBrowser,
}: {
  project: Project;
  job: ToolJob | null;
  workflow: HarnessWorkflowJobState | null;
  activeArtifact: ActiveArtifact | null;
  onActiveArtifactChange: (artifact: ActiveArtifact | null) => void;
  onAskAgent: (prompt: string) => void;
  onWorkflowChanged?: () => void;
  variant: 'center' | 'sidebar';
  showHarnessIndex?: boolean;
  /**
   * Optional artifact name the host wants pre-selected once the manifest
   * (or fallback artifacts) becomes available. Populated by the chat
   * `projectOpenArtifact` event after a cross-project jump.
   */
  pendingArtifactName?: string | null;
  /** Fires after the pending artifact has been applied (or dismissed). */
  onPendingArtifactConsumed?: () => void;
  /** Opens a generated delivery report in the right-side Electron webview. */
  onOpenBrowser?: (url: string) => void;
}): React.ReactElement {
  const { resolvedTheme } = useTheme();
  const isSidebar = variant === 'sidebar';
  const [result, setResult] = useState<JobResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [jobMeta, setJobMeta] = useState<JobDetailMeta | null>(null);
  const [manifestRaw, setManifestRaw] = useState<unknown>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState('');
  const [unavailableArtifactNames, setUnavailableArtifactNames] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedName, setSelectedName] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<string[][] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // RS3：交互清单由后端基于完整文件判定（稳定 ID 列、可选维度），前端只消费。
  const [interactionManifest, setInteractionManifest] = useState<ArtifactInteractionManifest | null>(null);
  const [artifactSelection, setArtifactSelection] = useState<ArtifactSelection | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [harnessIndex, setHarnessIndex] = useState<HarnessIndexSummary | null>(null);
  const [harnessLoading, setHarnessLoading] = useState(false);
  const [harnessError, setHarnessError] = useState('');
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState<{
    actionId: string;
    label: string;
    token: string;
  } | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [reportGenerating, setReportGenerating] = useState(false);
  const [finalReportUrl, setFinalReportUrl] = useState('');
  const [finalReportGeneratedAt, setFinalReportGeneratedAt] = useState('');
  const [reportGenerationError, setReportGenerationError] = useState('');
  const [replayPackageBusy, setReplayPackageBusy] = useState(false);
  const [replayPackageMessage, setReplayPackageMessage] = useState('');

  const tool = useMemo(
    () => (job ? staticTools.find((t) => t.id === job.tool_id) || null : null),
    [job]
  );
  const lang: 'r' | 'python' = tool?.language === 'python' ? 'python' : 'r';
  const effectiveJobStatus: ToolJob['status'] = workflow?.jobStatus === 'completed'
    ? 'done'
    : workflow?.jobStatus === 'failed' || workflow?.jobStatus === 'cancelled'
      ? 'failed'
      : workflow?.jobStatus === 'running'
        ? 'running'
        : workflow?.jobStatus === 'pending' || workflow?.jobStatus === 'queued'
          ? 'pending'
          : job?.status || 'pending';

  const buildUrl = useCallback(
    (name: string) => {
      if (!job) return '';
      const base = getApiPrefix(lang);
      const token = getToken();
      const tokenQs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `${base}/tools/file/${job.id}/${encodeURIComponent(name)}${tokenQs}`;
    },
    [job, lang]
  );
  const scientificScriptUrl = useMemo(() => {
    if (!job || !result?.deliveryManifest) return '';
    const token = getToken();
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${getApiPrefix(lang)}/harness/scientific-task-by-job/${encodeURIComponent(job.id)}/script${query}`;
  }, [job, lang, result?.deliveryManifest]);

  useEffect(() => {
    if (!job) {
      setResult(null);
      setJobMeta(null);
      setManifestRaw(null);
      setManifestLoading(false);
      setManifestError('');
      setSelectedName('');
      setSelectedSectionId('');
      setPreviewText(null);
      setPreviewData(null);
      setPreviewLoading(false);
      setHarnessIndex(null);
      setHarnessLoading(false);
      setHarnessError('');
      return;
    }

    if (effectiveJobStatus === 'done') {
      setLoading(true);
      setResult(null);
      setJobMeta(null);
      setSelectedName('');
      setSelectedSectionId('');
      (async () => {
        try {
          const token = getToken();
          const resp = await fetch(getApiPrefix(lang) + '/tools/status/' + job.id, {
            headers: token ? { Authorization: 'Bearer ' + token } : {},
          });
          const data = await resp.json();
          if (data.ok && data.result) {
            setResult(data.result);
            setJobMeta({
              params: data.params || {},
              ackStatus: data.ackStatus || null,
              projectId: data.projectId || null,
            });
          }
        } catch {
          // keep shell quiet
        } finally {
          setLoading(false);
        }
      })();
    } else {
      setResult(null);
      setJobMeta(null);
      setLoading(false);
      setManifestRaw(null);
      setManifestLoading(false);
      setManifestError('');
      setSelectedName('');
      setSelectedSectionId('');
      setPreviewText(null);
      setPreviewData(null);
      setPreviewLoading(false);
    }
  }, [effectiveJobStatus, job, lang]);

  useEffect(() => {
    if (!job || effectiveJobStatus !== 'done' || !showHarnessIndex) {
      setHarnessIndex(null);
      setHarnessError('');
      setHarnessLoading(false);
      return;
    }
    let cancelled = false;
    setHarnessLoading(true);
    setHarnessError('');
    fetchHarnessIndex({ scope: 'artifact', jobId: job.id, maxFiles: 120 })
      .then((data) => {
        if (!cancelled) setHarnessIndex(data.index || null);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setHarnessIndex(null);
          setHarnessError(error.message || '识别失败');
        }
      })
      .finally(() => {
        if (!cancelled) setHarnessLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveJobStatus, job?.id, showHarnessIndex]);

  const files = result?.artifacts || result?.files || [];
  const fallbackArtifacts = useMemo<ResultArtifactRecord[]>(
    () =>
      files.map((file) => ({
        name: artifactName(file),
        type: file.type,
        label: file.label || file.title,
        title: file.title,
        url: buildUrl(artifactName(file)),
        preview: file.preview,
        download: file.download,
      })),
    [buildUrl, files]
  );

  useEffect(() => {
    if (!job || effectiveJobStatus !== 'done') {
      setManifestRaw(null);
      setManifestLoading(false);
      setManifestError('');
      return;
    }
    if (result?.manifest && typeof result.manifest === 'object') {
      setManifestRaw(result.manifest);
      setManifestLoading(false);
      setManifestError('');
      return;
    }
    let cancelled = false;
    setManifestLoading(true);
    setManifestError('');
    fetch(buildUrl('manifest.json'))
      .then((resp) => {
        if (!resp.ok) throw new Error('manifest missing');
        return resp.json();
      })
      .then((json) => {
        if (!cancelled) setManifestRaw(json);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setManifestRaw(null);
        setManifestError(error.message === 'manifest missing' ? '' : (error.message || 'manifest 解析失败'));
      })
      .finally(() => {
        if (!cancelled) setManifestLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [buildUrl, effectiveJobStatus, job?.id, result?.manifest]);

  const manifest = useMemo(
    () => normalizeResultManifest(manifestRaw, fallbackArtifacts),
    [fallbackArtifacts, manifestRaw]
  );
  const manifestArtifacts = manifest?.artifacts?.length ? manifest.artifacts : fallbackArtifacts;
  const artifacts = useMemo(
    () => manifestArtifacts.filter((artifact) => !unavailableArtifactNames.has(artifact.name)),
    [manifestArtifacts, unavailableArtifactNames]
  );
  const coreArtifacts = useMemo(
    () => artifacts.filter((artifact) => classifyArtifact(artifact) !== 'report'),
    [artifacts]
  );
  const navSections = useMemo(
    () => buildResultArtifactNavigation(manifest, coreArtifacts),
    [coreArtifacts, manifest]
  );
  const artifactSummary = useMemo(() => compactArtifactKindSummary(coreArtifacts), [coreArtifacts]);
  const reportArtifact = useMemo(
    () =>
      artifacts.find((artifact) => classifyArtifact(artifact) === 'report') ||
      artifacts.find((artifact) => /\.(html?|xhtml)$/i.test(artifact.name)) ||
      null,
    [artifacts]
  );
  const materializedReportArtifact = useMemo(
    () => artifacts.find((artifact) => /(^|\/)final-report\.html$/i.test(artifact.name)) || null,
    [artifacts]
  );
  const preferredArtifactName =
    activeArtifact && activeArtifact.jobId === job?.id ? activeArtifact.name : '';
  const selectedArtifact = useMemo(() => {
    const current = findArtifactByName(artifacts, selectedName);
    if (current) return current;
    // The pending artifact (from chat click / cross-project navigation)
    // wins over the active-artifact hint when both are present.
    const pending = pendingArtifactName ? findArtifactByName(artifacts, pendingArtifactName) : null;
    if (pending) return pending;
    return (
      pickPreferredArtifact(coreArtifacts, preferredArtifactName) ||
      coreArtifacts[0] ||
      null
    );
  }, [artifacts, coreArtifacts, pendingArtifactName, preferredArtifactName, selectedName]);
  const selectedArtifactName = selectedArtifact?.name || '';
  const selectedArtifactUrl = selectedArtifact
    ? selectedArtifact.url || buildUrl(selectedArtifact.name)
    : '';
  const selectedArtifactKind = selectedArtifact ? classifyArtifact(selectedArtifact) : 'file';
  const selectedArtifactLabel = selectedArtifact
    ? selectedArtifact.label || selectedArtifact.title || selectedArtifact.name
    : '';
  const activeFile = useMemo(() => {
    if (!selectedArtifactName) return null;
    return files.find((file) => artifactName(file) === selectedArtifactName) || null;
  }, [files, selectedArtifactName]);
  const activeIsHtml = selectedArtifactKind === 'report' || /\.html?$/i.test(selectedArtifactName);
  const activeIsText =
    !activeIsHtml &&
    (selectedArtifactKind === 'text' || isTextFile(selectedArtifactName) || isMarkdownFile(selectedArtifactName) || /\.json$/i.test(selectedArtifactName) || /\.(csv|tsv)$/i.test(selectedArtifactName));
  const activeIsImage = selectedArtifactKind === 'plot' || (selectedArtifactName ? isImageFile(selectedArtifactName) : false);
  const activeIsPreviewText = activeIsText && !activeIsHtml;

  useEffect(() => {
    setUnavailableArtifactNames(new Set());
    setPendingRecovery(null);
    setRecoveryError('');
    setFinalReportUrl('');
    setFinalReportGeneratedAt('');
    setReportGenerationError('');
  }, [job?.id]);

  useEffect(() => {
    if (!materializedReportArtifact) return;
    setFinalReportUrl(materializedReportArtifact.url || buildUrl(materializedReportArtifact.name));
  }, [buildUrl, materializedReportArtifact]);

  useEffect(() => {
    if (!activeIsHtml || !selectedArtifactName || !selectedArtifactUrl) return;
    let cancelled = false;
    fetch(selectedArtifactUrl)
      .then((response) => {
        if (cancelled || response.ok) return;
        setUnavailableArtifactNames((current) => {
          if (current.has(selectedArtifactName)) return current;
          const next = new Set(current);
          next.add(selectedArtifactName);
          return next;
        });
      })
      .catch(() => {
        // A transient network failure must not permanently hide a valid report.
      });
    return () => {
      cancelled = true;
    };
  }, [activeIsHtml, selectedArtifactName, selectedArtifactUrl]);

  const activeSection = useMemo(() => {
    if (!navSections.length) return null;
    return (
      (selectedName
        ? navSections.find((section) => section.artifactNames.includes(selectedName))
        : null) ||
      navSections.find((section) => section.id === selectedSectionId) ||
      navSections[0]
    );
  }, [navSections, selectedName, selectedSectionId]);

  useEffect(() => {
    if (!selectedArtifactName || navSections.length === 0) return;
    const nextSection = navSections.find((section) => section.artifactNames.includes(selectedArtifactName));
    if (!nextSection) return;
    setSelectedSectionId((current) => (current === nextSection.id ? current : nextSection.id));
  }, [navSections, selectedArtifactName]);

  useEffect(() => {
    if (!job || effectiveJobStatus !== 'done' || coreArtifacts.length === 0) return;
    const preferred = pickPreferredArtifact(coreArtifacts, preferredArtifactName) || coreArtifacts[0];
    const preferredName = preferred ? preferred.name : '';
    setSelectedName((current) => {
      // Pending artifact name (from chat click) wins over the user's prior
      // selection — the chat is the trigger that brought us here.
      if (pendingArtifactName && artifacts.some((artifact) => artifact.name === pendingArtifactName)) {
        return pendingArtifactName;
      }
      if (current && coreArtifacts.some((artifact) => artifact.name === current)) return current;
      return preferredName;
    });
    setSelectedSectionId((current) => {
      if (current && navSections.some((section) => section.id === current)) return current;
      const focusName =
        (pendingArtifactName && artifacts.some((artifact) => artifact.name === pendingArtifactName)
          ? pendingArtifactName
          : preferredName);
      const nextSection =
        (focusName && navSections.find((item) => item.artifactNames.includes(focusName))) ||
        navSections[0];
      return nextSection?.id || '';
    });
  }, [artifacts, coreArtifacts, effectiveJobStatus, job, navSections, pendingArtifactName, preferredArtifactName]);

  // Clear the pending artifact after it's been applied so a subsequent
  // unrelated render doesn't keep forcing it.
  useEffect(() => {
    if (!pendingArtifactName) return;
    if (artifacts.length === 0) return;
    const matches = artifacts.some((artifact) => artifact.name === pendingArtifactName);
    if (matches) {
      onPendingArtifactConsumed?.();
    }
  }, [artifacts, onPendingArtifactConsumed, pendingArtifactName]);

  // RS3：交互清单只能由后端基于**完整文件**产出。浏览器侧只有 buildPreviewTable
  // 解析出的前 40 行样本，用它判定"哪一列是稳定实体 ID"会在 10 万行表上出错。
  // artifact 一变就重取，并清空上一份选择——旧选择属于旧 artifact，不能顺延。
  useEffect(() => {
    setInteractionManifest(null);
    setArtifactSelection(null);
    if (!job || effectiveJobStatus !== 'done' || !selectedArtifactName) return;
    if (selectedArtifactKind !== 'table' && selectedArtifactKind !== 'plot') return;
    let cancelled = false;
    (async () => {
      try {
        const token = getToken();
        const query = `?jobId=${encodeURIComponent(job.id)}&artifact=${encodeURIComponent(selectedArtifactName)}`;
        const resp = await fetch(`${getApiPrefix(lang)}/result-studio/interaction${query}`, {
          headers: token ? { Authorization: 'Bearer ' + token } : {},
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (cancelled) return;
        if (data && data.manifest) setInteractionManifest(data.manifest as ArtifactInteractionManifest);
      } catch {
        // 清单拿不到不应连带影响结果展示：保持 null，交互能力按"不支持"处理。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveJobStatus, job, lang, selectedArtifactKind, selectedArtifactName]);

  useEffect(() => {
    if (!job || effectiveJobStatus !== 'done' || !selectedArtifact) {
      onActiveArtifactChange(null);
      return;
    }
    const artifact: ActiveArtifact = {
      jobId: job.id,
      toolId: job.tool_id,
      name: selectedArtifact.name,
      type: selectedArtifact.type || selectedArtifactKind,
      label: selectedArtifact.label || selectedArtifact.title,
      url: selectedArtifactUrl,
      // RS3 semantic 维度：来自后端基于完整文件产出的交互清单。
      // 清单还没到（或该类型不支持交互）时保持 null，不猜测。
      semanticKind: selectedArtifactKind,
      revisionId: interactionManifest?.revisionId ?? null,
      entityType: interactionManifest?.entityType ?? null,
      idField: interactionManifest?.idField ?? null,
      selectionDurable: interactionManifest?.selectionDurable ?? false,
      interactionCapabilities: interactionManifest?.capabilities ?? [],
      selection: artifactSelection,
    };
    // 身份比较必须覆盖 revision 与 selection：只比 jobId+name 会让
    // "同一文件换了版本" 或 "用户改了选择" 无法向上传播。
    if (
      !activeArtifact ||
      activeArtifact.jobId !== artifact.jobId ||
      activeArtifact.name !== artifact.name ||
      (activeArtifact.revisionId ?? null) !== (artifact.revisionId ?? null) ||
      (activeArtifact.entityType ?? null) !== (artifact.entityType ?? null) ||
      (activeArtifact.idField ?? null) !== (artifact.idField ?? null) ||
      !isSameSelection(activeArtifact.selection ?? null, artifact.selection ?? null)
    ) {
      onActiveArtifactChange(artifact);
    }
  }, [
    activeArtifact,
    artifactSelection,
    effectiveJobStatus,
    interactionManifest,
    job,
    onActiveArtifactChange,
    selectedArtifact,
    selectedArtifactKind,
    selectedArtifactUrl,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!activeFile || !activeIsPreviewText) {
      setPreviewText(null);
      setPreviewData(null);
      setPreviewLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setPreviewLoading(true);
    const url = selectedArtifactUrl || activeFile.url || '';
    fetch(url)
      .then((resp) => {
        if (!resp.ok) throw new Error('preview failed');
        return resp.text();
      })
      .then((text) => {
        if (cancelled) return;
        if (/\.(csv|tsv)$/i.test(selectedArtifactName)) {
          setPreviewData(buildPreviewTable(text, selectedArtifactName));
          setPreviewText(null);
          return;
        }
        if (selectedArtifactName.toLowerCase().endsWith('.json')) {
          try {
            setPreviewText(JSON.stringify(JSON.parse(text), null, 2));
          } catch {
            setPreviewText(formatPreviewText(selectedArtifactName, text).slice(0, 12000));
          }
        } else {
          setPreviewText(formatPreviewText(selectedArtifactName, text).slice(0, 12000));
        }
        setPreviewData(null);
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewText('无法读取预览内容');
          setPreviewData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeFile, activeIsPreviewText, selectedArtifactName, selectedArtifactUrl]);

  const renderPreview = () => {
    if (!selectedArtifact) {
      return <div className={styles.resultPreviewPlaceholder}>未发现可预览的结果文件</div>;
    }
    if (selectedArtifactKind === 'report' && selectedArtifactUrl) {
      return <div className={styles.resultPreviewPlaceholder}>报告属于后置交付物，请从上方报告卡生成最终 HTML。</div>;
    }
    if (activeIsImage && selectedArtifactUrl) {
      return (
        <button
          type="button"
          className={styles.resultPreviewImageButton}
          onClick={() => setLightboxSrc(selectedArtifactUrl)}
        >
          <img
            src={selectedArtifactUrl}
            alt={selectedArtifactLabel || selectedArtifact.name}
            className={styles.resultPreviewImage}
          />
        </button>
      );
    }
    if (previewLoading && !previewText && !previewData) {
      return <div className={styles.resultPreviewPlaceholder}>加载预览中…</div>;
    }
    if (previewData && previewData.length > 0) {
      const [header, ...rows] = previewData;
      return (
        <div className={styles.csvPreviewBody}>
          <table>
            <thead>
              <tr>
                {header.map((cell, idx) => (
                  <td key={`${cell || 'col'}-${idx}`}>{cell || `列 ${idx + 1}`}</td>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 24).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {header.map((_, cellIndex) => (
                    <td key={cellIndex}>{row[cellIndex] || '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if (previewText) {
      return <pre className={styles.textPreview}>{previewText}</pre>;
    }
    return (
      <div className={styles.resultPreviewPlaceholder}>
        当前文件暂不支持内嵌预览。
      </div>
    );
  };

  if (!job) {
    return <EmptyAnalysisResult />;
  }

  const sectionTabs = navSections.length > 0 ? navSections : [];
  const showReportRail = sectionTabs.length > 0 && artifacts.length > 0;
  const activeSectionArtifacts = activeSection?.artifacts || [];
  const showArtifactRail = activeSectionArtifacts.length > 1;
  const resultNavWidth = navCollapsed ? 0 : (isSidebar ? 184 : 224);
  const recoveryAction = workflow?.nextActions?.[0] || null;
  const actionRunsDirectly = isDirectRecoveryAction(recoveryAction?.id);

  const requestRecovery = async () => {
    if (!job || !recoveryAction) return;
    if (!actionRunsDirectly) {
      onAskAgent(
        `请处理任务 ${job.id} 的 ${recoveryAction.label}。先说明原因和拟采取的操作，得到我确认后再执行。`,
      );
      return;
    }
    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      const response = await runHarnessWorkflowAction({
        jobId: job.id,
        actionId: recoveryAction.id,
      });
      if (!response.confirmationToken) throw new Error('未获得恢复确认凭证');
      setPendingRecovery({
        actionId: recoveryAction.id,
        label: recoveryAction.label,
        token: response.confirmationToken,
      });
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : '恢复请求失败');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const resolveRecovery = async (confirm: boolean) => {
    if (!job || !pendingRecovery) return;
    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      await runHarnessWorkflowAction({
        jobId: job.id,
        actionId: pendingRecovery.actionId,
        confirmationToken: pendingRecovery.token,
        confirm,
      });
      setPendingRecovery(null);
      if (confirm) onWorkflowChanged?.();
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : '恢复操作失败');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const generateFinalReport = async () => {
    if (!job) return;
    setReportGenerating(true);
    setReportGenerationError('');
    try {
      const token = getToken();
      const response = await fetch(`${getApiPrefix(lang)}/tools/report/${encodeURIComponent(job.id)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? {Authorization: `Bearer ${token}`} : {}),
        },
        body: JSON.stringify({ theme: resolvedTheme }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.fileName) throw new Error(data.message || data.error || '报告生成失败');
      setFinalReportUrl(buildUrl(data.fileName));
      setFinalReportGeneratedAt(data.generatedAt || new Date().toISOString());
    } catch (error) {
      setReportGenerationError(error instanceof Error ? error.message : '报告生成失败');
    } finally {
      setReportGenerating(false);
    }
  };

  const exportReplayPackage = async () => {
    if (!job) return;
    setReplayPackageBusy(true);
    setReplayPackageMessage('');
    try {
      const token = getToken();
      const response = await fetch(`${getApiPrefix(lang)}/harness/scientific-task-by-job/${encodeURIComponent(job.id)}/replay-package`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || '复现包导出失败');
      const completeness = data.replayPackageRef?.status === 'complete' ? '完整历史' : '历史部分可用';
      setReplayPackageMessage(`复现包已写入项目结果目录 · ${completeness}`);
    } catch (error) {
      setReplayPackageMessage(error instanceof Error ? error.message : '复现包导出失败');
    } finally {
      setReplayPackageBusy(false);
    }
  };

  const workflowBar = workflow ? (
    <div className={styles.resultWorkflowBar} data-state={workflow.resumeFrom || 'completed'}>
      <div className={styles.resultWorkflowBarMain}>
        <span className={styles.resultWorkflowDot} data-terminal={workflow.terminal} />
        <span>
          {workflow.resumeFrom
            ? `当前阶段：${workflowStageLabel(workflow.resumeFrom)}`
            : `结果已校验 · ${workflow.artifactCount} 项产物`}
        </span>
        {workflow.artifactTruth && (
          <small>truth {String(workflow.artifactTruth.status || 'unknown')}</small>
        )}
      </div>
      {recoveryAction && (
        <button
          type="button"
          disabled={recoveryBusy}
          onClick={() => void requestRecovery()}
        >
          {recoveryBusy ? '处理中…' : recoveryAction.label}
        </button>
      )}
    </div>
  ) : null;
  const recoveryConfirmation = pendingRecovery ? (
    <div className={styles.resultWorkflowConfirmation}>
      <span>确认执行“{pendingRecovery.label}”？该操作会写入任务审计记录。</span>
      <div>
        <button type="button" disabled={recoveryBusy} onClick={() => void resolveRecovery(false)}>
          取消
        </button>
        <button type="button" disabled={recoveryBusy} onClick={() => void resolveRecovery(true)}>
          确认执行
        </button>
      </div>
    </div>
  ) : recoveryError ? (
    <div className={styles.resultWorkflowError}>{recoveryError}</div>
  ) : null;

  const stateBlock = (title: string, body: React.ReactNode, status: 'running' | 'pending' | 'failed' | 'done') => {
    const containerClass = isSidebar ? styles.resultSidebarCard : styles.resultView;
    return (
      <div className={containerClass}>
        {workflowBar}
        {recoveryConfirmation}
        <div className={isSidebar ? styles.resultSidebarTitleRow : styles.resultHeader}>
          <strong>{title}</strong>
          <span className={styles.resultStatus} data-status={status}>
            {status === 'running' ? '运行中…' : status === 'pending' ? '排队中' : status === 'failed' ? '失败' : '完成'}
          </span>
        </div>
        {body}
      </div>
    );
  };

  if (effectiveJobStatus === 'running' || effectiveJobStatus === 'pending') {
    return stateBlock(
      job.name || job.tool_id,
      <div className={styles.resultRunning}>
        <div className={styles.spinner} />
        <p>分析正在执行，请稍候…</p>
      </div>,
      effectiveJobStatus
    );
  }

  if (effectiveJobStatus === 'failed') {
    return stateBlock(
      job.name || job.tool_id,
      <pre className={styles.resultError}>{job.error || '执行失败，无错误信息'}</pre>,
      'failed'
    );
  }

  if (loading) {
    return stateBlock(
      job.name || job.tool_id,
      <p className={styles.resultPlaceholder}>加载结果中…</p>,
      'done'
    );
  }

  if (!result) {
    return stateBlock(
      job.name || job.tool_id,
      <p className={styles.resultPlaceholder}>分析已完成，但未生成可视化结果文件。</p>,
      'done'
    );
  }

  const shellBody = (
    <>
      {workflowBar}
      {recoveryConfirmation}
      {result.deliveryManifest && (
        <section className={styles.resultScientificDelivery} data-status={result.deliveryManifest.status}>
          <div className={styles.resultScientificDeliveryHeader}>
            <strong>
              {result.deliveryManifest.status === 'valid'
                ? '交付已通过'
                : result.deliveryManifest.status === 'degraded'
                  ? '交付需要复核'
                  : '交付已阻断'}
            </strong>
            <span>{result.deliveryManifest.status}</span>
          </div>
          <div className={styles.resultScientificDeliveryGrid}>
            <div>
              <small>结论摘要</small>
              <p>{result.deliveryManifest.summary?.conclusion || '暂无结论摘要'}</p>
            </div>
            <div>
              <small>我做了什么</small>
              <p>{result.deliveryManifest.summary?.whatWasDone || '暂无执行摘要'}</p>
            </div>
            <div>
              <small>需要注意什么</small>
              <p>{result.deliveryManifest.summary?.cautions?.join('；') || '暂无额外注意事项'}</p>
            </div>
          </div>
          <div className={styles.resultScientificDeliveryMeta}>
            <span>
              复现：{result.deliveryManifest.artifacts?.filter((item) => item.reproducibility?.status === 'verified').length || 0} 已验证 ·{' '}
              {result.deliveryManifest.artifacts?.filter((item) => item.reproducibility?.status === 'available').length || 0} 可用
            </span>
            <div className={styles.resultScientificDeliveryActions}>
              <a href={buildUrl('delivery-manifest.json')} target="_blank" rel="noreferrer">查看交付清单</a>
              <button type="button" disabled={replayPackageBusy} onClick={() => void exportReplayPackage()}>
                {replayPackageBusy ? '导出中…' : '导出复现包'}
              </button>
            </div>
          </div>
          {replayPackageMessage && <div className={styles.resultReplayPackageMessage}>{replayPackageMessage}</div>}
        </section>
      )}
      <section className={styles.resultDeliveryCard}>
        <div className={styles.resultDeliveryCopy}>
          <strong>最终 HTML 报告</strong>
          <span>
            {finalReportUrl
              ? `已基于当前结果生成${finalReportGeneratedAt ? ` · ${new Date(finalReportGeneratedAt).toLocaleString()}` : ''}`
              : '分析结果确认后按需生成，不占用核心结果预览。'}
          </span>
          {reportGenerationError && <em>{reportGenerationError}</em>}
        </div>
        <div className={styles.resultDeliveryActions}>
          <button
            type="button"
            disabled={reportGenerating || !reportArtifact}
            onClick={() => void generateFinalReport()}
            title={finalReportUrl ? '重新生成最终 HTML 报告' : '生成最终 HTML 报告'}
          >
            {reportGenerating ? '生成中…' : '生成'}
          </button>
          {finalReportUrl && onOpenBrowser && (
            <button
              type="button"
              onClick={() => onOpenBrowser(finalReportUrl)}
              title="在右侧内置浏览器查看"
            >
              查看
            </button>
          )}
          {finalReportUrl && (
            <a href={finalReportUrl} download="final-report.html" title="导出最终 HTML 报告">
              导出
            </a>
          )}
        </div>
      </section>
      <section className={isSidebar ? styles.resultSidebarReportCard : styles.resultReportSection}>
        {showReportRail ? (
          <div
            className={styles.resultReportShell}
            style={{ ['--result-nav-width' as string]: `${resultNavWidth}px` }}
          >
            <button
              type="button"
              className={styles.resultReportNavToggle}
              onClick={() => setNavCollapsed((value) => !value)}
              title={navCollapsed ? '展开结果导航' : '收起结果导航'}
              aria-label={navCollapsed ? '展开结果导航' : '收起结果导航'}
              aria-pressed={!navCollapsed}
            >
              <Icon name={navCollapsed ? 'arrow-left' : 'arrow-right'} size={13} />
            </button>

            <div className={styles.resultReportMain}>
              {activeSection && showArtifactRail && (
                <div className={styles.resultReportArtifactNav}>
                  <div className={styles.resultReportArtifactNavHeader}>
                    <div className={styles.resultReportArtifactNavEyebrow}>二级导航</div>
                    <div className={styles.resultReportArtifactNavTitle}>{activeSection.label}</div>
                    <div className={styles.resultReportArtifactNavMeta}>
                      <span>{activeSectionArtifacts.length} 项</span>
                      {activeSection.description && <span>{activeSection.description}</span>}
                    </div>
                  </div>
                  <div className={styles.resultReportArtifactTabs}>
                    {activeSectionArtifacts.map((artifact) => {
                      const kind = classifyArtifact(artifact);
                      const active = artifact.name === selectedArtifactName;
                      return (
                        <button
                          key={artifact.name}
                          type="button"
                          className={`${styles.resultReportArtifactTab} ${active ? styles.resultReportArtifactTabActive : ''}`}
                          onClick={() => {
                            setSelectedName(artifact.name);
                            if (activeSection) setSelectedSectionId(activeSection.id);
                          }}
                          title={artifact.description || artifact.label || artifact.name}
                        >
                          <span className={styles.resultReportArtifactTabIcon}>
                            <Icon name={artifactKindIcon(kind)} size={13} />
                          </span>
                          <span className={styles.resultReportArtifactTabText}>
                            <span className={styles.resultReportArtifactTabName}>
                              {artifact.label || artifact.title || artifact.name}
                            </span>
                            <span className={styles.resultReportArtifactTabMeta}>
                              {artifactPreviewLabel(artifact)}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className={styles.resultSidebarPreviewBody}>
                {renderPreview()}
              </div>
            </div>

            {!navCollapsed && (
              <aside className={styles.resultReportNav}>
                <div className={styles.resultReportNavHeader}>
                  <div className={styles.resultReportEyebrow}>Honeycomb</div>
                  <div className={styles.resultReportTitle}>结果导航</div>
                  <div className={styles.resultReportNavMeta}>
                    <span>{sectionTabs.length} 组 · {artifacts.length} 项</span>
                    {artifactSummary && <span>{artifactSummary}</span>}
                  </div>
                </div>

                {sectionTabs.length > 0 && (
                  <div className={styles.resultReportNavSections}>
                    {sectionTabs.map((section) => {
                      const active = section.id === activeSection?.id;
                      const sectionKind = section.kind === 'mixed'
                        ? inferSectionDisplayKind(section.artifacts, section.label)
                        : section.kind;
                      return (
                        <section
                          key={section.id}
                          className={`${styles.resultReportNavSection} ${active ? styles.resultReportNavSectionActive : ''}`}
                        >
                          <button
                            type="button"
                            className={styles.resultReportSectionButton}
                            onClick={() => {
                              setSelectedSectionId(section.id);
                              const first = section.artifacts[0];
                              if (first) setSelectedName(first.name);
                            }}
                          >
                            <span className={styles.resultReportSectionTitle}>
                              {sectionKind && <Icon name={artifactKindIcon(sectionKind)} size={13} />}
                              <span>{section.label}</span>
                            </span>
                            <span className={styles.resultReportSectionCount}>{section.artifacts.length}</span>
                          </button>

                          {section.description && (
                            <div className={styles.resultReportSectionDesc}>{section.description}</div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}

                {selectedArtifact && (
                  <div className={styles.resultReportActiveCard}>
                    <div className={styles.resultReportActiveLabel}>当前预览</div>
                    <div className={styles.resultReportActiveName}>{selectedArtifactLabel}</div>
                    <div className={styles.resultReportActiveMeta}>
                      <span>{artifactKindLabel(selectedArtifactKind)}</span>
                      <span>{selectedArtifactName}</span>
                    </div>
                    {selectedArtifactUrl && (
                      <a className={styles.resultReportActiveLink} href={selectedArtifactUrl} target="_blank" rel="noreferrer">
                        打开原文件
                      </a>
                    )}
                    {result.deliveryManifest && (
                      <div className={styles.resultReportReproductionActions}>
                        {scientificScriptUrl && (
                          <a href={scientificScriptUrl} target="_blank" rel="noreferrer">查看脚本</a>
                        )}
                        <button
                          type="button"
                          onClick={() => onAskAgent(`请为任务 ${job.id} 的产物 ${selectedArtifactName} 发起重放验证；先展示输入、资源和副作用确认摘要，不要直接执行。`)}
                        >
                          重放验证
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </aside>
            )}
          </div>
        ) : (
          <div className={styles.resultSidebarPreviewBody}>
            {renderPreview()}
          </div>
        )}
      </section>
    </>
  );

  return isSidebar ? (
    <div className={styles.resultSidebarRoot}>
      {shellBody}
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  ) : (
    <div className={styles.resultView}>
      {shellBody}
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}

export function ResultView({
  project,
  job,
  workflow = null,
  activeArtifact,
  onActiveArtifactChange,
  onAskAgent,
  pendingArtifactName = null,
  onPendingArtifactConsumed,
}: {
  project: Project;
  job: ToolJob;
  workflow?: HarnessWorkflowJobState | null;
  activeArtifact: ActiveArtifact | null;
  onActiveArtifactChange: (artifact: ActiveArtifact | null) => void;
  onAskAgent: (prompt: string) => void;
  pendingArtifactName?: string | null;
  onPendingArtifactConsumed?: () => void;
}): React.ReactElement {
  return (
    <ResultArtifactShell
      project={project}
      job={job}
      workflow={workflow}
      activeArtifact={activeArtifact}
      onActiveArtifactChange={onActiveArtifactChange}
      onAskAgent={onAskAgent}
      pendingArtifactName={pendingArtifactName}
      onPendingArtifactConsumed={onPendingArtifactConsumed}
      variant="center"
    />
  );
}

export function ResultSidebarPanel({
  project,
  job,
  workflow,
  activeArtifact,
  onActiveArtifactChange,
  onAskAgent,
  onWorkflowChanged,
  pendingArtifactName = null,
  onPendingArtifactConsumed,
  onOpenBrowser,
}: {
  project: Project;
  job: ToolJob | null;
  workflow: HarnessWorkflowJobState | null;
  activeArtifact: ActiveArtifact | null;
  onActiveArtifactChange: (artifact: ActiveArtifact | null) => void;
  onAskAgent: (prompt: string) => void;
  onWorkflowChanged: () => void;
  pendingArtifactName?: string | null;
  onPendingArtifactConsumed?: () => void;
  onOpenBrowser?: (url: string) => void;
}): React.ReactElement {
  return (
    <ResultArtifactShell
      project={project}
      job={job}
      workflow={workflow}
      activeArtifact={activeArtifact}
      onActiveArtifactChange={onActiveArtifactChange}
      onAskAgent={onAskAgent}
      onWorkflowChanged={onWorkflowChanged}
      pendingArtifactName={pendingArtifactName}
      onPendingArtifactConsumed={onPendingArtifactConsumed}
      onOpenBrowser={onOpenBrowser}
      variant="sidebar"
      showHarnessIndex
    />
  );
}

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
          <button type="button" onClick={reload}>重新加载</button>
        </div>
      )}
    </div>
  );
}

export function EmptyAnalysisResult(): React.ReactElement {
  return (
    <div className={styles.emptyResult}>
      <div className={styles.emptyResultIcon}>
        <Icon name="bar-chart" size={34} />
      </div>
      <h2 className={styles.emptyResultTitle}>暂无分析结果</h2>
      <p className={styles.emptyResultDesc}>
        从会话中运行分析，或从历史记录打开一个任务后，结果会显示在这里。
      </p>
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

// ============================================================
// Utils
// ============================================================

function formatSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatDate(ts: string | number): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
