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
import { getProject, listProjectJobs, listDatasetsByProject, listProjects, updateProject, createProject } from '@/lib/project-store';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { tools as staticTools } from '@/pages/_data';
import type { Tool } from '@/pages/_data';
import { Lightbox } from '@/components/ui/Lightbox';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import { listConversations, createConversation, type ConversationSummary } from '@/components/copilot/copilotConversationsClient';
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
import { useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';
import { getNextSteps, buildChainPrompt, type ResolvedJob } from '@/lib/workflow-chains';
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
import { PluginStorePanel } from '@/components/desktop/PluginStorePanel';
import { DesktopSettingsPanel } from '@/components/desktop/DesktopSettingsPanel';
import { DesktopDashboard } from '@/pages/_desktop-dashboard';
import type { BackendStatus } from '@/lib/electron';
import styles from './project-workspace.module.css';
import 'highlight.js/styles/github.css';

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ['className']],
    span: [...(defaultSchema.attributes?.span || []), ['className']],
    div: [...(defaultSchema.attributes?.div || []), ['className']],
  },
};

interface ActiveArtifact {
  jobId: string;
  toolId: string;
  name: string;
  type: string;
  label?: string;
  url?: string;
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
  | 'cloud'
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
  'cloud',
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
  const [creatingProjectInline, setCreatingProjectInline] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectWorkspacePath, setNewProjectWorkspacePath] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingConversationFor, setCreatingConversationFor] = useState<string | null>(null);
  const [newConversationTitle, setNewConversationTitle] = useState('');
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState('');
  const [sidebarQuery, setSidebarQuery] = useState('');
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
  const { byProjectId: projectConversations } = useOtherConversations(
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

  const handleShowCloud = useCallback(() => updateWorkspaceMode('cloud'), [updateWorkspaceMode]);
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
  const handleShowSettings = useCallback(() => updateWorkspaceMode('settings'), [updateWorkspaceMode]);

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

  const openProjectCreator = useCallback(() => {
    setCreatingProjectInline(true);
    setNewProjectName('');
    setNewProjectDesc('');
    setNewProjectWorkspacePath('');
    if (compactLayout) setLeftOpen(true);
  }, [compactLayout]);

  const chooseWorkspaceDirectory = useCallback(async () => {
    const selected = await window.biof3Desktop?.files?.openDirectoryDialog?.();
    return selected || '';
  }, []);

  const submitProjectCreator = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name || creatingProject) return;
    setCreatingProject(true);
    try {
      const created = await createProject({
        name,
        description: newProjectDesc.trim() || undefined,
        modality: 'general',
        workspacePath: newProjectWorkspacePath.trim() || undefined,
      });
      setAllProjects((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        next.add(created.id);
        return next;
      });
      setCreatingProjectInline(false);
      setNewProjectName('');
      setNewProjectDesc('');
      setNewProjectWorkspacePath('');
      navigate(`/project/${created.id}`);
    } finally {
      setCreatingProject(false);
    }
  }, [creatingProject, navigate, newProjectDesc, newProjectName, newProjectWorkspacePath]);

  const openConversationCreator = useCallback((targetProjectId = projectId) => {
    if (!targetProjectId) return;
    updateWorkspaceMode('chat');
    setCreatingConversationFor(targetProjectId);
    setNewConversationTitle('');
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.add(targetProjectId);
      return next;
    });
    if (compactLayout) setLeftOpen(true);
  }, [compactLayout, projectId, updateWorkspaceMode]);

  const submitConversationCreator = useCallback(async (targetProjectId = creatingConversationFor) => {
    if (!targetProjectId || creatingConversation) return;
    setCreatingConversation(true);
    try {
      const conv = await createConversation(newConversationTitle.trim() || '新对话', undefined, targetProjectId);
      if (!conv) return;
      setCreatingConversationFor(null);
      setNewConversationTitle('');
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
  }, [creatingConversation, creatingConversationFor, navigate, newConversationTitle, projectId, refreshConversations]);

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

  const normalizedSidebarQuery = sidebarQuery.trim().toLowerCase();
  const projectMatchesSidebarQuery = useCallback(
    (item: Project) => {
      if (!normalizedSidebarQuery) return true;
      const projectText = [item.name, item.description || '', item.modality || '']
        .join(' ')
        .toLowerCase();
      if (projectText.includes(normalizedSidebarQuery)) return true;
      const projectConversationList =
        item.id === projectId ? conversations : projectConversations[item.id] || [];
      return projectConversationList.some((conversation) =>
        String(conversation.title || '').toLowerCase().includes(normalizedSidebarQuery)
      );
    },
    [conversations, normalizedSidebarQuery, projectConversations, projectId]
  );

  const matchesConversationQuery = useCallback(
    (conversation: ConversationSummary) =>
      !normalizedSidebarQuery ||
      String(conversation.title || '').toLowerCase().includes(normalizedSidebarQuery),
    [normalizedSidebarQuery]
  );

  const visibleProjects = useMemo(() => {
    if (!normalizedSidebarQuery) return allProjects;
    return allProjects.filter(projectMatchesSidebarQuery);
  }, [allProjects, normalizedSidebarQuery, projectMatchesSidebarQuery]);

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
  const summaryOpenWidth = Math.min(224, Math.max(0, sessionFrameWidth - 36));
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

  const handleOpenResult = useCallback(async (jobId: string, targetProjectId?: string | null) => {
    const currentProjectId = projectId || null;
    const resolvedTargetProjectId = targetProjectId ?? currentProjectId;
    if (resolvedTargetProjectId && currentProjectId && resolvedTargetProjectId !== currentProjectId) {
      navigate(`/project/${resolvedTargetProjectId}?mode=scheduled&job=${encodeURIComponent(jobId)}`);
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
            navigate(`/project/${nextProjectId}?mode=scheduled&job=${encodeURIComponent(nextJob.id)}`);
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
      updateWorkspaceMode('scheduled', true, nextJob.id);
    }
  }, [jobs, navigate, normalizeToolStatus, openRightPanel, projectId, setRightOpen, updateWorkspaceMode]);

  useEffect(() => {
    autoOpenedJobRef.current = null;
  }, [projectId]);

  useEffect(() => {
    if (loading || !projectId) return;

    if (requestedJobId) {
      if (activeJobId === requestedJobId && workspaceMode === 'scheduled') return;
      if (autoOpenedJobRef.current === requestedJobId) return;
      autoOpenedJobRef.current = requestedJobId;
      void handleOpenResult(requestedJobId, projectId);
      return;
    }

    if (activeJobId || jobs.length === 0) return;
    const firstJob = jobs[0];
    if (!firstJob || autoOpenedJobRef.current === firstJob.id) return;
    autoOpenedJobRef.current = firstJob.id;
    void handleOpenResult(firstJob.id, projectId);
  }, [activeJobId, handleOpenResult, jobs, loading, projectId, requestedJobId, workspaceMode]);

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
    sidebarQuery,
    normalizedSidebarQuery,
    setSidebarQuery,
    visibleProjects,
    projectConversations,
    projectId,
    conversations,
    activeConvId,
    expandedProjects,
    projectMatchesSidebarQuery,
    matchesConversationQuery,
    creatingProjectInline,
    newProjectName,
    newProjectDesc,
    newProjectWorkspacePath,
    creatingProject,
    setCreatingProjectInline,
    setNewProjectName,
    setNewProjectDesc,
    setNewProjectWorkspacePath,
    openProjectCreator,
    submitProjectCreator,
    chooseWorkspaceDirectory,
    creatingConversationFor,
    newConversationTitle,
    creatingConversation,
    setCreatingConversationFor,
    setNewConversationTitle,
    openConversationCreator,
    submitConversationCreator,
    workspaceMode,
    handleShowCloud,
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
  mtime?: number;
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
  depth?: number;
}): React.ReactElement {
  return (
    <ul className={styles.fileTree} style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
      {entries.map((entry) => {
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
}): React.ReactElement {
  const [children, setChildren] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (isExpanded && entry.type === 'dir') {
      onFetchDir(fullPath).then(setChildren);
    }
  }, [isExpanded, entry.type, fullPath, onFetchDir]);

  const fileUrl = fileUrlFor(fullPath);
  const isActive = entry.type === 'file' && activePath === fullPath;

  return (
    <li className={styles.fileTreeNode}>
      <div
        className={`${styles.fileTreeRow} ${isActive ? styles.fileTreeRowActive : ''}`}
        style={{ paddingLeft: depth * 16 }}
        onClick={() => entry.type === 'dir' && onToggleDir(fullPath)}
      >
        {entry.type === 'dir' ? (
          <>
            <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={12} />
            <Icon name="folder" size={14} />
            <span className={styles.fileTreeName}>{entry.name}</span>
          </>
        ) : (
          <>
            <span style={{ width: 12, display: 'inline-block' }} />
            <Icon name="file" size={14} />
            <button
              className={styles.fileTreeLink}
              onClick={(event) => {
                event.stopPropagation();
                onOpenFile({
                  path: fullPath,
                  name: entry.name,
                  url: fileUrl,
                  size: entry.size,
                });
              }}
              title="预览文件"
            >
              {entry.name}
            </button>
            {entry.size != null && (
              <span className={styles.fileTreeSize}>{formatSize(entry.size)}</span>
            )}
          </>
        )}
      </div>
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
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(fileExtension(name));
}

function isTextFile(name?: string): boolean {
  return [
    'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'log',
    'r', 'py', 'sh', 'bash', 'zsh',
    'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx',
    'css', 'scss', 'html', 'xml',
    'yaml', 'yml', 'toml',
  ].includes(fileExtension(name));
}

function isMarkdownFile(name?: string): boolean {
  return ['md', 'markdown'].includes(fileExtension(name));
}

function previewLanguage(name?: string): string {
  const ext = fileExtension(name);
  const map: Record<string, string> = {
    bash: 'bash',
    cjs: 'javascript',
    css: 'css',
    csv: 'csv',
    html: 'xml',
    js: 'javascript',
    json: 'json',
    jsonl: 'json',
    jsx: 'jsx',
    log: 'plaintext',
    mjs: 'javascript',
    py: 'python',
    r: 'r',
    scss: 'scss',
    sh: 'bash',
    toml: 'ini',
    ts: 'typescript',
    tsx: 'tsx',
    tsv: 'tsv',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    zsh: 'bash',
  };
  return map[ext] || 'plaintext';
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
  openFiles,
  activeFile,
  onOpenFile,
  onSelectFile,
  onCloseFile,
}: {
  project: Project;
  openFiles: ActiveWorkspaceFile[];
  activeFile: ActiveWorkspaceFile | null;
  onOpenFile: (file: ActiveWorkspaceFile) => void;
  onSelectFile: (file: ActiveWorkspaceFile) => void;
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

  useEffect(() => {
    setLoading(true);
    fetchDir('').then((entries) => {
      setTree(entries);
      setLoading(false);
    });
  }, [fetchDir, project.id]);

  useEffect(() => {
    let cancelled = false;
    setHarnessLoading(true);
    setHarnessError('');
    fetchHarnessIndex({ scope: 'project', projectId: project.id, maxFiles: 120 })
      .then((data) => {
        if (cancelled) return;
        setHarnessIndex(data.index || null);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setHarnessIndex(null);
        setHarnessError(error.message || '识别失败');
      })
      .finally(() => {
        if (!cancelled) setHarnessLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

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
        <div className={styles.workspaceFileTabs}>
          {openFiles.length === 0 ? (
            <span className={styles.workspaceTabsEmpty}>选择文件预览</span>
          ) : (
            openFiles.map((file) => (
              <button
                key={file.path}
                className={`${styles.workspaceFileTab} ${activeFile?.path === file.path ? styles.workspaceFileTabActive : ''}`}
                onClick={() => onSelectFile(file)}
                title={file.path}
              >
                <Icon name={isImageFile(file.name) ? 'image' : 'file'} size={13} />
                <span>{file.name}</span>
                <span
                  className={styles.workspaceFileTabClose}
                  role="button"
                  tabIndex={0}
                  title="关闭"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseFile(file.path);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      onCloseFile(file.path);
                    }
                  }}
                >
                  <Icon name="x" size={12} />
                </span>
              </button>
            ))
          )}
        </div>
        <button
          className={styles.workspaceTreeToggle}
          onClick={() => setTreeOpen((value) => !value)}
          title={treeOpen ? '收起文件树' : '展开文件树'}
        >
          <Icon name={treeOpen ? 'chevron-down' : 'chevron-right'} size={13} />
          <Icon name="folder" size={14} />
        </button>
      </div>
      <div className={styles.workspaceFilesMain}>
        <div className={styles.workspaceFilePreviewPane}>
          <WorkspaceFilePreview file={activeFile} />
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

function WorkspaceFilePreview({ file }: { file: ActiveWorkspaceFile | null }): React.ReactElement {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'unsupported' | 'error'>('idle');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const isImage = isImageFile(file?.name);
  const isText = isTextFile(file?.name);
  const isMarkdown = isMarkdownFile(file?.name);

  useEffect(() => {
    let cancelled = false;
    setText('');
    if (!file) {
      setStatus('idle');
      return () => { cancelled = true; };
    }
    if (isImage) {
      setStatus('ready');
      return () => { cancelled = true; };
    }
    if (!isText) {
      setStatus('unsupported');
      return () => { cancelled = true; };
    }
    setStatus('loading');
    fetch(file.url)
      .then((resp) => {
        if (!resp.ok) throw new Error('preview failed');
        return resp.text();
      })
      .then((body) => {
        if (cancelled) return;
        setText(body.length > 120_000 ? `${body.slice(0, 120_000)}\n\n... 文件较大，仅预览前 120KB` : body);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => { cancelled = true; };
  }, [file, isImage, isText]);

  if (!file) {
    return (
      <div className={styles.workspacePreviewEmpty}>
        <Icon name="file" size={18} />
        <span>选择一个文本或图片文件预览</span>
      </div>
    );
  }

  return (
    <div className={styles.workspacePreview}>
      <div className={styles.workspacePreviewHeader}>
        <div className={styles.workspacePreviewTitle}>
          <Icon name={isImage ? 'image' : 'file'} size={14} />
          <span>{file.name}</span>
        </div>
        <a className={styles.workspacePreviewOpen} href={file.url} target="_blank" rel="noopener noreferrer">
          打开
        </a>
      </div>
      <div className={styles.workspacePreviewBody}>
        {status === 'loading' && <p className={styles.panelEmpty}>加载预览…</p>}
        {status === 'error' && <p className={styles.panelEmpty}>预览失败</p>}
        {status === 'unsupported' && (
          <p className={styles.panelEmpty}>暂不支持此类型的内联预览，可点击右上角打开。</p>
        )}
        {status === 'ready' && isImage && (
          <button className={styles.workspaceImageButton} onClick={() => setLightboxSrc(file.url)}>
            <img src={file.url} alt={file.name} className={styles.workspaceImagePreview} />
          </button>
        )}
        {status === 'ready' && isText && isMarkdown && (
          <div className={styles.workspaceMarkdownPreview}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight, [rehypeSanitize, markdownSanitizeSchema]]}
            >
              {text}
            </ReactMarkdown>
          </div>
        )}
        {status === 'ready' && isText && !isMarkdown && (
          <div className={styles.workspaceCodePreview}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight, [rehypeSanitize, markdownSanitizeSchema]]}
            >
              {`~~~${previewLanguage(file.name)}\n${formatPreviewText(file.name, text)}\n~~~`}
            </ReactMarkdown>
          </div>
        )}
      </div>
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
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
  /** Opens a generated delivery report in the right-side Electron webview. */
  onOpenBrowser?: (url: string) => void;
}): React.ReactElement {
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
    return (
      pickPreferredArtifact(coreArtifacts, preferredArtifactName) ||
      coreArtifacts[0] ||
      null
    );
  }, [artifacts, coreArtifacts, preferredArtifactName, selectedName]);
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
      if (current && coreArtifacts.some((artifact) => artifact.name === current)) return current;
      return preferredName;
    });
    setSelectedSectionId((current) => {
      if (current && navSections.some((section) => section.id === current)) return current;
      const nextSection =
        (preferredName && navSections.find((item) => item.artifactNames.includes(preferredName))) ||
        navSections[0];
      return nextSection?.id || '';
    });
  }, [coreArtifacts, effectiveJobStatus, job, navSections, preferredArtifactName]);

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
    };
    if (
      !activeArtifact ||
      activeArtifact.jobId !== artifact.jobId ||
      activeArtifact.name !== artifact.name
    ) {
      onActiveArtifactChange(artifact);
    }
  }, [activeArtifact, effectiveJobStatus, job, onActiveArtifactChange, selectedArtifact, selectedArtifactKind, selectedArtifactUrl]);

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
        body: JSON.stringify({}),
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
          <button type="button" disabled={reportGenerating || !reportArtifact} onClick={() => void generateFinalReport()}>
            {reportGenerating ? '生成中…' : finalReportUrl ? '重新生成' : '生成报告'}
          </button>
          {finalReportUrl && onOpenBrowser && (
            <button type="button" onClick={() => onOpenBrowser(finalReportUrl)}>内置浏览器查看</button>
          )}
          {finalReportUrl && <a href={finalReportUrl} target="_blank" rel="noopener noreferrer">系统浏览器查看</a>}
          {finalReportUrl && <a href={finalReportUrl} download="final-report.html">下载 HTML</a>}
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
}: {
  project: Project;
  job: ToolJob;
  workflow?: HarnessWorkflowJobState | null;
  activeArtifact: ActiveArtifact | null;
  onActiveArtifactChange: (artifact: ActiveArtifact | null) => void;
  onAskAgent: (prompt: string) => void;
}): React.ReactElement {
  return (
    <ResultArtifactShell
      project={project}
      job={job}
      workflow={workflow}
      activeArtifact={activeArtifact}
      onActiveArtifactChange={onActiveArtifactChange}
      onAskAgent={onAskAgent}
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
  onOpenBrowser,
}: {
  project: Project;
  job: ToolJob | null;
  workflow: HarnessWorkflowJobState | null;
  activeArtifact: ActiveArtifact | null;
  onActiveArtifactChange: (artifact: ActiveArtifact | null) => void;
  onAskAgent: (prompt: string) => void;
  onWorkflowChanged: () => void;
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
      onOpenBrowser={onOpenBrowser}
      variant="sidebar"
      showHarnessIndex
    />
  );
}

