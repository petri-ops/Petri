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
import { Icon } from '@/components/icons/Icon';
import { getProject, listProjectJobs, listDatasetsByProject, listProjects, updateProject, createProject } from '@/lib/project-store';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { tools as staticTools } from '@/pages/_data';
import { Lightbox } from '@/components/ui/Lightbox';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import { listConversations, createConversation, type ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import { setCopilotContext } from '@/lib/copilotContext';
import { getNextSteps, buildChainPrompt, type ResolvedJob } from '@/lib/workflow-chains';
import { PluginStorePanel } from '@/components/desktop/PluginStorePanel';
import { DesktopSettingsPanel } from '@/components/desktop/DesktopSettingsPanel';
import { DesktopDashboard } from '@/pages/_desktop-dashboard';
import ToolsPage from '@/pages/tools';
import FigCodePage from '@/pages/figcode';
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

type WorkspaceMode =
  | 'cloud'
  | 'chat'
  | 'search'
  | 'scheduled'
  | 'tools'
  | 'figcode'
  | 'plugins'
  | 'settings';

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

  // Conversation state — current project's conversations + active conversation
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set([projectId || '']));
  const [creatingProjectInline, setCreatingProjectInline] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingConversationFor, setCreatingConversationFor] = useState<string | null>(null);
  const [newConversationTitle, setNewConversationTitle] = useState('');
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState('');
  const [searchConversationIndex, setSearchConversationIndex] = useState<Record<string, ConversationSummary[]>>({});

  // Resizable panel dimensions
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(340);
  const [inputHeight, setInputHeight] = useState(120);
  const [rightTab, setRightTab] = useState<'files' | 'results'>('files');

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
    const nextMode = parseWorkspaceMode(searchParams.get('mode')) || 'chat';
    setWorkspaceMode((current) => (current === nextMode ? current : nextMode));
  }, [searchParams]);

  const updateWorkspaceMode = useCallback((nextMode: WorkspaceMode, replace = true) => {
    setWorkspaceMode(nextMode);
    const nextParams = new URLSearchParams(searchParams);
    if (nextMode === 'chat') nextParams.delete('mode');
    else nextParams.set('mode', nextMode);
    setSearchParams(nextParams, { replace });
  }, [searchParams, setSearchParams]);

  const toggleLeftPanel = useCallback(() => {
    setLeftOpen((open) => {
      const next = !open;
      if (next && compactLayout) setRightOpen(false);
      return next;
    });
  }, [compactLayout]);

  const toggleRightPanel = useCallback(() => {
    setRightOpen((open) => {
      const next = !open;
      if (next && compactLayout) setLeftOpen(false);
      return next;
    });
  }, [compactLayout]);

  const openRightPanel = useCallback((tab: 'files' | 'results') => {
    if (compactLayout) setLeftOpen(false);
    setRightTab(tab);
    setRightOpen(true);
  }, [compactLayout]);

  // Drag-to-resize handler factory
  const startResize = useCallback((which: 'left' | 'right' | 'input') => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = leftWidth;
    const startRight = rightWidth;
    const startInput = inputHeight;

    const onMove = (ev: MouseEvent) => {
      if (which === 'left') {
        setLeftWidth(Math.max(96, startLeft + ev.clientX - startX));
      } else if (which === 'right') {
        setRightWidth(Math.max(96, startRight - (ev.clientX - startX)));
      } else if (which === 'input') {
        setInputHeight(Math.max(48, startInput - (ev.clientY - startY)));
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = which === 'input' ? 'ns-resize' : 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [leftWidth, rightWidth, inputHeight]);

  // 4.5 — Project switcher dropdown
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherQuery, setSwitcherQuery] = useState('');

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

  const filteredProjects = useMemo(() => {
    const q = switcherQuery.trim().toLowerCase();
    if (!q) return allProjects;
    return allProjects.filter((p) => p.name.toLowerCase().includes(q));
  }, [allProjects, switcherQuery]);

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
    setSwitcherOpen(false);
    setSwitcherQuery('');
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

  // Load conversations for current project
  const refreshConversations = useCallback(async () => {
    if (!projectId) return;
    const list = await listConversations('active', projectId);
    setConversations(list);
    // Auto-select most recent conversation if none active
    if (!activeConvId && list.length > 0) {
      setActiveConvId(list[0].id);
    }
  }, [projectId]);

  useEffect(() => {
    setActiveConvId(null);
    setConversations([]);
    refreshConversations();
  }, [refreshConversations]);

  // Create new conversation in current project
  const handleNewConversation = useCallback(async (targetProjectId = projectId) => {
    if (!targetProjectId) return;
    updateWorkspaceMode('chat');
    const conv = await createConversation('新对话', undefined, targetProjectId);
    if (conv) {
      if (targetProjectId === projectId) {
        setActiveConvId(conv.id);
        refreshConversations();
      } else {
        setProjectConversations((prev) => ({
          ...prev,
          [targetProjectId]: [conv, ...(prev[targetProjectId] || [])],
        }));
        navigate(`/project/${targetProjectId}`);
      }
    }
  }, [projectId, refreshConversations, navigate, updateWorkspaceMode]);

  // Switch conversation
  const handleSwitchConversation = useCallback((convId: string) => {
    updateWorkspaceMode('chat');
    setActiveConvId(convId);
  }, [updateWorkspaceMode]);

  const handleShowCloud = useCallback(() => updateWorkspaceMode('cloud'), [updateWorkspaceMode]);
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
    if (compactLayout) setLeftOpen(true);
  }, [compactLayout]);

  const submitProjectCreator = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name || creatingProject) return;
    setCreatingProject(true);
    try {
      const created = await createProject({
        name,
        description: newProjectDesc.trim() || undefined,
        modality: 'general',
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
      navigate(`/project/${created.id}`);
    } finally {
      setCreatingProject(false);
    }
  }, [creatingProject, navigate, newProjectDesc, newProjectName]);

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
        setProjectConversations((prev) => ({
          ...prev,
          [targetProjectId]: [conv, ...(prev[targetProjectId] || [])],
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

  // Load conversations for other projects when expanded
  const [projectConversations, setProjectConversations] = useState<Record<string, ConversationSummary[]>>({});
  useEffect(() => {
    expandedProjects.forEach((pid) => {
      if (pid === projectId) return; // current project uses `conversations`
      if (projectConversations[pid]) return; // already loaded
      listConversations('active', pid).then((list) => {
        setProjectConversations((prev) => ({ ...prev, [pid]: list }));
      });
    });
  }, [expandedProjects, projectId, projectConversations]);

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
    const selected = await window.biof3Desktop?.files?.openDirectoryDialog?.();
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
  }, [projectId]);

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
    window.addEventListener('biof3:soft-refresh', handler);
    return () => window.removeEventListener('biof3:soft-refresh', handler);
  }, [fetchData, refreshConversations]);

  useEffect(() => {
    if (workspaceMode === 'search') {
      ensureSearchConversationIndex().catch(() => {});
    }
  }, [ensureSearchConversationIndex, workspaceMode]);

  // 6.3 — Inject project context into SimpleChat (via shared copilot context)
  useEffect(() => {
    if (!project) return;
    setCopilotContext({
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
    });
  }, [project, projectId, datasets, jobs, activeJobId, activeArtifact]);

  useEffect(() => {
    setActiveArtifact(null);
  }, [activeJobId]);

  const activeJob = useMemo(
    () => jobs.find((j) => j.id === activeJobId) || null,
    [jobs, activeJobId]
  );

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
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ toolJobId?: string }>).detail;
      if (detail && detail.toolJobId) {
        handleOpenResult(detail.toolJobId);
      }
    };
    window.addEventListener('biof3:project-open-result', handler);
    return () => window.removeEventListener('biof3:project-open-result', handler);
  }, [handleOpenResult]);

  /** Dispatch a copilot-ask event so the embedded SimpleChat picks it up */
  const handleAskAgent = useCallback((prompt: string) => {
    window.dispatchEvent(new CustomEvent('biof3:copilot-ask', { detail: { prompt } }));
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

  return (
    <div className={styles.workspaceRoot}>
      {/* Header bar */}
      <header className={styles.workspaceHeader}>
        <div className={styles.headerLeft}>
          <button
            className={styles.iconBtn}
            onClick={() => navigate('/')}
            title="返回首页"
          >
            <Icon name="arrow-left" size={18} />
          </button>
          <h1 className={styles.projectTitle}>{project.name}</h1>
          {project.modality && (
            <span className={styles.modalityBadge}>{project.modality}</span>
          )}
          {/* 4.5 — Project switcher dropdown */}
          <div className={styles.switcherWrap}>
            <button
              className={styles.switcherBtn}
              onClick={() => setSwitcherOpen((v) => !v)}
              title="切换项目"
            >
              <Icon name="chevron-down" size={14} />
            </button>
            {switcherOpen && (
              <>
                <div className={styles.switcherOverlay} onClick={() => setSwitcherOpen(false)} />
                <div className={styles.switcherDropdown}>
                  <input
                    className={styles.switcherSearch}
                    placeholder="搜索项目…"
                    value={switcherQuery}
                    onChange={(e) => setSwitcherQuery(e.target.value)}
                    autoFocus
                  />
                  <div className={styles.switcherList}>
                    {filteredProjects.length === 0 ? (
                      <div className={styles.switcherEmpty}>无匹配项目</div>
                    ) : (
                      filteredProjects.map((p) => (
                        <button
                          key={p.id}
                          className={`${styles.switcherItem} ${p.id === projectId ? styles.switcherItemActive : ''}`}
                          onClick={() => switchToProject(p.id)}
                        >
                          <span className={styles.switcherItemName}>{p.name}</span>
                          {p.modality && (
                            <span className={styles.switcherItemBadge}>{p.modality}</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  <Link
                    className={styles.switcherNewProject}
                    to="#"
                    onClick={(event) => {
                      event.preventDefault();
                      setSwitcherOpen(false);
                      openProjectCreator();
                    }}
                  >
                    + 新建项目
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
        <div className={styles.workspacePathBar} title={workspacePath || undefined}>
          <Icon name="folder" size={14} />
          <span className={styles.workspacePathLabel}>Workspace</span>
          <button
            className={styles.workspacePathText}
            onClick={handleOpenWorkspacePath}
            disabled={!workspacePath}
            title={workspacePath ? '在 Finder 中打开工作目录' : '工作目录初始化中'}
          >
            {compactWorkspacePath}
          </button>
          <button
            className={styles.workspacePathAction}
            onClick={handleChangeWorkspacePath}
            title="更改项目工作目录"
          >
            更改
          </button>
          {workspaceNotice && <span className={styles.workspacePathNotice}>{workspaceNotice}</span>}
        </div>
        <div className={styles.headerRight}>
          <button
            className={styles.iconBtn}
            onClick={toggleLeftPanel}
            title="切换资源栏"
          >
            <Icon name="panel-left" size={18} />
          </button>
          <button
            className={styles.iconBtn}
            onClick={toggleRightPanel}
            title="切换结果栏"
          >
            <Icon name="panel-right" size={18} />
          </button>
          <button
            className={`${styles.iconBtn} ${workspaceMode === 'settings' ? styles.iconBtnActive : ''}`}
            onClick={handleShowSettings}
            title="设置"
          >
            <Icon name="settings" size={18} />
          </button>
        </div>
      </header>

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
            <aside className={styles.leftCol} style={{ width: leftWidth }}>
              <div className={styles.leftPanelWrap}>
                <div className={styles.leftQuickActions}>
                  <div className={styles.leftQuickSectionLabel}>工作台</div>
                  <button
                    className={`${styles.leftQuickAction} ${workspaceMode === 'cloud' ? styles.leftQuickActionActive : ''}`}
                    onClick={handleShowCloud}
                    title="云平台"
                  >
                    <Icon name="layout-grid" size={15} />
                    <span>云平台</span>
                  </button>
                  <button
                    className={`${styles.leftQuickAction} ${workspaceMode === 'chat' ? styles.leftQuickActionActive : ''}`}
                    onClick={() => openConversationCreator()}
                    title="新对话"
                  >
                    <Icon name="plus" size={15} />
                    <span>新对话</span>
                  </button>
                  <button
                    className={`${styles.leftQuickAction} ${workspaceMode === 'search' ? styles.leftQuickActionActive : ''}`}
                    onClick={handleShowSearch}
                    title="搜索项目"
                  >
                    <Icon name="search" size={15} />
                    <span>搜索</span>
                  </button>
                  <button
                    className={`${styles.leftQuickAction} ${workspaceMode === 'scheduled' ? styles.leftQuickActionActive : ''}`}
                    onClick={handleShowScheduled}
                    title="查看已安排/运行记录"
                  >
                    <Icon name="clock" size={15} />
                    <span>已安排</span>
                  </button>
                  <button
                    className={`${styles.leftQuickAction} ${workspaceMode === 'tools' ? styles.leftQuickActionActive : ''}`}
                    onClick={handleShowTools}
                    title="分析工具"
                  >
                    <Icon name="bar-chart" size={15} />
                    <span>分析工具</span>
                  </button>
                  <button
                    className={`${styles.leftQuickAction} ${workspaceMode === 'figcode' ? styles.leftQuickActionActive : ''}`}
                    onClick={handleShowFigCode}
                    title="FigCode"
                  >
                    <Icon name="image" size={15} />
                    <span>FigCode</span>
                  </button>
                  <button
                    className={`${styles.leftQuickAction} ${workspaceMode === 'plugins' ? styles.leftQuickActionActive : ''}`}
                    onClick={handleShowPlugins}
                    title="插件"
                  >
                    <Icon name="puzzle" size={15} />
                    <span>插件</span>
                  </button>
                  <button
                    className={`${styles.leftQuickAction} ${workspaceMode === 'settings' ? styles.leftQuickActionActive : ''}`}
                    onClick={handleShowSettings}
                    title="设置"
                  >
                    <Icon name="settings" size={15} />
                    <span>设置</span>
                  </button>
                </div>
                <div className={styles.leftPanelHeader}>
                  <span className={styles.leftPanelTitle}>项目</span>
                  <button
                    className={styles.iconBtn}
                    onClick={openProjectCreator}
                    title="新建项目"
                  >
                    <Icon name="plus" size={16} />
                  </button>
                </div>
                <div className={styles.projectTreeScroll}>
                  {creatingProjectInline && (
                    <div className={styles.inlineCreateCard}>
                      <input
                        className={styles.inlineCreateInput}
                        placeholder="项目名称"
                        value={newProjectName}
                        onChange={(event) => setNewProjectName(event.target.value)}
                        autoFocus
                      />
                      <textarea
                        className={styles.inlineCreateTextarea}
                        placeholder="项目描述（可选）"
                        value={newProjectDesc}
                        onChange={(event) => setNewProjectDesc(event.target.value)}
                        rows={3}
                      />
                      <div className={styles.inlineCreateActions}>
                        <button
                          className={styles.inlineCreateBtn}
                          onClick={() => {
                            setCreatingProjectInline(false);
                            setNewProjectName('');
                            setNewProjectDesc('');
                          }}
                          disabled={creatingProject}
                        >
                          取消
                        </button>
                        <button
                          className={`${styles.inlineCreateBtn} ${styles.inlineCreateBtnPrimary}`}
                          onClick={submitProjectCreator}
                          disabled={creatingProject || !newProjectName.trim()}
                        >
                          {creatingProject ? '创建中…' : '创建项目'}
                        </button>
                      </div>
                    </div>
                  )}
                  {allProjects.map((p) => {
                    const isCurrent = p.id === projectId;
                    const isExpanded = expandedProjects.has(p.id);
                    const convs = isCurrent ? conversations : (projectConversations[p.id] || []);
                    return (
                      <div key={p.id} className={styles.projectTreeNode}>
                        <div
                          className={`${styles.projectTreeRow} ${isCurrent ? styles.projectTreeRowActive : ''}`}
                          onClick={() => {
                            if (!isCurrent) switchToProject(p.id);
                            toggleProjectExpand(p.id);
                          }}
                        >
                          <Icon
                            name={isExpanded ? 'chevron-down' : 'chevron-right'}
                            size={12}
                          />
                          <Icon name="folder" size={14} />
                          <span className={styles.projectTreeName}>{p.name}</span>
                          <button
                            className={styles.projectTreeAddBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              openConversationCreator(p.id);
                            }}
                            title="新建对话"
                          >
                            <Icon name="plus" size={12} />
                          </button>
                        </div>
                        {isExpanded && (
                          <ul className={styles.convList}>
                            {creatingConversationFor === p.id && (
                              <li className={styles.convCreateItem}>
                                <input
                                  className={styles.convCreateInput}
                                  placeholder="对话标题（可选）"
                                  value={newConversationTitle}
                                  onChange={(event) => setNewConversationTitle(event.target.value)}
                                  autoFocus
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      submitConversationCreator(p.id);
                                    }
                                    if (event.key === 'Escape') {
                                      setCreatingConversationFor(null);
                                      setNewConversationTitle('');
                                    }
                                  }}
                                />
                                <div className={styles.convCreateActions}>
                                  <button
                                    className={styles.convCreateBtn}
                                    onClick={() => {
                                      setCreatingConversationFor(null);
                                      setNewConversationTitle('');
                                    }}
                                    disabled={creatingConversation}
                                  >
                                    取消
                                  </button>
                                  <button
                                    className={`${styles.convCreateBtn} ${styles.convCreateBtnPrimary}`}
                                    onClick={() => submitConversationCreator(p.id)}
                                    disabled={creatingConversation}
                                  >
                                    {creatingConversation ? '创建中…' : '创建'}
                                  </button>
                                </div>
                              </li>
                            )}
                            {convs.length === 0 && (
                              <li className={styles.convEmpty}>暂无对话</li>
                            )}
                            {convs.map((c) => (
                              <li
                                key={c.id}
                                className={`${styles.convItem} ${isCurrent && c.id === activeConvId ? styles.convItemActive : ''}`}
                                onClick={() => {
                                  if (!isCurrent) switchToProject(p.id);
                                  handleSwitchConversation(c.id);
                                }}
                                title={c.title}
                              >
                                <Icon name="message-circle" size={12} />
                                <span className={styles.convItemTitle}>{c.title}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </aside>
            <div className={styles.resizeHandleV} onMouseDown={startResize('left')} />
          </>
        )}

        {/* Center column — Simple chat (conversation-driven) */}
        <main className={styles.centerCol}>
          {workspaceMode === 'cloud' && (
            <div className={styles.workspaceEmbeddedPage}>
              <DesktopDashboard embedded activeProject={project} />
            </div>
          )}
          {workspaceMode === 'search' && (
            <WorkspaceSearchPanel
              query={workspaceSearchQuery}
              onQueryChange={setWorkspaceSearchQuery}
              projects={allProjects}
              currentProjectId={projectId || ''}
              conversations={Object.entries({
                ...searchConversationIndex,
                ...projectConversations,
                ...(projectId ? { [projectId]: conversations } : {}),
              }).flatMap(([pid, list]) => list.map((item) => ({ ...item, project_id: item.project_id || pid })))}
              jobs={jobs}
              datasets={datasets}
              onOpenProject={(id) => {
                switchToProject(id);
                updateWorkspaceMode('chat');
              }}
              onOpenConversation={(pid, convId) => {
                if (pid && pid !== projectId) {
                  navigate(`/project/${pid}`);
                }
                updateWorkspaceMode('chat');
                setActiveConvId(convId);
              }}
              onOpenScheduled={(jobId) => {
                setActiveJobId(jobId);
                updateWorkspaceMode('scheduled');
                openRightPanel('results');
              }}
              onOpenTools={handleShowTools}
              onOpenFigCode={handleShowFigCode}
              onOpenPlugins={handleShowPlugins}
            />
          )}
          {workspaceMode === 'chat' && (
            <>
              <div className={styles.agentMain}>
                {project && projectId && (
                  <SimpleChat
                    projectId={projectId}
                    conversationId={activeConvId}
                    onConversationChange={setActiveConvId}
                    onOpenResult={handleOpenResult}
                    inputHeight={inputHeight}
                  />
                )}
              </div>
              <div className={styles.resizeHandleH} onMouseDown={startResize('input')} />
            </>
          )}
          {workspaceMode === 'scheduled' && (
            <ScheduledWorkspacePanel
              project={project}
              jobs={jobs}
              activeJobId={activeJobId}
              activeArtifact={activeArtifact}
              onSelectJob={(jobId) => {
                setActiveJobId(jobId);
                openRightPanel('results');
              }}
              onActiveArtifactChange={setActiveArtifact}
              onAskAgent={handleAskAgent}
              onBackToChat={() => updateWorkspaceMode('chat')}
            />
          )}
          {workspaceMode === 'tools' && (
            <div className={styles.workspaceEmbeddedPage}>
              <ToolsPage />
            </div>
          )}
          {workspaceMode === 'figcode' && (
            <div className={styles.workspaceEmbeddedPage}>
              <FigCodePage />
            </div>
          )}
          {workspaceMode === 'plugins' && (
            <div className={styles.workspaceModeSurface}>
              <PluginStorePanel onClose={() => updateWorkspaceMode('chat')} />
            </div>
          )}
          {workspaceMode === 'settings' && (
            <div className={styles.workspaceModeSurface}>
              <DesktopSettingsPanel onClose={() => updateWorkspaceMode('chat')} />
            </div>
          )}
        </main>

        {/* Right column — File tree + Results panel */}
        {rightOpen && (
          <>
            <div className={styles.resizeHandleV} onMouseDown={startResize('right')} />
            <aside className={styles.rightCol} style={{ width: rightWidth }}>
              <div className={styles.resultPanel}>
                {/* Tab switcher: files / results */}
                <div className={styles.resultPanelHeader}>
                  <div className={styles.rightTabBar}>
                    <button
                      className={`${styles.rightTabBtn} ${rightTab === 'files' ? styles.rightTabBtnActive : ''}`}
                      onClick={() => setRightTab('files')}
                    >
                      <Icon name="folder" size={14} /> 文件
                    </button>
                    <button
                      className={`${styles.rightTabBtn} ${rightTab === 'results' ? styles.rightTabBtnActive : ''}`}
                      onClick={() => setRightTab('results')}
                    >
                      <Icon name="bar-chart" size={14} /> 结果
                    </button>
                  </div>
                  <button
                    className={styles.iconBtn}
                    onClick={() => setRightOpen(false)}
                    title="收起面板"
                  >
                    <Icon name="x" size={16} />
                  </button>
                </div>
                <div className={styles.resultPanelBody}>
                  {rightTab === 'files' ? (
                    <RightFileTree
                      project={project}
                      openFiles={openWorkspaceFiles}
                      activeFile={activeWorkspaceFile}
                      onOpenFile={handleOpenWorkspaceFile}
                      onSelectFile={setActiveWorkspaceFile}
                      onCloseFile={handleCloseWorkspaceFile}
                    />
                  ) : activeJob ? (
                    <ResultView
                      job={activeJob}
                      activeArtifact={activeArtifact}
                      onActiveArtifactChange={setActiveArtifact}
                      onAskAgent={handleAskAgent}
                    />
                  ) : (
                    <EmptyResult project={project} />
                  )}
                </div>
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ResourcePanel — left column (Phase4: file tree + datasets + storage)
// ============================================================

interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  size?: number;
  mtime?: number;
}

function ResourcePanel({
  project,
  datasets,
  jobs,
  onSelectJob,
  allProjects,
  currentProjectId,
  onSwitchProject,
}: {
  project: Project;
  datasets: Dataset[];
  jobs: ToolJob[];
  onSelectJob: (id: string) => void;
  allProjects: Project[];
  currentProjectId: string;
  onSwitchProject: (id: string) => void;
}): React.ReactElement {
  const [fileTree, setFileTree] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [storageBytes, setStorageBytes] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'datasets' | 'files'>('datasets');

  // Fetch storage usage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(getApiPrefix() + '/storage-usage');
        const data = await resp.json();
        if (!cancelled && data.ok) setStorageBytes(data.totalBytes || 0);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch file tree (root level)
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
    if (activeTab === 'files') fetchDir('').then(setFileTree);
  }, [activeTab, fetchDir]);

  const toggleDir = useCallback(async (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);

  return (
    <div className={styles.leftPanelWrap}>
      {/* Top section — datasets / files */}
      <div className={styles.leftTopSection}>
        <div className={styles.leftMiniTabBar}>
          <button
            className={`${styles.leftMiniTab} ${activeTab === 'datasets' ? styles.leftMiniTabActive : ''}`}
            onClick={() => setActiveTab('datasets')}
          >
            <Icon name="database" size={13} /> 数据集
          </button>
          <button
            className={`${styles.leftMiniTab} ${activeTab === 'files' ? styles.leftMiniTabActive : ''}`}
            onClick={() => setActiveTab('files')}
          >
            <Icon name="folder" size={13} /> 文件
          </button>
        </div>
        <div className={styles.leftTopContent}>
          {activeTab === 'datasets' && (
            <div className={styles.panelSection}>
              {datasets.length === 0 ? (
                <p className={styles.panelEmpty}>暂无数据集</p>
              ) : (
                <ul className={styles.itemList}>
                  {datasets.map((d) => (
                    <li key={d.id} className={styles.itemRow}>
                      <Icon name="file" size={14} />
                      <div className={styles.itemMeta}>
                        <span className={styles.itemName}>{d.name}</span>
                        <span className={styles.itemSub}>
                          {d.nCells ? `${d.nCells} cells · ` : ''}
                          {formatSize(d.size)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {activeTab === 'files' && (
            <div className={styles.panelSection}>
              {fileTree.length === 0 ? (
                <p className={styles.panelEmpty}>暂无文件</p>
              ) : (
                <FileTreeList
                  entries={fileTree}
                  prefix=""
                  expandedDirs={expandedDirs}
                  onToggleDir={toggleDir}
                  onFetchDir={fetchDir}
                  fileUrlFor={(path) =>
                    getApiPrefix() + `/workspaces/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(path)}`
                  }
                  onOpenFile={() => {}}
                  activePath={null}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom section — my projects (switchable) */}
      <div className={styles.leftBottomSection}>
        <div className={styles.leftBottomHeader}>
          <Icon name="folder" size={14} />
          <span>我的项目</span>
        </div>
        <div className={styles.projectListBody}>
          {allProjects.length === 0 ? (
            <p className={styles.panelEmpty}>暂无项目</p>
          ) : (
            <ul className={styles.projectList}>
              {allProjects.map((p) => (
                <li
                  key={p.id}
                  className={`${styles.projectItem} ${p.id === currentProjectId ? styles.projectItemActive : ''}`}
                  onClick={() => onSwitchProject(p.id)}
                  title={p.description || p.name}
                >
                  <Icon name="folder" size={14} />
                  <div className={styles.projectItemMeta}>
                    <span className={styles.projectItemName}>{p.name}</span>
                    {p.modality && (
                      <span className={styles.projectItemSub}>{p.modality}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// FileTreeList — recursive file tree rendering
// ============================================================

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

function RightFileTree({
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
  const [treeOpen, setTreeOpen] = useState(!activeFile);
  const [treeWidth, setTreeWidth] = useState(320);

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
    setTreeOpen(false);
  }, [onOpenFile]);

  useEffect(() => {
    if (!activeFile && openFiles.length === 0) setTreeOpen(true);
  }, [activeFile, openFiles.length]);

  const startTreeResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = treeWidth;
    const onMove = (moveEvent: MouseEvent) => {
      setTreeWidth(Math.max(96, startWidth - (moveEvent.clientX - startX)));
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
        {treeOpen && (
          <div className={styles.workspaceFileTreePopover} style={{ width: treeWidth }}>
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
          </div>
        )}
      </div>
      <div className={styles.workspaceFilesMain}>
        <WorkspaceFilePreview file={activeFile} />
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

function WorkspaceSearchPanel({
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

function ScheduledWorkspacePanel({
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

/** Minimal remote plugin info (mirrors PluginStorePanel / electron.d.ts) */
interface RemotePluginInfo {
  title?: string;
  version?: string;
  language?: string;
  size?: number;
  description?: string;
  type?: string;
  figcodeCardId?: string;
  dependencies?: string[];
  optional?: boolean;
}

interface InstalledPluginInfo {
  id: string;
  version: string;
  installedAt?: string;
  type?: string;
  language?: string;
}

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

  // --- Plugin state ---
  const [installed, setInstalled] = useState<InstalledPluginInfo[]>([]);
  const [remotePlugins, setRemotePlugins] = useState<Record<string, RemotePluginInfo>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [pluginLoaded, setPluginLoaded] = useState(false);

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
    if (tab !== 'plugins' || pluginLoaded) return;
    loadPlugins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadPlugins() {
    if (!window.biof3Desktop?.plugins) return;
    setPluginError(null);
    try {
      const [inst, rem] = await Promise.all([
        window.biof3Desktop.plugins.listInstalled(),
        window.biof3Desktop.plugins.listRemote(),
      ]);
      setInstalled(inst);
      setRemotePlugins(rem.plugins ?? {});
      setPluginLoaded(true);
    } catch (e) {
      setPluginError(e instanceof Error ? e.message : '加载插件失败');
    }
  }

  async function handleInstall(pluginId: string) {
    if (!window.biof3Desktop?.plugins) return;
    setInstalling(pluginId);
    setPluginError(null);
    try {
      const result = await window.biof3Desktop.plugins.install(pluginId);
      if (result.ok) {
        await loadPlugins();
      } else {
        setPluginError(result.error || '安装失败');
      }
    } catch (e) {
      setPluginError(e instanceof Error ? e.message : '安装失败');
    } finally {
      setInstalling(null);
    }
  }

  async function handleUninstall(pluginId: string) {
    if (!window.biof3Desktop?.plugins) return;
    if (!confirm(`确定卸载插件「${pluginId}」？`)) return;
    setUninstalling(pluginId);
    setPluginError(null);
    try {
      const result = await window.biof3Desktop.plugins.uninstall(pluginId);
      if (result.ok) {
        await loadPlugins();
      } else {
        setPluginError(result.error || '卸载失败');
      }
    } catch (e) {
      setPluginError(e instanceof Error ? e.message : '卸载失败');
    } finally {
      setUninstalling(null);
    }
  }

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

function ResultView({
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

function EmptyResult({ project }: { project: Project }): React.ReactElement {
  return (
    <div className={styles.emptyResult}>
      <div className={styles.emptyResultIcon}>
        <Icon name="zap" size={48} />
      </div>
      <h2 className={styles.emptyResultTitle}>开始分析</h2>
      <p className={styles.emptyResultDesc}>
        在右侧历史栏选择分析结果，或通过底部 Agent 对话框启动新分析。
      </p>
      <p className={styles.emptyResultProject}>当前项目：{project.name}</p>
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
