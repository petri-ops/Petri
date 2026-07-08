// ============================================================
// ProjectWorkspace — UI-REFACTOR Phase3
// Three-column layout: left=resources, center=results+agent, right=history+tools
// Collapsible panels. Route: /project/:projectId
// ============================================================

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { getProject, listProjectJobs, listDatasetsByProject, listProjects } from '@/lib/project-store';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { tools as staticTools } from '@/pages/_data';
import { Lightbox } from '@/components/ui/Lightbox';
import { CopilotChat } from '@/components/copilot/CopilotChat';
import { setCopilotContext } from '@/lib/copilotContext';
import { getNextSteps, buildChainPrompt, type ResolvedJob } from '@/lib/workflow-chains';
import styles from './project-workspace.module.css';

export function ProjectWorkspace(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [jobs, setJobs] = useState<ToolJob[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Panel collapse state
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true); // file tree + results panel
  const [settingsOpen, setSettingsOpen] = useState(false); // settings sidebar overlay

  // Selected result tab
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Resizable panel dimensions
  const [leftWidth, setLeftWidth] = useState(220);
  const [rightWidth, setRightWidth] = useState(340);
  const [inputHeight, setInputHeight] = useState(120);
  const [rightTab, setRightTab] = useState<'files' | 'results'>('files');

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
        setLeftWidth(Math.max(160, Math.min(420, startLeft + ev.clientX - startX)));
      } else if (which === 'right') {
        setRightWidth(Math.max(240, Math.min(600, startRight - (ev.clientX - startX))));
      } else if (which === 'input') {
        setInputHeight(Math.max(60, Math.min(400, startInput - (ev.clientY - startY))));
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

  const switchToProject = useCallback((id: string) => {
    setSwitcherOpen(false);
    setSwitcherQuery('');
    if (id !== projectId) navigate(`/project/${id}`);
  }, [navigate, projectId]);

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
    fetchData();
    const id = setInterval(fetchData, 15_000);
    return () => clearInterval(id);
  }, [fetchData]);

  // 6.3 — Inject project context into CopilotChat
  useEffect(() => {
    if (!project) return;
    setCopilotContext({
      page: 'desktop-project',
      pageTitle: project.name,
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
    });
  }, [project, datasets, jobs, activeJobId]);

  const activeJob = useMemo(
    () => jobs.find((j) => j.id === activeJobId) || null,
    [jobs, activeJobId]
  );

  /** Dispatch a copilot-ask event so the embedded CopilotChat picks it up */
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
        <Link to="/" className={styles.backLink}>← 返回首页</Link>
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
                    to="/"
                    onClick={() => setSwitcherOpen(false)}
                  >
                    + 新建项目
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
        <div className={styles.headerRight}>
          <button
            className={styles.iconBtn}
            onClick={() => setLeftOpen((v) => !v)}
            title="切换资源栏"
          >
            <Icon name="panel-left" size={18} />
          </button>
          <button
            className={styles.iconBtn}
            onClick={() => setRightOpen((v) => !v)}
            title="切换结果栏"
          >
            <Icon name="panel-right" size={18} />
          </button>
          <button
            className={`${styles.iconBtn} ${settingsOpen ? styles.iconBtnActive : ''}`}
            onClick={() => setSettingsOpen((v) => !v)}
            title="设置 / 技能助手"
          >
            <Icon name="settings" size={18} />
          </button>
        </div>
      </header>

      <div className={styles.workspaceBody}>
        {/* Settings sidebar overlay — slides in from left */}
        {settingsOpen && (
          <>
            <div className={styles.settingsOverlay} onClick={() => setSettingsOpen(false)} />
            <aside className={styles.settingsSider}>
              <div className={styles.settingsSiderHeader}>
                <span className={styles.settingsSiderTitle}>设置</span>
                <button
                  className={styles.iconBtn}
                  onClick={() => setSettingsOpen(false)}
                  title="关闭"
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
              <ToolboxPanel onAskAgent={handleAskAgent} />
            </aside>
          </>
        )}

        {/* Left column — Resources */}
        {leftOpen && (
          <>
            <aside className={styles.leftCol} style={{ width: leftWidth }}>
              <ResourcePanel
                project={project}
                datasets={datasets}
                jobs={jobs}
                allProjects={allProjects}
                currentProjectId={projectId}
                onSwitchProject={switchToProject}
                onSelectJob={(id) => {
                  setActiveJobId(id);
                  setRightOpen(true);
                  setRightTab('results');
                }}
              />
            </aside>
            <div className={styles.resizeHandleV} onMouseDown={startResize('left')} />
          </>
        )}

        {/* Center column — Agent main interaction area */}
        <main className={styles.centerCol}>
          <div className={styles.agentMain}>
            <CopilotChat embedded inputHeight={inputHeight} />
          </div>
          <div className={styles.resizeHandleH} onMouseDown={startResize('input')} />
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
                    <RightFileTree project={project} />
                  ) : activeJob ? (
                    <ResultView job={activeJob} onAskAgent={handleAskAgent} />
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
        getApiPrefix() + `/files-tree?prefix=${encodeURIComponent(prefix)}`
      );
      const data = await resp.json();
      if (data.ok) return data.entries as FileEntry[];
    } catch { /* ignore */ }
    return [];
  }, []);

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
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom section — my projects (switchable) */}
      <div className={styles.leftBottomSection}>
        <div className={styles.leftBottomHeader}>
          <Icon name="layers" size={14} />
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
  depth = 0,
}: {
  entries: FileEntry[];
  prefix: string;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onFetchDir: (prefix: string) => Promise<FileEntry[]>;
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
}: {
  entry: FileEntry;
  fullPath: string;
  isExpanded: boolean;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onFetchDir: (prefix: string) => Promise<FileEntry[]>;
}): React.ReactElement {
  const [children, setChildren] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (isExpanded && entry.type === 'dir') {
      onFetchDir(fullPath).then(setChildren);
    }
  }, [isExpanded, entry.type, fullPath, onFetchDir]);

  const fileUrl = getApiPrefix() + '/files/' + encodeURIComponent(fullPath);

  return (
    <li className={styles.fileTreeNode}>
      <div
        className={styles.fileTreeRow}
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
            <a
              className={styles.fileTreeLink}
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {entry.name}
            </a>
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
          depth={depth + 1}
        />
      )}
    </li>
  );
}