// ============================================================
// ChainRecommendations — Phase 8: recommend next analysis steps
// ============================================================

function ChainRecommendations({
  job,
  resultFiles,
  onAskAgent,
}: {
  job: ToolJob;
  resultFiles?: JobResultFile[];
  onAskAgent: (prompt: string) => void;
}): React.ReactElement | null {
  // Only show for completed jobs
  if (job.status !== 'done') return null;

  const steps = getNextSteps(job.tool_id);
  if (steps.length === 0) return null;

  // Build a resolved job for param mapping
  const resolvedJob: ResolvedJob = {
    id: job.id,
    toolId: job.tool_id,
    resultFiles: resultFiles?.map((f) => ({
      name: artifactName(f),
      url: f.url || '',
      type: f.type,
      label: f.label || f.title,
    })),
  };

  // Find tool title for each step
  const findTitle = (id: string) =>
    staticTools.find((t) => t.id === id)?.title || id;

  return (
    <div className={styles.chainRecs}>
      <div className={styles.chainRecsHeader}>
        <Icon name="zap" size={14} />
        <span>推荐下一步分析</span>
      </div>
      <div className={styles.chainRecsBody}>
        {steps.map((step, i) => {
          const toTitle = findTitle(step.to);
          return (
            <button
              key={i}
              className={styles.chainRecItem}
              onClick={() => {
                const prompt = buildChainPrompt(step, resolvedJob, findTitle(job.tool_id));
                onAskAgent(prompt);
              }}
              title={step.reason}
            >
              <span className={styles.chainRecArrow}>→</span>
              <div className={styles.chainRecMeta}>
                <span className={styles.chainRecTitle}>{toTitle}</span>
                <span className={styles.chainRecReason}>{step.reason}</span>
              </div>
              <span className={styles.chainRecCta}>发送给 Agent</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'https://biof3.com/';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) return trimmed;
  if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
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
  const [title, setTitle] = useState('浏览器');
  const [loading, setLoading] = useState(true);
  const [browserError, setBrowserError] = useState('');

  useEffect(() => {
    if (!webviewRef.current) return;
    webviewRef.current.style.visibility = obscured ? 'hidden' : 'visible';
    webviewRef.current.style.pointerEvents = obscured ? 'none' : 'auto';
  }, [obscured]);

  const navigate = useCallback(
    (value: string) => {
      const nextUrl = normalizeBrowserUrl(value);
      setInputUrl(nextUrl);
      onUrlChange(nextUrl);
      if (webviewRef.current) {
        try {
          webviewRef.current.loadURL(nextUrl);
        } catch {
          webviewRef.current.src = nextUrl;
        }
      }
    },
    [onUrlChange]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';

    const webview = document.createElement('webview') as any;
    webview.style.width = '100%';
    webview.style.height = '100%';
    webview.style.border = '0';
    webview.style.display = 'block';
    webview.setAttribute('partition', 'persist:biof3-browser');
    webview.setAttribute('allowpopups', 'true');
    webview.src = startUrlRef.current;

    const syncState = () => {
      try {
        const current = typeof webview.getURL === 'function' ? webview.getURL() : webview.src;
        if (current) {
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
      host.innerHTML = '';
      webviewRef.current = null;
      onNavigationStateChange?.({ canGoBack: false, canGoForward: false });
    };
  }, [navigate, onNavigationStateChange, onUrlChange, startUrlRef]);

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
    try {
      webviewRef.current?.reload?.();
    } catch {}
  }, []);

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
      <div className={styles.browserHost} ref={hostRef} />
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
