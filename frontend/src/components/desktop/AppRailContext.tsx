/**
 * AppRailContext — UI-341 加映三（档 2）：左栏上提为应用级壳层的单一真相源。
 *
 * 为什么要有它：左栏此前挂在 ProjectWorkspace 内部，于是「有没有左栏」被绑在
 * 「是不是 /project/:id/* 路由」上——点了 Skills / 知识空间 / 后端 / 新建任务
 * 跳出工作区，左栏整个消失（用户实测反馈）。档 2 把左栏提升到 App 壳层，
 * 数据与动作随之成为应用级状态：
 *
 *  - **数据**：项目列表、项目树展开态、当前项目会话、跨项目会话、当前会话 id、
 *    创建态/错误态。
 *  - **布局**：左右栏宽 + 底栏高度（useResizableColumns 单实例，写
 *    document.documentElement 的 --gewu-live-* 变量，供壳层与工作区共读）。
 *  - **动作**：项目/会话的建、改名、归档、分支、切换，SSH 五连。
 *  - **副作用适配槽（adapter）**：少数动作需要「工作区在场时才成立」的效果
 *    （切会话时清 job/artifact、建会话时切到 chat 模式、项目改名时刷新工作区
 *    project 详情）。工作区挂载时注册 adapter，卸载后动作自动降级为纯数据行为
 *    ——单一真相仍在壳层，不复制第二份状态。
 *
 * 右栏（结果/文件/审阅/浏览器/模型 I/O）与底部终端**不上提**：它们强依赖当前
 * 工作区上下文，在没有项目的全局页上只会是空壳（判据：「没有项目时它是什么样」）。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStartupTimeline, markDataReady } from '@/hooks/useStartupTimeline';
import type { ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import {
  archiveConversation as archiveConversationREST,
  createConversation as createConversationREST,
  forkConversation as forkConversationREST,
  renameConversation as renameConversationREST,
} from '@/components/copilot/copilotConversationsClient';
import { useToast } from '@/components/common/ToastProvider';
import {
  connectSshHost,
  createProject,
  listProjects,
  listSshRemoteDirs,
  setProjectStatus,
  updateProject,
  validateSshProject,
} from '@/lib/project-store';
import type { Project } from '@/lib/project-types';
import { useConversations, useOtherConversations } from '@/hooks/useConversations';
import { useProjectTreeState } from '@/pages/project-workspace/useProjectTreeState';
import { useResizableColumns } from '@/hooks/useResizableColumns';
import { gewuEvents, subscribeGewuEvent , dispatchGewuEvent } from '@/lib/events';
import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';

/** 工作区在场时才成立的副作用（工作区挂载时注册，卸载即摘除）。 */
export interface WorkspaceAdapter {
  /** 切到某工作区模式（工作区的 URL 段导航）。 */
  updateWorkspaceMode: (mode: WorkspaceMode) => void;
  /** 会话切换/切换前的 job·artifact 上下文清理。 */
  clearConversationContext: () => void;
  /** 项目改名后刷新工作区里的 project 详情。 */
  onProjectRenamed: (next: Project) => void;
  /** 工作区内的轻提示（避免额外 toast）。 */
  notify: (message: string) => void;
  /** 原生目录选择创建项目时的错误出口。 */
  reportCreateError: (message: string) => void;
}

export interface AppRailState {
  // ── 项目 / 会话数据 ──
  allProjects: Project[];
  setAllProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  refreshProjects: () => Promise<void>;
  /** 当前路由所在项目（全局页为 null）。 */
  currentProjectId: string | null;
  currentProject: Project | null;
  expandedProjects: Set<string>;
  toggleProjectExpand: (id: string) => void;
  expandProject: (id: string) => void;
  conversations: ConversationSummary[];
  refreshConversations: () => Promise<void> | void;
  activeConvId: string | null;
  setActiveConvId: React.Dispatch<React.SetStateAction<string | null>>;
  projectConversations: Record<string, ConversationSummary[]>;
  refreshOtherConversations: () => Promise<void> | void;
  creatingProject: boolean;
  creatingConversation: boolean;
  createError: string;
  setCreateError: (message: string) => void;
  /** useConversations 原始结果（工作区消费 create/fork/loading）。 */
  conversationsApi: ReturnType<typeof useConversations>;
  /** useProjectTreeState 原始结果（工作区消费搜索态）。 */
  treeState: ReturnType<typeof useProjectTreeState>;

