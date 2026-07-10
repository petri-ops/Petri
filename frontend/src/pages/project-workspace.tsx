// ============================================================
// ProjectWorkspace — UI-REFACTOR Phase3
// Three-column layout: left=resources, center=results+agent, right=history+tools
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
import { Lightbox } from '@/components/ui/Lightbox';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import { listConversations, createConversation, type ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import {
  useConversations,
  useOtherConversations,
} from '@/hooks/useConversations';
import { useResizableColumns } from '@/hooks/useResizableColumns';
import { usePluginStore } from '@/hooks/usePluginStore';
import { useSetCopilotContext } from '@/lib/copilotContextProvider';
import { biof3Events, subscribeBioF3Event, dispatchBioF3Event } from '@/lib/events';
import { getNextSteps, buildChainPrompt, type ResolvedJob } from '@/lib/workflow-chains';
import { PluginStorePanel } from '@/components/desktop/PluginStorePanel';
import { DesktopSettingsPanel } from '@/components/desktop/DesktopSettingsPanel';
import { DesktopDashboard } from '@/pages/_desktop-dashboard';
import ToolsPage from '@/pages/tools';
import FigCodePage from '@/pages/figcode';
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

interface BackendServiceItem {
  key: string;
  label: string;
  status: string;
}

interface BackendSummary {
  readyLabel: string;
  serviceItems: BackendServiceItem[];
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
  BackendServiceItem,
  BackendSummary,
  JobStats,
};

type WorkspaceMode =
  | 'cloud'
  | 'chat'
  | 'search'
  | 'scheduled'
  | 'tools'
  | 'figcode'
  | 'plugins'
  | 'settings';

export type RightPanelMode = 'home' | 'results' | 'files' | 'terminal' | 'browser' | 'chat';

export const RIGHT_PANEL_ITEMS: Array<{ id: RightPanelMode; label: string; icon: IconName }> = [
  { id: 'home', label: '工作台', icon: 'layout-grid' },
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
  'tools',
  'figcode',
  'plugins',
  'settings',
];

function parseWorkspaceMode(value: string | null): WorkspaceMode | null {
  if (!value) return null;
  return WORKSPACE_MODES.includes(value as WorkspaceMode) ? (value as WorkspaceMode) : null;
}

export function ProjectWorkspace(): React.ReactElement {
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

  // Panel collapse state
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true); // file tree + results panel
  const [compactLayout, setCompactLayout] = useState(
    () => window.matchMedia('(max-width: 960px)').matches
  );

  // Selected result tab
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeArtifact, setActiveArtifact] = useState<ActiveArtifact | null>(null);
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<ActiveWorkspaceFile | null>(null);
  const [openWorkspaceFiles, setOpenWorkspaceFiles] = useState<ActiveWorkspaceFile[]>([]);

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
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summarySize, setSummarySize] = useState({ width: 320, height: 296 });

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
  const [bottomTerminalOpen, setBottomTerminalOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightPanelMode>('home');
  const [openRightTabs, setOpenRightTabs] = useState<RightPanelMode[]>(['home']);
  const [rightToolMenuOpen, setRightToolMenuOpen] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('https://biof3.com/');
  const centerColRef = useRef<HTMLElement | null>(null);
  const sessionFrameRef = useRef<HTMLDivElement | null>(null);
  const [centerColWidth, setCenterColWidth] = useState(0);
  const [sessionFrameWidth, setSessionFrameWidth] = useState(0);
  const [sessionFrameHeight, setSessionFrameHeight] = useState(0);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)');
    const syncLayout = (compact: boolean) => {
      setCompactLayout(compact);
      if (compact) {
        setLeftOpen(false);
        setRightOpen(false);
      }
    };
    syncLayout(media.matches);
    const onChange = (event: MediaQueryListEvent) => syncLayout(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const element = centerColRef.current;
    if (!element) return;
    const updateWidth = () => setCenterColWidth(element.getBoundingClientRect().width || 0);
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    const element = sessionFrameRef.current;
    if (!element) return;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setSessionFrameWidth(rect.width || 0);
      setSessionFrameHeight(rect.height || 0);
    };
    updateSize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSize);
    observer?.observe(element);
    window.addEventListener('resize', updateSize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  useEffect(() => {
    const nextMode = parseWorkspaceMode(searchParams.get('mode')) || 'chat';
    setWorkspaceMode((current) => (current === nextMode ? current : nextMode));
  }, [searchParams]);

  const summaryVisibility = useMemo<'hidden' | 'compact' | 'expanded'>(() => {
    if (sessionFrameWidth === 0) return 'expanded';
    if (sessionFrameWidth >= 1120) return 'expanded';
    if (sessionFrameWidth >= 780) return 'compact';
    return 'hidden';
  }, [sessionFrameWidth]);

  const updateWorkspaceMode = useCallback((nextMode: WorkspaceMode, replace = true) => {
    setWorkspaceMode(nextMode);
    const nextParams = new URLSearchParams(searchParams);
    if (nextMode === 'chat') nextParams.delete('mode');
    else nextParams.set('mode', nextMode);
    setSearchParams(nextParams, { replace });
  }, [searchParams, setSearchParams]);

  const openRightPanel = useCallback((tab: RightPanelMode) => {
    if (compactLayout) setLeftOpen(false);
    setOpenRightTabs((current) => current.includes(tab) ? current : [...current, tab]);
    setRightTab(tab);
    setRightOpen(true);
  }, [compactLayout]);

  const closeRightPanelTab = useCallback((tab: RightPanelMode) => {
    setOpenRightTabs((current) => {
      if (current.length <= 1) return current;
      const closingIndex = current.indexOf(tab);
      const next = current.filter((item) => item !== tab);
      setRightTab((active) => (
        active === tab
          ? next[Math.min(Math.max(closingIndex, 0), next.length - 1)] || next[0]
          : active
      ));
      return next;
    });
  }, []);

  // Drag-to-resize handlers come from useResizableColumns above. The
  // project-workspace panel-specific resize (startSummaryResize) stays
  // inline because it operates on a different state slot (summarySize)
  // with custom clamp logic tied to sessionFrame dimensions.

  const startSummaryResize = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement & { setPointerCapture?: (pointerId: number) => void };
    if ('pointerId' in e && typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = summarySize.width;
    const startHeight = summarySize.height;
    const minWidth = 288;
    const minHeight = 236;
    const maxWidth = Math.max(minWidth, sessionFrameWidth - 36);
    const maxHeight = Math.max(minHeight, sessionFrameHeight - 36);

    const onMove = (ev: MouseEvent | PointerEvent) => {
      const deltaX = ev.clientX - startX;
      const deltaY = ev.clientY - startY;
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, startWidth - deltaX));
      const nextHeight = Math.min(maxHeight, Math.max(minHeight, startHeight + deltaY));
      setSummarySize({ width: nextWidth, height: nextHeight });
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove as unknown as EventListener);
      document.removeEventListener('pointerup', onUp as unknown as EventListener);
      document.removeEventListener('pointercancel', onUp as unknown as EventListener);
      if ('pointerId' in e && typeof target.releasePointerCapture === 'function') {
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('pointermove', onMove as unknown as EventListener);
    document.addEventListener('pointerup', onUp as unknown as EventListener);
    document.addEventListener('pointercancel', onUp as unknown as EventListener);
    document.body.style.cursor = 'nesw-resize';
    document.body.style.userSelect = 'none';
  }, [sessionFrameHeight, sessionFrameWidth, summarySize.height, summarySize.width]);

  // Bottom-terminal drag comes from useResizableColumns above; we clamp
  // the height to the workspace viewport (140-520) inline so the
  // terminal never eats the entire screen.
  const handleBottomTerminalResize = useCallback(
    (event: React.MouseEvent) => {
      startBottomTerminalResize(event, { min: 140, max: 520 });
    },
    [startBottomTerminalResize]
  );

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
    updateWorkspaceMode('scheduled');
    if (!activeJobId && jobs.length > 0) {
      setActiveJobId(jobs[0].id);
    }
  }, [activeJobId, jobs, updateWorkspaceMode]);
  const handleShowTools = useCallback(() => updateWorkspaceMode('tools'), [updateWorkspaceMode]);
  const handleShowFigCode = useCallback(() => updateWorkspaceMode('figcode'), [updateWorkspaceMode]);
  const handleShowSettings = useCallback(() => updateWorkspaceMode('settings'), [updateWorkspaceMode]);

  const handleShowPlugins = useCallback(() => updateWorkspaceMode('plugins'), [updateWorkspaceMode]);

  const handleOpenRightTerminal = useCallback(() => {
    openRightPanel('terminal');
  }, [openRightPanel]);

  const handleOpenRightBrowser = useCallback(() => {
    openRightPanel('browser');
  }, [openRightPanel]);

  const handleOpenRightFiles = useCallback(() => {
    setRightOpen(true);
    openRightPanel('files');
  }, [openRightPanel]);

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
          activeJobId: activeJobId ?? undefined,
          activeArtifact,
        }
      : {},
    [project, projectId, datasets, jobs, activeJobId, activeArtifact]
  );

  useEffect(() => {
    setActiveArtifact(null);
  }, [activeJobId]);

  const activeJob = useMemo(
    () => jobs.find((j) => j.id === activeJobId) || null,
    [jobs, activeJobId]
  );

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

  const openScheduledResults = useCallback(() => {
    if (activeJobId || jobs.length > 0) {
      setActiveJobId((current) => current || jobs[0]?.id || null);
    }
    updateWorkspaceMode('scheduled');
    openRightPanel('results');
  }, [activeJobId, jobs, openRightPanel, updateWorkspaceMode]);

  const backendSummary = useMemo(() => {
    const readyLabel = backendStatus.isReady
      ? '后端就绪'
      : backendStatus.downReason || '后端检测中…';
    const serviceItems = [
      {
        key: 'r-runtime',
        label: 'R',
        status: backendStatus.rRuntime ? 'runtime' : 'offline',
      },
      {
        key: 'py-runtime',
        label: 'Python',
        status: backendStatus.pyRuntime ? 'runtime' : 'offline',
      },
      {
        key: 'plumber',
        label: 'Plumber',
        status: backendStatus.plumberUp ? 'online' : 'offline',
      },
    ];
    return { readyLabel, serviceItems };
  }, [backendStatus]);

  const showPinnedSummary = workspaceMode === 'chat' || workspaceMode === 'scheduled';
  const summaryOpenWidth = Math.min(summarySize.width, Math.max(288, sessionFrameWidth - 36));
  const summaryOpenHeight = Math.min(summarySize.height, Math.max(236, sessionFrameHeight - 36));
  const summaryCardOpen = summaryVisibility !== 'hidden' && summaryOpen;

  const normalizeToolStatus = useCallback((status: unknown): ToolJob['status'] => {
    if (status === 'completed' || status === 'done') return 'done';
    if (status === 'failed') return 'failed';
    if (status === 'running') return 'running';
    return 'pending';
  }, []);

  const handleOpenResult = useCallback(async (jobId: string) => {
    let nextJob = jobs.find((j) => j.id === jobId) || null;
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
            project_id: projectId || null,
          };
          setJobs((prev) => (prev.some((j) => j.id === nextJob!.id) ? prev : [nextJob!, ...prev]));
        }
      } catch {
        /* keep the current panel state if the status lookup fails */
      }
    }
    if (nextJob) {
      setActiveJobId(nextJob.id);
      openRightPanel('results');
    }
  }, [jobs, normalizeToolStatus, openRightPanel, projectId]);

  useEffect(() => {
    const handler = (detail: unknown) => {
      const d = detail as { toolJobId?: string } | undefined;
      if (d?.toolJobId) {
        handleOpenResult(d.toolJobId);
      }
    };
    const unsub = subscribeBioF3Event(biof3Events.projectOpenResult, handler);
    return unsub;
  }, [handleOpenResult]);

  /** Dispatch a copilot-ask event so the embedded SimpleChat picks it up */
  const handleAskAgent = useCallback((prompt: string) => {
    dispatchBioF3Event(biof3Events.copilotAsk, { prompt });
  }, []);

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
    rightOpen,
    inputHeight,
    summaryCardOpen,
    summaryVisibility,
    summaryOpenWidth,
    summaryOpenHeight,
    compactWorkspacePath,
    activeJob,
    activeArtifact,
    activeJobId,
    backendSummary,
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
    setRightOpen,
    setSummaryOpen,
    handleShowTools,
    handleShowFigCode,
    handleShowPlugins,
    handleOpenResult,
    handleAskAgent,
    handleOpenWorkspacePath,
    openScheduledResults,
    startColumnResize,
    startSummaryResize,
  };

  const leftPanelCtx: LeftPanelContext = {
    width: leftWidth,
    project: project as Project,
    workspacePath,
    compactWorkspacePath,
    workspaceNotice,
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
    handleShowTools,
    handleShowFigCode,
    handleShowPlugins,
    handleShowSettings,
    switchToProject,
    handleSwitchConversation,
    toggleProjectExpand,
    handleOpenWorkspacePath,
    handleChangeWorkspacePath,
  };

  const rightPanelCtx: RightPanelContext = {
    width: rightWidth,
    bottomTerminalOpen,
    bottomTerminalHeight,
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
    handleOpenRightTerminal,
    handleOpenRightBrowser,
    handleOpenRightFiles,
    handleOpenRightChat,
    setBrowserUrl,
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
          leftOffset={leftOpen ? leftWidth + 5 : 0}
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
  onOpenTools,
  onOpenFigCode,
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
  onOpenTools: () => void;
  onOpenFigCode: () => void;
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

  const toolMatches = useMemo(
    () =>
      staticTools.filter((item) => {
        if (!normalizedQuery) return true;
        return (
          item.title.toLowerCase().includes(normalizedQuery) ||
          item.subtitle.toLowerCase().includes(normalizedQuery) ||
          item.id.toLowerCase().includes(normalizedQuery) ||
          item.category.toLowerCase().includes(normalizedQuery)
        );
      }),
    [normalizedQuery]
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
          <p className={styles.workspaceSearchDesc}>在项目、对话、工具和当前工作记录里快速跳转。</p>
        </div>
        <div className={styles.workspaceSearchActions}>
          <button className={styles.workspaceSearchAction} onClick={onOpenTools}>
            <Icon name="bar-chart" size={14} />
            <span>分析工具</span>
          </button>
          <button className={styles.workspaceSearchAction} onClick={onOpenFigCode}>
            <Icon name="image" size={14} />
            <span>FigCode</span>
          </button>
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
          placeholder="搜索项目、对话、分析工具、任务…"
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
              <span>工具</span>
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

        <SearchResultSection title="分析工具" count={toolMatches.length}>
          {toolMatches.slice(0, 10).map((item) => (
            <button key={item.id} className={styles.searchResultItem} onClick={onOpenTools}>
              <Icon name="bar-chart" size={14} />
              <div className={styles.searchResultMeta}>
                <span className={styles.searchResultTitle}>{item.title}</span>
                <span className={styles.searchResultSub}>{item.subtitle}</span>
              </div>
            </button>
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
// ScheduledWorkspacePanel — center column scheduled/jobs view
// ============================================================

export function ScheduledWorkspacePanel({
  project,
  jobs,
  activeJobId,
  activeArtifact,
  onSelectJob,
  onActiveArtifactChange,
  onAskAgent,
  onBackToChat,
}: {
  project: Project;
  jobs: ToolJob[];
  activeJobId: string | null;
  activeArtifact: ActiveArtifact | null;
  onSelectJob: (id: string) => void;
  onActiveArtifactChange: (artifact: ActiveArtifact | null) => void;
  onAskAgent: (prompt: string) => void;
  onBackToChat: () => void;
}): React.ReactElement {
  const activeJob = useMemo(
    () => jobs.find((job) => job.id === activeJobId) || jobs[0] || null,
    [jobs, activeJobId]
  );

  const stats = useMemo(() => {
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

  return (
    <div className={styles.scheduledWorkspace}>
      <div className={styles.scheduledWorkspaceHeader}>
        <div>
          <h2 className={styles.scheduledWorkspaceTitle}>已安排</h2>
          <p className={styles.scheduledWorkspaceDesc}>
            当前项目 {project.name} 的运行记录、结果和下一步建议。
          </p>
        </div>
        <button className={styles.scheduledWorkspaceBack} onClick={onBackToChat}>
          <Icon name="message-circle" size={14} />
          <span>返回对话</span>
        </button>
      </div>

      <div className={styles.scheduledStats}>
        <div className={styles.scheduledStatCard}>
          <span className={styles.scheduledStatLabel}>总任务</span>
          <strong>{jobs.length}</strong>
        </div>
        <div className={styles.scheduledStatCard}>
          <span className={styles.scheduledStatLabel}>运行中</span>
          <strong>{stats.running + stats.pending}</strong>
        </div>
        <div className={styles.scheduledStatCard}>
          <span className={styles.scheduledStatLabel}>已完成</span>
          <strong>{stats.done}</strong>
        </div>
        <div className={styles.scheduledStatCard}>
          <span className={styles.scheduledStatLabel}>失败</span>
          <strong>{stats.failed}</strong>
        </div>
      </div>

      <div className={styles.scheduledWorkspaceBody}>
        <aside className={styles.scheduledHistoryCol}>
          <HistoryPanel jobs={jobs} activeJobId={activeJob?.id || null} onSelectJob={onSelectJob} />
        </aside>
        <section className={styles.scheduledResultCol}>
          {activeJob ? (
            <ResultView
              job={activeJob}
              activeArtifact={activeArtifact}
              onActiveArtifactChange={onActiveArtifactChange}
              onAskAgent={onAskAgent}
            />
          ) : (
            <EmptyResult project={project} />
          )}
        </section>
      </div>
    </div>
  );
}

// WorkspaceSummaryCard moved to @/components/workspace-panels/WorkspaceSummaryCard (PR-3.1)

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
  'figcode-card': '绘图',
  'figcode-data': '数据',
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

export function ResultView({
  job,
  activeArtifact,
  onActiveArtifactChange,
  onAskAgent,
}: {
  job: ToolJob;
  activeArtifact: ActiveArtifact | null;
  onActiveArtifactChange: (artifact: ActiveArtifact | null) => void;
  onAskAgent: (prompt: string) => void;
}): React.ReactElement {
  const [result, setResult] = useState<JobResult | null>(null);
  const [jobMeta, setJobMeta] = useState<JobDetailMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'plots' | 'files' | 'details'>('plots');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<string[][] | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>('');

  const tool = useMemo(
    () => staticTools.find((t) => t.id === job.tool_id) || null,
    [job.tool_id]
  );

  // Determine API language prefix
  const lang: 'r' | 'python' = tool?.language === 'python' ? 'python' : 'r';

  // Build file URL helper
  const buildUrl = useCallback(
    (name: string) => {
      const base = getApiPrefix(lang);
      const token = getToken();
      const tokenQs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `${base}/tools/result/${job.id}/${encodeURIComponent(name)}${tokenQs}`;
    },
    [job.id, lang]
  );

  const toArtifact = useCallback(
    (file: JobResultFile): ActiveArtifact => ({
      jobId: job.id,
      toolId: job.tool_id,
      name: artifactName(file),
      type: file.type,
      label: file.label || file.title,
      url: buildUrl(artifactName(file)),
    }),
    [buildUrl, job.id, job.tool_id]
  );

  // Fetch result when job is done
  useEffect(() => {
    if (job.status === 'done') {
      setLoading(true);
      setResult(null);
      setJobMeta(null);
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
          // ignore
        } finally {
          setLoading(false);
        }
      })();
    } else {
      setResult(null);
      setJobMeta(null);
    }
  }, [job.id, job.status, lang]);

  const files = result?.artifacts || result?.files || [];
  const plots = files.filter((f) => f.type === 'plot');
  const tables = files.filter((f) => f.type === 'table' || f.type === 'file' || f.type === 'text' || f.type === 'json');

  useEffect(() => {
    if (job.status !== 'done') {
      onActiveArtifactChange(null);
      return;
    }
    const first = plots[0] || tables[0] || files[0];
    if (!first) {
      onActiveArtifactChange(null);
      return;
    }
    if (!activeArtifact || activeArtifact.jobId !== job.id) {
      onActiveArtifactChange(toArtifact(first));
    }
  }, [activeArtifact, files, job.id, job.status, onActiveArtifactChange, plots, tables, toArtifact]);

  const previewFile = useCallback(
    async (file: JobResultFile) => {
      try {
        onActiveArtifactChange(toArtifact(file));
        const fileName = artifactName(file);
        const resp = await fetch(buildUrl(fileName));
        const text = await resp.text();
        const isTable = /\.(csv|tsv)$/i.test(fileName);
        setPreviewName(fileName);
        if (isTable) {
          const sep = fileName.toLowerCase().endsWith('.tsv') || text.includes('\t') ? '\t' : ',';
          const rows = text
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 40)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
          setPreviewData(rows);
          setPreviewText(null);
          return;
        }
        if (fileName.toLowerCase().endsWith('.json')) {
          try {
            setPreviewText(JSON.stringify(JSON.parse(text), null, 2));
          } catch {
            setPreviewText(text.slice(0, 12000));
          }
        } else {
          setPreviewText(text.slice(0, 12000));
        }
        setPreviewData(null);
      } catch {
        setPreviewData(null);
        setPreviewText('无法读取预览内容');
      }
    },
    [buildUrl, onActiveArtifactChange, toArtifact]
  );

  const explainCurrentResult = useCallback(() => {
    const artifact = activeArtifact;
    const fileList = files.slice(0, 12).map((f) => `${artifactName(f)}(${f.type})`).join(', ');
    if (artifact) {
      onAskAgent(
        `请解释当前正在查看的分析结果 artifact：jobId=${artifact.jobId}，toolId=${artifact.toolId}，文件=${artifact.name}，类型=${artifact.type}，标签=${artifact.label || '无'}。请结合这个文件说明结果含义、关键观察、可能的质量问题，以及下一步建议。`
      );
      return;
    }
    onAskAgent(
      `请解释当前分析结果：jobId=${job.id}，toolId=${job.tool_id}，可用文件=${fileList || '暂无文件'}。请总结主要发现和下一步建议。`
    );
  }, [activeArtifact, files, job.id, job.tool_id, onAskAgent]);

  // Running / pending state
  if (job.status === 'running' || job.status === 'pending') {
    return (
      <div className={styles.resultView}>
        <div className={styles.resultHeader}>
          <h2 className={styles.resultTitle}>{job.name || job.tool_id}</h2>
          <span className={styles.resultStatus} data-status={job.status}>
            {job.status === 'running' ? '运行中…' : '排队中'}
          </span>
        </div>
        <div className={styles.resultBody}>
          <div className={styles.resultRunning}>
            <div className={styles.spinner} />
            <p>分析正在执行，请稍候…</p>
          </div>
        </div>
      </div>
    );
  }

  // Failed state
  if (job.status === 'failed') {
    return (
      <div className={styles.resultView}>
        <div className={styles.resultHeader}>
          <h2 className={styles.resultTitle}>{job.name || job.tool_id}</h2>
          <span className={styles.resultStatus} data-status="failed">失败</span>
        </div>
        <div className={styles.resultBody}>
          <pre className={styles.resultError}>{job.error || '执行失败，无错误信息'}</pre>
        </div>
      </div>
    );
  }

  // Loading result
  if (loading) {
    return (
      <div className={styles.resultView}>
        <div className={styles.resultHeader}>
          <h2 className={styles.resultTitle}>{job.name || job.tool_id}</h2>
          <span className={styles.resultStatus} data-status="done">完成</span>
        </div>
        <div className={styles.resultBody}>
          <p className={styles.resultPlaceholder}>加载结果中…</p>
        </div>
      </div>
    );
  }

  // No result data
  if (!result) {
    return (
      <div className={styles.resultView}>
        <div className={styles.resultHeader}>
          <h2 className={styles.resultTitle}>{job.name || job.tool_id}</h2>
          <span className={styles.resultStatus} data-status="done">完成</span>
        </div>
        <div className={styles.resultBody}>
          <p className={styles.resultPlaceholder}>
            分析已完成，但未生成可视化结果文件。
          </p>
        </div>
      </div>
    );
  }

  // Result with files
  return (
    <div className={styles.resultView}>
      <div className={styles.resultHeader}>
        <h2 className={styles.resultTitle}>{job.name || job.tool_id}</h2>
        <span className={styles.resultStatus} data-status="done">完成</span>
        <div className={styles.resultHeaderActions}>
          <button className={styles.plotCardBtnPrimary} onClick={explainCurrentResult}>
            <Icon name="message-circle" size={13} /> 解释当前结果
          </button>
        </div>
      </div>
      <div className={styles.resultBody}>
        {/* Tabs */}
        <div className={styles.resultTabs}>
          <button
            className={`${styles.resultTab} ${tab === 'plots' ? styles.resultTabActive : ''}`}
            onClick={() => setTab('plots')}
          >
            图表 ({plots.length})
          </button>
          <button
            className={`${styles.resultTab} ${tab === 'files' ? styles.resultTabActive : ''}`}
            onClick={() => setTab('files')}
          >
            数据文件 ({tables.length})
          </button>
          <button
            className={`${styles.resultTab} ${tab === 'details' ? styles.resultTabActive : ''}`}
            onClick={() => setTab('details')}
          >
            详情
          </button>
        </div>

        {/* Plots tab */}
        {tab === 'plots' && (
          <div className={styles.plotCardGrid}>
            {plots.map((f, idx) => (
              <div
                key={artifactName(f)}
                className={`${styles.plotCard} ${activeArtifact?.jobId === job.id && activeArtifact.name === artifactName(f) ? styles.plotCardActive : ''}`}
              >
                <div className={styles.plotCardHeader}>
                  <span className={styles.plotCardNum}>图{idx + 1}</span>
                  <span className={styles.plotCardLabel}>
                    {f.label || f.title || artifactName(f).replace(/\.[^.]+$/, '')}
                  </span>
                </div>
                <div className={styles.plotCardImg}>
                  <img
                    src={buildUrl(artifactName(f))}
                    alt={f.label || f.title || artifactName(f)}
                    onClick={() => {
                      const artifact = toArtifact(f);
                      onActiveArtifactChange(artifact);
                      setLightboxSrc(artifact.url || buildUrl(artifactName(f)));
                    }}
                    style={{ cursor: 'zoom-in' }}
                  />
                </div>
                <div className={styles.plotCardFooter}>
                  <a
                    href={buildUrl(artifactName(f))}
                    download
                    className={styles.plotCardBtn}
                    onClick={() => onActiveArtifactChange(toArtifact(f))}
                  >
                    下载 PNG
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Files tab */}
        {tab === 'files' && (
          <div className={styles.fileCardGrid}>
            {tables.map((f) => (
              <div
                key={artifactName(f)}
                className={`${styles.fileCard} ${activeArtifact?.jobId === job.id && activeArtifact.name === artifactName(f) ? styles.fileCardActive : ''}`}
              >
                <div className={styles.fileCardIcon}>
                  <Icon name={f.type === 'table' ? 'database' : 'file'} size={26} />
                </div>
                <div className={styles.fileCardName}>{f.label || f.title || artifactName(f)}</div>
                <div className={styles.fileCardDesc}>{artifactName(f)}</div>
                <div className={styles.fileCardActions}>
                  <a
                    href={buildUrl(artifactName(f))}
                    download
                    className={styles.plotCardBtn}
                    onClick={() => onActiveArtifactChange(toArtifact(f))}
                  >
                    下载
                  </a>
                  {(f.preview !== false && /\.(csv|tsv|txt|log|json)$/i.test(artifactName(f))) && (
                    <button
                      className={styles.plotCardBtnPrimary}
                      onClick={() => previewFile(f)}
                    >
                      预览
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Details tab */}
        {tab === 'details' && (
          <div className={styles.jobDetails}>
            <section className={styles.jobDetailSection}>
              <h3>任务</h3>
              <dl>
                <div><dt>jobId</dt><dd>{job.id}</dd></div>
                <div><dt>toolId</dt><dd>{job.tool_id}</dd></div>
                <div><dt>version</dt><dd>{result?.tool?.version || '-'}</dd></div>
                <div><dt>language</dt><dd>{result?.tool?.language || tool?.language || '-'}</dd></div>
                <div><dt>status</dt><dd>{job.status}</dd></div>
                <div><dt>projectId</dt><dd>{jobMeta?.projectId || job.project_id || '-'}</dd></div>
                <div><dt>ackStatus</dt><dd>{jobMeta?.ackStatus || '-'}</dd></div>
              </dl>
            </section>
            <section className={styles.jobDetailSection}>
              <h3>参数</h3>
              <pre>{JSON.stringify(jobMeta?.params || {}, null, 2)}</pre>
            </section>
            <section className={styles.jobDetailSection}>
              <h3>输出</h3>
              <pre>{JSON.stringify(result?.artifacts || result?.outputs || result?.manifest || result?.files || [], null, 2)}</pre>
            </section>
            {(result?.stdout || job.error) && (
              <section className={styles.jobDetailSection}>
                <h3>日志</h3>
                <pre>{result?.stdout || job.error}</pre>
              </section>
            )}
          </div>
        )}

        {/* CSV preview */}
        {(previewData || previewText) && (
          <div className={styles.csvPreview}>
            <div className={styles.csvPreviewHeader}>
              <span>{previewName}</span>
              <button
                onClick={() => {
                  setPreviewData(null);
                  setPreviewText(null);
                }}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
            <div className={styles.csvPreviewBody}>
              {previewData ? (
                <table>
                  <tbody>
                    {previewData.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <pre className={styles.textPreview}>{previewText}</pre>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Phase 8: Chain recommendations — show next-step suggestions */}
      <ChainRecommendations job={job} resultFiles={result?.artifacts || result?.files} onAskAgent={onAskAgent} />

      {/* Lightbox */}
      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
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

  return (
    <div className={styles.terminalPanel}>
      <div className={styles.terminalPanelHead}>
        <div className={styles.terminalPanelTitleWrap}>
          <div className={styles.terminalPanelTitle}>后端</div>
          <div className={styles.terminalPanelMeta}>
            {project.workspacePath || '当前项目'} · {backendStatus.isReady ? '后端在线' : '后端检查中'}
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
        {(snapshot?.processes || []).map((proc) => (
          <details key={proc.id} className={styles.terminalProcessCard} open>
            <summary className={styles.terminalProcessSummary}>
              <span className={styles.terminalProcessName}>
                <span
                  className={styles.terminalProcessDot}
                  data-status={proc.status}
                />
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
        {!loading && snapshot && (snapshot.processes || []).length === 0 && (
          <div className={styles.panelEmpty}>没有可显示的后端状态</div>
        )}
      </div>
    </div>
  );
}

export function BrowserPanel({
  initialUrl,
  onUrlChange,
  obscured = false,
}: {
  initialUrl: string;
  onUrlChange: (url: string) => void;
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
    };
  }, [navigate, onUrlChange, startUrlRef]);

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
  onOpenTerminal,
  onOpenBrowser,
  onOpenFiles,
  onOpenChat,
}: {
  project: Project;
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