// ============================================================
// RightFileTree — file tree for the right panel (current workspace)
// ============================================================

function RightFileTree({ project }: { project: Project }): React.ReactElement {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const fetchDir = useCallback(async (prefix: string) => {
    try {
      const resp = await fetch(
        getApiPrefix() + `/files-tree?prefix=${encodeURIComponent(prefix)}`
      );
      const data = await resp.json();
      if (data.ok) return data.entries as FileEntry[];
    } catch { /* ignore */ }
    return [];
  }, []);

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

  if (loading) {
    return <p className={styles.panelEmpty}>加载文件树…</p>;
  }

  if (tree.length === 0) {
    return <p className={styles.panelEmpty}>当前工作区暂无文件</p>;
  }

  return (
    <div className={styles.panelSection}>
      <FileTreeList
        entries={tree}
        prefix=""
        expandedDirs={expandedDirs}
        onToggleDir={toggleDir}
        onFetchDir={fetchDir}
        depth={0}
      />
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
  url?: string;
}

interface JobResult {
  files?: JobResultFile[];
  summary?: unknown;
}

function ResultView({ job, onAskAgent }: { job: ToolJob; onAskAgent: (prompt: string) => void }): React.ReactElement {
  const [result, setResult] = useState<JobResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'plots' | 'files'>('plots');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<string[][] | null>(null);
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

  // Fetch result when job is done
  useEffect(() => {
    if (job.status === 'done') {
      setLoading(true);
      setResult(null);
      (async () => {
        try {
          const token = getToken();
          const resp = await fetch(getApiPrefix(lang) + '/tools/status/' + job.id, {
            headers: token ? { Authorization: 'Bearer ' + token } : {},
          });
          const data = await resp.json();
          if (data.ok && data.result) {
            setResult(data.result);
          }
        } catch {
          // ignore
        } finally {
          setLoading(false);
        }
      })();
    } else {
      setResult(null);
    }
  }, [job.id, job.status, lang]);

  const files = result?.files || [];
  const plots = files.filter((f) => f.type === 'plot');
  const tables = files.filter((f) => f.type === 'table' || f.type === 'file' || f.type === 'text');

  const previewCsv = useCallback(
    async (name: string) => {
      try {
        const resp = await fetch(buildUrl(name));
        const text = await resp.text();
        const sep = text.includes('\t') ? '\t' : ',';
        const rows = text
          .split('\n')
          .filter((l) => l.trim())
          .slice(0, 20)
          .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setPreviewData(rows);
        setPreviewName(name);
      } catch {
        setPreviewData(null);
      }
    },
    [buildUrl]
  );

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
  if (!result || files.length === 0) {
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
        </div>

        {/* Plots tab */}
        {tab === 'plots' && (
          <div className={styles.plotCardGrid}>
            {plots.map((f, idx) => (
              <div key={f.name} className={styles.plotCard}>
                <div className={styles.plotCardHeader}>
                  <span className={styles.plotCardNum}>图{idx + 1}</span>
                  <span className={styles.plotCardLabel}>
                    {f.label || f.name.replace('.png', '')}
                  </span>
                </div>
                <div className={styles.plotCardImg}>
                  <img
                    src={buildUrl(f.name)}
                    alt={f.label || f.name}
                    onClick={() => setLightboxSrc(buildUrl(f.name))}
                    style={{ cursor: 'zoom-in' }}
                  />
                </div>
                <div className={styles.plotCardFooter}>
                  <a href={buildUrl(f.name)} download className={styles.plotCardBtn}>
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
              <div key={f.name} className={styles.fileCard}>
                <div className={styles.fileCardIcon}>
                  {f.type === 'table' ? '📋' : f.type === 'text' ? '📝' : '📦'}
                </div>
                <div className={styles.fileCardName}>{f.label || f.name}</div>
                <div className={styles.fileCardDesc}>{f.name}</div>
                <div className={styles.fileCardActions}>
                  <a href={buildUrl(f.name)} download className={styles.plotCardBtn}>
                    下载
                  </a>
                  {f.name.endsWith('.csv') && (
                    <button
                      className={styles.plotCardBtnPrimary}
                      onClick={() => previewCsv(f.name)}
                    >
                      预览
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CSV preview */}
        {previewData && (
          <div className={styles.csvPreview}>
            <div className={styles.csvPreviewHeader}>
              <span>{previewName}</span>
              <button onClick={() => setPreviewData(null)}>✕</button>
            </div>
            <div className={styles.csvPreviewBody}>
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
            </div>
          </div>
        )}
      </div>

      {/* Phase 8: Chain recommendations — show next-step suggestions */}
      <ChainRecommendations job={job} resultFiles={result?.files} onAskAgent={onAskAgent} />

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
      name: f.name,
      url: f.url || '',
      type: f.type,
      label: f.label,
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