  // ── 布局尺寸（单实例，壳层与工作区共读）──
  /** useResizableColumns 完整状态（resultRightWidth/inputHeight 等由工作区消费）。 */
  resizable: ReturnType<typeof useResizableColumns>;
  leftWidth: number;
  rightWidth: number;
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  bottomTerminalHeight: number;
  startColumnResize: (which: 'left' | 'right' | 'resultRight' | 'input') => (event: React.MouseEvent) => void;
  startBottomTerminalResize: (event: React.MouseEvent, opts?: { min?: number; max?: number }) => void;

  // ── 动作 ──
  switchToProject: (id: string) => void;
  switchConversation: (id: string) => void;
  createConversationForProject: (projectId?: string) => Promise<void>;
  openCreatePanel: () => Promise<void>;
  createProjectFromPath: (selected: string) => Promise<void>;
  renameProjectInTree: (projectId: string, name: string) => Promise<boolean>;
  renameConversationInTree: (conversationId: string, title: string) => Promise<boolean>;
  archiveProjectFromTree: (projectId: string) => Promise<boolean>;
  archiveConversationFromTree: (conversationId: string) => Promise<boolean>;
  forkConversationInTree: (conversationId: string, title?: string) => Promise<ConversationSummary | null>;
  sshConnectHost: (alias: string) => Promise<{ ok: boolean; home?: string; error?: string; retryable?: boolean }>;
  sshListDirs: (alias: string, path: string) => Promise<{ ok: boolean; dirs?: Array<{ name: string; path: string }>; error?: string; retryable?: boolean }>;
  sshRegisterHost: (p: { ip: string; port: string; username: string; password: string }) => Promise<{ ok: boolean; alias?: string; error?: string }>;
  sshCreateAt: (p: { alias: string; remotePath: string }) => Promise<{ ok: boolean; error?: string }>;
  sshConnectProject: (project: Project) => Promise<void>;
  /** 左栏工作台入口：打开某工作区模式（无项目时回落到欢迎页）。 */
  openWorkspaceMode: (mode: WorkspaceMode) => void;

  // ── 适配槽 ──
  registerWorkspaceAdapter: (adapter: WorkspaceAdapter | null) => void;
}

const AppRailCtx = createContext<AppRailState | null>(null);

export function useAppRail(): AppRailState {
  const ctx = useContext(AppRailCtx);
  if (!ctx) throw new Error('useAppRail 必须在 <AppRailProvider> 内使用（UI-341 加映三）');
  return ctx;
}

/** UI-479 — 可选访问（WorkspacePanelsProvider 读列宽用）：无 AppRail 外层时返 null，
 * 调用方跳过响应式收起接线（TitleBar.test 等裸 Provider 场景行为零变化）。 */
export function useAppRailOptional(): AppRailState | null {
  return useContext(AppRailCtx);
}


/** 从路由推导当前项目 id（/project/:id[/...]）——壳层与工作区共用的唯一来源。 */
function projectIdFromPath(pathname: string): string | null {
  const m = pathname.replace(/\/+$/, '').match(/^\/project\/([^/]+)/);
  return m ? m[1] : null;
}

export function AppRailProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const currentProjectId = projectIdFromPath(location.pathname);

  // ── 数据 ──
  // BLOCK-101 P1 — 首屏 SWR（D2 键 gewu-startup-snapshot-v1）：localStorage 快照
  // 同步先渲染上次内容（打开瞬间即见，零首帧等待），后台 listProjects 对账后
  // 即弃快照（DB 唯一事实源；快照仅渲染缓存，不参与业务判断）。版本号失效 +
  // 形状校验 fail-closed（非数组/结构异常一律丢弃走正常加载）。
  const [allProjects, setAllProjects] = useState<Project[]>(() => {
    try {
      const raw = window.localStorage.getItem('gewu-startup-snapshot-v1');
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { version?: unknown; projects?: unknown };
      if (parsed?.version !== 1 || !Array.isArray(parsed.projects)) return [];
      return parsed.projects as Project[];
    } catch {
      return [];
    }
  });
  // BLOCK-101 P0 — 启动 timeline dataReady 打点（左栏项目列表首次到货；纯观测）
  useStartupTimeline();
  const persistSnapshot = useCallback((list: Project[]) => {
    try {
      window.localStorage.setItem(
        'gewu-startup-snapshot-v1',
        JSON.stringify({ version: 1, savedAt: Date.now(), projects: list })
      );
    } catch { /* 隐私模式/超限：快照失效即走正常加载，非致命 */ }
  }, []);
  const refreshProjects = useCallback(async () => {
    try {
      const list = await listProjects();
      markDataReady({ projectCount: list.length });
      setAllProjects(list);
      persistSnapshot(list);
    } catch { /* 保持既有列表：读取失败不制造空树假象 */ }
  }, [persistSnapshot]);

  useEffect(() => {
    // BLOCK-87 实测修复：首载只试一次曾致「项目列表没有了」（用户复现「又没有了」）
    // ——dev 栈重启竞态下窗口先于后端就绪，首次 fetch 抛错后 catch 保持空数组
    // 且再无重试，列表永久空白。首载带退避重试（约 0/2/5/10/15s 共 5 次）；
    // 读取失败仍保持既有列表不制造空树假象（软刷新/手动刷新路径不变）。
    // BLOCK-101 P0 — 首载到货即 dataReady 打点（度量锚点在首载链上）。
    let cancelled = false;
    const backoffMs = [0, 2000, 5000, 10000, 15000];
    void (async () => {
      for (const wait of backoffMs) {
        if (cancelled) return;
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        if (cancelled) return;
        try {
          const list = await listProjects();
          if (!cancelled) {
            markDataReady({ projectCount: list.length });
            setAllProjects(list);
            persistSnapshot(list);
          }
          return;
        } catch { /* 后端未就绪/瞬断：退避后重试 */ }
      }
    })();
    return () => { cancelled = true; };
  }, [persistSnapshot]);

  // 软刷新（其它面改了项目/会话后）
  useEffect(() => subscribeGewuEvent(gewuEvents.softRefresh, () => { void refreshProjects(); }), [refreshProjects]);


  const treeState = useProjectTreeState(currentProjectId, allProjects);
  const {
    expandedProjects,
    toggleProjectExpand,
    expandProject,
  } = treeState;

  const conversationsApi = useConversations(currentProjectId);
  const { list: conversations, refresh: refreshConversations } = conversationsApi;
  const [activeConvId, setActiveConvId] = useState<string | null>(null);

  // 自动选中最新的会话 + 切项目时清空（原工作区内的两处 effect 上提到此，
  // 使壳层与工作区读同一份 activeConvId）
  useEffect(() => {
    if (activeConvId) return;
    if (!conversations.length) return;
    setActiveConvId(conversations[0].id);
  }, [conversations, activeConvId]);

  useEffect(() => {
    setActiveConvId(null);
  }, [currentProjectId]);

  const { byProjectId: projectConversations, refresh: refreshOtherConversations } = useOtherConversations(
    expandedProjects,
    currentProjectId
  );
  // 会话创建即时刷新（用户反馈「新建聊天左侧项目列表不实时更新」）：中栏发送首条消息
  // 或子 agent 后端建会话时，创建方广播 conversationCreated——这里立即拉取当前项目与
  // 其它已展开项目的会话列表（force 绕过共享缓存），左栏秒级出现新会话。
  useEffect(
    () =>
      subscribeGewuEvent(gewuEvents.conversationCreated, (detail) => {
        void refreshConversations();
        void refreshOtherConversations();
        void detail;
      }),
    [refreshConversations, refreshOtherConversations]
  );

  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [createError, setCreateError] = useState('');

  // ── 布局尺寸（单实例）──
  const resizable = useResizableColumns();
  const {
    leftWidth,
    rightWidth,
    setLeftWidth,
    setRightWidth,
    bottomTerminalHeight,
    startColumnResize,
    startBottomTerminalResize,
  } = resizable;

  // ── 工作区适配槽 ──
  const adapterRef = useRef<WorkspaceAdapter | null>(null);
  const registerWorkspaceAdapter = useCallback((adapter: WorkspaceAdapter | null) => {
    adapterRef.current = adapter;
  }, []);

  const currentProject = useMemo(
    () => allProjects.find((p) => p.id === currentProjectId) || null,
    [allProjects, currentProjectId]
  );

  // ── 动作 ──
  const switchToProject = useCallback((id: string) => {
    void navigate(`/project/${id}`);
  }, [navigate]);

  const switchConversation = useCallback((convId: string) => {
    adapterRef.current?.updateWorkspaceMode('chat');
    adapterRef.current?.clearConversationContext();
    setActiveConvId(convId);
  }, []);

  /** 左栏工作台入口：模式导航（工作区在场时直接切模式，否则进项目工作区）。 */
  const openWorkspaceMode = useCallback((mode: WorkspaceMode) => {
    if (adapterRef.current) {
      adapterRef.current.updateWorkspaceMode(mode);
      return;
    }
    // UI-346 — 档2 左栏上提为应用壳层后，欢迎页/全局页也能点「搜索/插件」；
    // 此前无项目上下文时 navigate('/') 原地不动＝入口假死（用户实机反馈）。
    // 回退最近项目打开同一模式（listProjects ORDER BY updated_at DESC，
    // 与欢迎页项目预选同口径；插件商店为纯 IPC 全局面，搜索面本就跨项目）。
    const targetProjectId = currentProjectId || allProjects[0]?.id || null;
      void navigate(targetProjectId ? `/project/${targetProjectId}/${mode}` : '/');
  }, [allProjects, currentProjectId, navigate]);

  const createConversationForProject = useCallback(async (targetProjectId?: string) => {
    const pid = targetProjectId || currentProjectId;
    if (!pid || creatingConversation) return;
    if (pid === currentProjectId) adapterRef.current?.updateWorkspaceMode('chat');
    expandProject(pid);
    setCreatingConversation(true);
    try {
      const conv = await createConversationREST('新对话', undefined, pid);
      if (!conv) return;
      if (pid === currentProjectId) {
        setActiveConvId(conv.id);
        await refreshConversations();
      } else {
        // 跨项目创建：切过去（缓存由 useOtherConversations 按展开态拉取）
        void navigate(`/project/${pid}`);
      }
    } finally {
      setCreatingConversation(false);
    }
  }, [creatingConversation, currentProjectId, expandProject, navigate, refreshConversations]);

  const createProjectFromPath = useCallback(async (selected: string) => {
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
      const created = await createProject({ name, modality: 'general', workspacePath: finalPath });
      setAllProjects((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      // 项目创建广播（softRefresh → AppRail 刷新左栏项目列表，用户反馈「创建项目左栏不更新」）
      try {
        dispatchGewuEvent(gewuEvents.softRefresh, undefined);
      } catch {
        // 事件总线失败不阻塞导航
      }
      expandProject(created.id);
      void navigate(`/project/${created.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建项目失败');
    } finally {
      setCreatingProject(false);
    }
  }, [expandProject, navigate]);

  const openCreatePanel = useCallback(async () => {
    setCreateError('');
    const dialog = window.biof3Desktop?.files?.openDirectoryDialog;
    if (typeof dialog !== 'function') {
      setCreateError('当前环境不支持原生文件夹选择（请在 Gewu 桌面应用中使用）');
      return;
    }
    const selected = await dialog();
    if (!selected) return;
    await createProjectFromPath(selected);
  }, [createProjectFromPath]);

  const renameProjectInTree = useCallback(async (targetProjectId: string, name: string) => {
    const next = await updateProject(targetProjectId, { name });
    if (!next) return false;
    setAllProjects((current) => current.map((item) => (item.id === next.id ? next : item)));
    adapterRef.current?.onProjectRenamed(next);
    return true;
  }, []);

  const renameConversationInTree = useCallback(async (conversationId: string, title: string) => {
    const ok = await renameConversationREST(conversationId, title);
    if (!ok) return false;
    await Promise.all([refreshConversations(), refreshOtherConversations()]);
    return true;
  }, [refreshConversations, refreshOtherConversations]);

  const archiveProjectFromTree = useCallback(async (targetProjectId: string) => {
    const archived = await setProjectStatus(targetProjectId, 'archived');
    if (!archived) return false;
    const remaining = allProjects.filter((item) => item.id !== targetProjectId);
    setAllProjects(remaining);
    if (targetProjectId === currentProjectId) {
      void navigate(remaining[0] ? `/project/${remaining[0].id}` : '/', { replace: true });
    }
    return true;
  }, [allProjects, currentProjectId, navigate]);

  const archiveConversationFromTree = useCallback(async (conversationId: string) => {
    const ok = await archiveConversationREST(conversationId, true);
    if (!ok) return false;
    if (conversationId === activeConvId) {
      setActiveConvId(null);
      adapterRef.current?.clearConversationContext();
    }
    await Promise.all([refreshConversations(), refreshOtherConversations()]);
    return true;
  }, [activeConvId, refreshConversations, refreshOtherConversations]);

  const forkConversationInTree = useCallback(async (conversationId: string, title?: string) => {
    const forked = await forkConversationREST(conversationId, title);
    if (!forked) return null;
    adapterRef.current?.updateWorkspaceMode('chat');
    await Promise.all([refreshConversations(), refreshOtherConversations()]);
    setActiveConvId(forked.id);
    return forked;
  }, [refreshConversations, refreshOtherConversations]);

  // ── SSH 五连（纯转发，无 React 状态依赖）──
  const sshConnectHost = useCallback(async (alias: string) => connectSshHost(alias), []);
  const sshListDirs = useCallback(async (alias: string, path: string) => listSshRemoteDirs(alias, path), []);

  const sshRegisterHost = useCallback(async (p: { ip: string; port: string; username: string; password: string }) => {
    const desktop = (window as unknown as { biof3Desktop?: { ssh?: { registerHost: (p: { ip: string; port: number; username: string; password: string }) => Promise<{ ok: boolean; alias?: string; error?: string }> } } });
    const bridge = desktop.biof3Desktop?.ssh ?? (window as unknown as { gewu?: { ssh?: { registerHost: (p: { ip: string; port: number; username: string; password: string }) => Promise<{ ok: boolean; alias?: string; error?: string }> } } }).gewu?.ssh;
    if (!bridge?.registerHost) {
      return { ok: false, error: '当前运行环境不支持密码引导连接（请升级 Gewu 桌面端）' };
    }
    if (!p.ip || !p.port || !/^[1-9][0-9]*$/.test(p.port) || Number(p.port) > 65535 || !p.username || !p.password) {
      return { ok: false, error: '请完整填写 IP、端口（1-65535）、用户名与密码' };
    }
    return bridge.registerHost({ ip: p.ip, port: Number(p.port), username: p.username, password: p.password });
  }, []);

  const sshCreateAt = useCallback(async (p: { alias: string; remotePath: string }) => {
    const verdict = await validateSshProject({ alias: p.alias, remotePath: p.remotePath });
    if (!verdict.ok) {
      return { ok: false, error: verdict.retryable ? `远程连接失败（可重试）：${verdict.error}` : `远程路径校验失败：${verdict.error}` };
    }
    const name = p.remotePath.split('/').filter(Boolean).pop() || p.alias;
    const created = await createProject({ name, modality: 'general', workspaceKind: 'ssh', sshHost: p.alias, remotePath: p.remotePath });
      // 项目创建广播（softRefresh → AppRail 刷新左栏项目列表，用户反馈「创建项目左栏不更新」）
      try {
        dispatchGewuEvent(gewuEvents.softRefresh, undefined);
      } catch {
        // 事件总线失败不阻塞导航
      }
    setAllProjects((cur) => (cur.some((item) => item.id === created.id) ? cur : [created, ...cur]));
    void navigate(`/project/${created.id}`, { replace: true });
    return { ok: true };
  }, [navigate]);

  const sshConnectProject = useCallback(async (target: Project) => {
    if (target.workspaceKind !== 'ssh' || !target.sshHost || !target.remotePath) return;
    const verdict = await validateSshProject({ alias: target.sshHost, remotePath: target.remotePath });
    if (verdict.ok) {
      toast?.success(`远程连接正常：${target.sshHost}:${target.remotePath}`);
    } else {
      const msg = verdict.retryable ? `远程连接失败（可重试）：${verdict.error}` : `远程连接失败：${verdict.error}`;
      toast?.error(msg);
    }
  }, [toast]);

  const value = useMemo<AppRailState>(() => ({
    resizable,
    allProjects, setAllProjects, refreshProjects,
    currentProjectId, currentProject,
    expandedProjects, toggleProjectExpand, expandProject,
    conversations, refreshConversations, activeConvId, setActiveConvId,
    projectConversations, refreshOtherConversations,
    creatingProject, creatingConversation, createError, setCreateError,
    conversationsApi, treeState,
    leftWidth, rightWidth, setLeftWidth, setRightWidth, bottomTerminalHeight,
    startColumnResize, startBottomTerminalResize,
    switchToProject, switchConversation, createConversationForProject,
    openCreatePanel, createProjectFromPath,
    renameProjectInTree, renameConversationInTree,
    archiveProjectFromTree, archiveConversationFromTree, forkConversationInTree,
    sshConnectHost, sshListDirs, sshRegisterHost, sshCreateAt, sshConnectProject,
    openWorkspaceMode,
    registerWorkspaceAdapter,
  }), [
    resizable,
    allProjects, refreshProjects, currentProjectId, currentProject,
    expandedProjects, toggleProjectExpand, expandProject,
    conversations, refreshConversations, activeConvId,
    projectConversations, refreshOtherConversations,
    creatingProject, creatingConversation, createError,
    conversationsApi, treeState,
    leftWidth, rightWidth, bottomTerminalHeight, startColumnResize, startBottomTerminalResize,
    switchToProject, switchConversation, createConversationForProject,
    openCreatePanel, createProjectFromPath,
    renameProjectInTree, renameConversationInTree,
    archiveProjectFromTree, archiveConversationFromTree, forkConversationInTree,
    sshConnectHost, sshListDirs, sshRegisterHost, sshCreateAt, sshConnectProject,
    openWorkspaceMode, registerWorkspaceAdapter,
  ]);

  return <AppRailCtx.Provider value={value}>{children}</AppRailCtx.Provider>;
}
