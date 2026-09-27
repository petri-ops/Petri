// ============================================================
// ProjectWorkspace — UI-REFACTOR Phase3
// Three-column layout: left=resources, center=results+agent, right=history+results
// Collapsible panels. Route: /project/:projectId
// ============================================================
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
// UI-446 — 审阅 tab 圆点已读回写（激活审阅 tab 即 acknowledge 当前会话改动）
import { acknowledgeConversationChanges } from '@/components/copilot/conversationChangesStore';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import { BottomTerminal } from '@/components/workspace-panels/BottomTerminal';
import { CenterPanel, type CenterPanelContext, type CenterPanelRefs } from '@/components/workspace-panels/CenterPanel';
import { RightPanel, type RightPanelContext } from '@/components/workspace-panels/RightPanel';
import { ColumnHeader } from '@/components/desktop/titlebar/ColumnizedTitleBar';
import { TitleBar } from '@/components/desktop/TitleBar';
import { getProject, listProjectJobs, listDatasetsByProject } from '@/lib/project-store';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import { getApiPrefix, getToken } from '@/lib/authClient';
import {
  isConversationRunning,
  useConversationRun,
} from '@/components/copilot/conversationRunStore';

import {
  artifactAfterJobSelection,
  canCommitJobOpen,
  useConversationJobs,
} from '@/hooks/useConversationJobs';

import { useWorkspaceLayout } from '@/hooks/useWorkspaceLayout';
import { useWorkspacePanelShortcuts } from '@/hooks/useWorkspacePanelShortcuts';
import { useRightPanelTabs } from '@/hooks/useRightPanelTabs';
import { segmentToMode, modeToSegment, type WorkspaceMode } from '@/hooks/useWorkspaceRouting';
import { useHarnessWorkflowStatus } from '@/hooks/useHarnessWorkflowStatus';
import { useSetCopilotContext } from '@/lib/copilotContextProvider';
import { gewuEvents, subscribeGewuEvent, dispatchGewuEvent } from '@/lib/events';
import { usePendingScroll } from '@/lib/pendingScrollContext';
import { useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';
import { useAppRail } from '@/components/desktop/AppRailContext';
import type { ActiveArtifact } from '@/components/workspace-panels/ResultView';
import {
  fetchHarnessIndex,
  type HarnessIndexSummary,
} from '@/lib/harness-client';
import { buildResultTitleBarTitle } from '@/lib/result-title-bar';
import { isResultWorkspaceMode } from '@/components/result-studio/resultFocusLayout';
import {
  beginResultSurfaceMeasure,
  RESULT_SURFACE_PERFORMANCE_MARKS,
} from '@/components/result-studio/resultSurface';
import styles from './project-workspace.module.css';
// Re-export for backward compatibility — consumers still import from the page.
export type { ActiveWorkspaceFile } from './project-workspace/types';
export type { ActiveArtifact, JobStats } from '@/components/workspace-panels/ResultView';
// BLOCK-92 Wave B-1 — 右栏 tab 词表/常量外迁 ./project-workspace/rightPanelTabs.ts（原路径 re-export 兼容）。
export type { RightPanelMode } from './project-workspace/rightPanelTabs';
import { type RightPanelMode } from './project-workspace/rightPanelTabs';
// BLOCK-92 Wave B-1 — 状态/派生/事件簇外迁（纯搬运零行为变化）。
import { toCopilotHarnessSummary } from './project-workspace/copilotHarnessSummary';
import { useWorkspaceFileTabs } from './project-workspace/useWorkspaceFileTabs';
import { useRuntimeDemandBanner } from './project-workspace/useRuntimeDemandBanner';
import { useWorkspaceTitleBar } from './project-workspace/useWorkspaceTitleBar';
import { useResultStudioEditContext } from './project-workspace/useResultStudioEditContext';
import { useInvalidationStream } from '@/hooks/useInvalidationStream';
import { useWorkspaceOpenEffects } from './project-workspace/useWorkspaceOpenEffects';
export function ProjectWorkspace(): React.ReactElement {
  const shell = useWorkspacePanelsContext();
  const appRail = useAppRail();

  // UI-341 加映三（档 2）——左栏数据/动作已上提 AppRailContext（单一真相）。
  // 以下别名保持本文件既有引用点零改动。
  const handleSwitchConversation = appRail.switchConversation;
  const switchToProject = appRail.switchToProject;
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
  // BLOCK-92 Wave B-1 — 工作区文件 tab 状态簇外迁（./project-workspace/useWorkspaceFileTabs.ts）。
  const {
    openWorkspaceFiles,
    activeWorkspaceFile,
    setActiveWorkspaceFile,
    handleOpenWorkspaceFile,
    handleCloseWorkspaceFile,
  } = useWorkspaceFileTabs(projectId);
  // G0-RS-P4/G0-RS-P3 的 Result Studio 编辑上下文状态簇
  // （resultContextState/resultEditControls/resultEditSubmitting/resultAgentDrafts）
  // 外迁至 ./project-workspace/useResultStudioEditContext.ts，调用点在
  // activeConversationRun 就位之后（见下）。
  const [browserCanGoBack, setBrowserCanGoBack] = useState(false);
  const [browserCanGoForward, setBrowserCanGoForward] = useState(false);
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
  // UI-341 加映三（档 2）：会话/活跃会话上提到 AppRailContext（壳层左栏与工作区
  // 共用同一份状态），此处仅按原变量名取用，正文零改动。
  const {
    conversations,
    refreshConversations,
    activeConvId,
    setActiveConvId,
  } = {
    conversations: appRail.conversationsApi.list,
    refreshConversations: appRail.conversationsApi.refresh,
    activeConvId: appRail.activeConvId,
    setActiveConvId: appRail.setActiveConvId,
  };
  const {
    jobs: conversationJobs,
    error: conversationJobsError,
    refresh: refreshConversationJobs,
  } = useConversationJobs(projectId, activeConvId);
  const activeConversationRun = useConversationRun(activeConvId);
  // BLOCK-92 Wave B-1 — Result Studio 编辑上下文簇外迁
  // （./project-workspace/useResultStudioEditContext.ts：绑定键/上下文投影/
  // 草稿/copilotActiveArtifact/handleResultEditSubmit，纯搬运零行为变化）。
  const {
    resultEditBusy,
    effectiveResultContextState,
    effectiveResultEditControls,
    resultAgentDraft,
    setResultAgentDraft,
    copilotActiveArtifact,
    handleResultEditSubmit,
  } = useResultStudioEditContext({
    projectId,
    activeConvId,
    activeArtifact,
    setActiveArtifact,
    activeJobId,
    activeConversationRun,
    setWorkspaceNotice,
  });
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
  // Plan 1.6 §4.3 — optimistic prepend for cross-project creations
  // (sidebar adds a conv under another project without switching pages).
  // useOtherConversations below reads from the shared cache; this seed
  // map is only the "just-created, not yet in cache" delta.
  // UI-341 加映三：创建态（creatingProject/creatingConversation/createError）
  // 已上提到 AppRailContext；otherSeed 为历史遗留「只写不读」死状态，随之上提时删除。
  // §2 dedup: use the App-level Context directly (5s poll), drop the standalone
  // 10s polling hook and the local state sync layer.
  const backendStatus = useBackendStatus();
  // Resizable panel dimensions — Plan 1.6 §4.4 [HIGH]. State + drag
  // handlers now live in useResizableColumns (stable refs, no stale
  // closure on drag), so the splitter drags don't tear with re-renders.
  const {
    leftWidth,
    rightWidth,
    inputHeight,
    bottomTerminalHeight,
    startColumnResize,
    startBottomTerminalResize,
  } = appRail.resizable;
  const {
    leftOpen,
    setLeftOpen,
    rightOpen,
    setRightOpen,
    compactLayout,
    bottomTerminalOpen,
    setBottomTerminalOpen,
    summaryOpen,
    sideChatOpen,
    setSideChatOpen,

    setSummaryOpen,
    centerColRef,
    sessionFrameRef,
    sessionFrameWidth,
  } = useWorkspaceLayout();
  // UI-359 — Ctrl/Cmd+` 开合底部终端、Ctrl/Cmd+Shift+B 开合右侧栏
  // （VS Code 肌肉记忆）。挂在本组件内=只在面板存在的路由生效。
  useWorkspacePanelShortcuts();
  // UI-341 加映二（用户裁决 2026-09-11）——侧栏常驻：进入结果族模式
  // （result/code/compare/history）**不再自动收起左右栏**。原实现把两侧栏
  // 一起关掉，导致「打开某页面左栏消失、列内 header 随之消失像全屏盖住导航」。
  // 现规则：侧栏只由用户主动点击改变（compact 窄屏浮层模式除外，见
  // useWorkspaceLayout 的 compact 自适应收起/还原）。
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
    void navigate(query ? `${base}?${query}` : base, { replace: true });
  }, [searchParams, projectId, navigate]);
  // Derived summary visibility (semantic + pixel dimensions).
  // UI-351 加映（用户裁决「有遮挡就应该悬浮 / 边界加宽」）：只有中栏宽裕
  // （≥1120px，卡片完全放得下）才钉住展开；一旦会话开始被挤/盖（<1120px）
  // 即转悬浮层——不再保留 780–1120 的「压缩钉住」中间带。
  const summaryVisibility = useMemo<'hidden' | 'compact' | 'float' | 'expanded'>(() => {
    if (sessionFrameWidth === 0) return 'expanded';
    if (sessionFrameWidth >= 1120) return 'expanded';
    return 'float';
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
    void navigate(query ? `${base}?${query}` : base, { replace });
  }, [leftOpen, rightOpen, searchParams, navigate, projectId, workspaceMode]);
  // openRightPanel: 打开右栏 tab。UI-341 加映二（用户裁决）——不再因 compact
  // 顺手收起左栏：侧栏只由用户主动点击改变。
  const openRightPanel = useCallback((tab: RightPanelMode) => {
    setOpenRightTabs((current) => current.includes(tab) ? current : [...current, tab]);
    setRightTab(tab);
    setRightOpen(true);
  }, []);
  // BLOCK-28.7 — 聊天区改动卡片点击：打开审阅 tab（文件选中由 useWorkingTreeReview 监听）
  useEffect(() => {
    return subscribeGewuEvent(gewuEvents.reviewOpenFile, () => {
      openRightPanel('review');
    });
  }, [openRightPanel]);
  // UI-446 — 激活审阅 tab 即视为已读当前会话改动（tab 圆点熄灭；新改动重新点亮）
  useEffect(() => {
    if (rightTab === 'review' && activeConvId) {
      acknowledgeConversationChanges(activeConvId);
    }
  }, [rightTab, activeConvId]);
  // UI-385 — 右栏「智能体」tab：子智能体详情不再弹独立窗。工具行内联卡 /
  // SubAgentsBar（活动条 + 俯瞰 + spawn 自动唤起）/ 续派统一派发本事件，
  // 这里切 tab 并把面板指到该 runId。
  const [agentTabRunId, setAgentTabRunId] = useState<string | null>(null);
  useEffect(() => {
    return subscribeGewuEvent(gewuEvents.agentOpenInRail, (detail) => {
      setAgentTabRunId(detail.runId);
      openRightPanel('agent');
    });
  }, [openRightPanel]);
  // 项目列表 / 项目树展开 / 跨项目会话 / 创建态：全部来自 AppRailContext（单一真相）
  const {
    allProjects,
    projectConversations,
    refreshOtherConversations,
    setCreateError,
  } = appRail;
  // UI-341 加映三（档 2）——壳层左栏动作的工作区副作用适配：切会话清 job/artifact、
  // 建会话/分支切回 chat、项目改名刷新本页 project 详情。工作区卸载后自动摘除，
  // 壳层动作退化为纯数据行为（单一真相在 AppRailContext）。
  const workspaceAdapter = useMemo(() => ({
    updateWorkspaceMode,
    clearConversationContext: () => {
      setActiveJobId(null);
      setActiveArtifact(null);
    },
    onProjectRenamed: (next: Project) => setProject(next),
    notify: setWorkspaceNotice,
    reportCreateError: setCreateError,
  }), [updateWorkspaceMode, setActiveJobId, setActiveArtifact, setProject, setWorkspaceNotice, setCreateError]);
  useEffect(() => {
    appRail.registerWorkspaceAdapter(workspaceAdapter);
    return () => appRail.registerWorkspaceAdapter(null);
  }, [workspaceAdapter, appRail.registerWorkspaceAdapter]);

  // UI-305 P1.2 — 左栏项目树展开簇抽入 useProjectTreeState（UI-347 起搜索
  // 状态簇已随「搜索」入口退役一并移除，本组件不再消费 treeState）。
  const workspacePath = project?.workspacePath || '';
  const handleSelectTitleBarResult = useCallback((jobId: string) => {
    if (!conversationJobs.some((job) => job.id === jobId)) return;
    bindActiveJob(jobId);
    setRightOpen(true);
    openRightPanel('results');
    updateWorkspaceMode('result', true, jobId);
  }, [bindActiveJob, conversationJobs, openRightPanel, setRightOpen, updateWorkspaceMode]);
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
  // UI-341 实机抓真修：只在 projectId 真正「变化」时清，mount 不清——本组件
  // mount 上该 effect 在会话种子 effect（自动选 conversations[0]）之后执行，
  // 无条件清会把刚选中的种子当轮抹掉；暖缓存（欢迎页首问链路正是此形态：
  // SimpleChat 建会话即写入共享缓存再导航）下列表引用不再变化、种子 effect
  // 不会重跑 → 工作区永远空态而 run 在服务端照跑。冷启动行为不变：缓存空
  // → fetch 后 conversations 引用变化 → 种子 effect 重跑自行选中。
  const prevProjectIdRef = useRef(projectId);
  useEffect(() => {
    if (prevProjectIdRef.current === projectId) return;
    prevProjectIdRef.current = projectId;
    setActiveConvId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  // Plan 1.6 §4.3 — single source for "other project" conversation lists.
  // Replaces the old per-project useState map that re-fetched on every
  // expansion. Reads / writes the same shared cache as useConversations.
  // UI-365 — 设置独立页化（/settings）：设备级能力不绑项目，不再切工作区模式。
  // UI-364 — 插件商店独立页化（/plugins）：运行时缺失横幅与左栏入口都
  // 跳独立页，不再切工作区模式（设备级能力不绑项目）。
  const handleShowPlugins = useCallback(() => { void navigate('/plugins'); }, [navigate]);
  // BLOCK-72 / UI-320 — 全局工作台页入口（知识空间/后端迁出右栏）
  // UI-366 — handleNavigateToBackend 随 /backend 页退役移除（诊断并入设置）
  // UI-335/336 — 「新建任务」入口：/ 欢迎页（BLOCK-80）；携带当前项目 id 供
  // 欢迎页默认预选（用户裁决：默认工作区应是鼠标点击所在的工作区）
  // UI-348 — 右栏「后端」卡已删除（用户裁决）：后端管理面唯一入口 = 左栏工作台的
  // 全局 /backend 页；原 handleOpenRightTerminal（跳 /backend 的右栏快捷卡）随卡移除。
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
  // UI-417 — 右栏 chat tab 退役：聊天入口收编为悬挂聊天面（SideChatDock）。
  // 原入口（home 空态卡/分析完成跳转）改派 sideChatOpen 事件展开悬挂面。
  const handleOpenRightChat = useCallback(() => {
    dispatchGewuEvent(gewuEvents.sideChatOpen);
  }, []);
  const titleBarTitle = useMemo(
    () => buildResultTitleBarTitle(workspaceMode, project?.name, activeArtifact?.label || activeArtifact?.name),
    [activeArtifact?.label, activeArtifact?.name, project?.name, workspaceMode],
  );
  // TitleBar 注册 effect 簇已外迁 ./project-workspace/useWorkspaceTitleBar.ts
  // （BLOCK-92 Wave B-1，含 titleBarTabs/titleBarResultItems 派生；纯搬运零行为变化）。
  useWorkspaceTitleBar({
    updateTitleBar,
    projectName: project?.name,
    projectId: projectId ?? undefined,
    titleBarTitle,
    rightTab,
    rightToolMenuOpen,
    openRightTabs,
    activeJobId,
    conversationJobs,
    browserCanGoBack,
    browserCanGoForward,
    conversations,
    activeConvId,
    handleSwitchConversation,
    handleOpenRightResults,
    handleSelectTitleBarResult,
    openRightPanel,
    closeRightPanelTab,
    setRightOpen,
    setRightTab,
    setRightToolMenuOpen,
  });
  // UI-282 — 拖拽目录直达创建：路径经校验后直接走创建链（UI-304 后无内联面板）
  // UI-327 向导①：连通性检测（runSshOp echo $HOME，经 /api/ssh-projects/connect）
  // UI-327 向导②：浏览远端目录（Gateway fs_list，仅目录）
  // UI-327 密码模式①：注册主机（一次性装公钥 + 写 ~/.ssh/config 别名；密码不存储）
  // UI-327 向导③：在选定路径创建项目并导航（validate 部署 agent + 创建）
  // BLOCK-67 加映（UI-325）— ssh 项目「远程连接」：连通性检测（validate = agent 探测 + 路径校验），
  // 结果 toast 诚实反馈；断线后这就是 D5 的用户侧重连入口。
  // Load conversations for other projects when expanded.
  // Plan 1.6 §4.3 — moved to useOtherConversations hook above; the
  // `projectConversations` variable is now derived from the shared
  // cache + cross-project seed map.
  // BLOCK-102 P2 — 切项目竞态守卫：组件跨 /project/:projectId 不重挂载，15s 轮询
  // 的在途旧响应会覆盖新项目数据。requestSequence 单调递增，只有最新一次请求
  // （且 projectId 未变）才允许写 state。
  const fetchSequenceRef = useRef(0);
  const fetchData = useCallback(async () => {
    if (!projectId) return;
    const seq = ++fetchSequenceRef.current;
    try {
      const p = await getProject(projectId);
      if (seq !== fetchSequenceRef.current) return;
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
      if (seq !== fetchSequenceRef.current) return;
      setJobs(jobList);
      setDatasets(dsList);
      // 成功路径必须清除此前轮询留下的瞬时错误，否则错误屏永驻（P0-2）
      setError('');
    } catch (e) {
      if (seq !== fetchSequenceRef.current) return;
      // 轮询瞬时失败：保留已加载数据，错误以非阻塞横幅呈现，下一轮成功即自愈
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      if (seq === fetchSequenceRef.current) setLoading(false);
    }
  }, [projectId]);
  // CK-03 — jobs 域失效通知驱动刷新（SSE 秒级感知 + 60s 兜底轮询）
  useInvalidationStream(Boolean(projectId), useCallback(
    (info) => { if (info.domain === 'jobs') void fetchData(); },
    [fetchData],
  ));
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
    void fetchData();
    const id = setInterval(() => { void fetchData(); }, 60_000); // CK-03：SSE 失效驱动为主，60s 兜底
    return () => clearInterval(id);
  }, [fetchData]);
  useEffect(() => {
    const handler = () => {
      void fetchData();
      void refreshConversationJobs();
      void refreshConversations();
      // 项目列表刷新由 AppRailProvider 的 softRefresh 订阅负责（单一职责）
    };
    const unsub = subscribeGewuEvent(gewuEvents.softRefresh, handler);
    return unsub;
  }, [fetchData, refreshConversationJobs, refreshConversations]);
  // Listen for conversation fork events from SimpleChat (RightPanel or CenterPanel)
  // to refresh the LeftPanel conversation list after a branch is created.
  useEffect(() => {
    const handler = (_detail: { newConversationId: string; projectId: string }) => {
      updateWorkspaceMode('chat');
      void Promise.all([refreshConversations(), refreshOtherConversations()]);
    };
    const unsub = subscribeGewuEvent(gewuEvents.conversationForked, handler);
    return unsub;
  }, [updateWorkspaceMode, refreshConversations, refreshOtherConversations]);
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
  // UI-360 曾按 plugins/settings 模式隐藏右栏；UI-364/365 两个模式均已独立
  // 页化退役，工作区模式全部有右栏消费 → 右栏只由路由（UI-359）与用户偏好
  // （rightOpen）决定。
  const rightRailVisible = rightOpen;
  const summaryOpenWidth = sessionFrameWidth === 0
    ? 300
    : summaryVisibility === 'expanded'
      ? Math.min(312, Math.max(292, Math.round(sessionFrameWidth * 0.26)))
      : Math.min(292, Math.max(276, Math.round(sessionFrameWidth * 0.32)));
  const summaryCardOpen = summaryVisibility !== 'hidden' && summaryOpen;
  // UI-351 加映② — 摘要卡处于悬浮态（中栏过窄 + 卡片打开）
  const summaryFloatActive = summaryCardOpen && summaryVisibility === 'float';
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
  // BLOCK-92 Wave B-1 — copilotActiveArtifact 派生已随 useResultStudioEditContext 外迁。
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
  // BLOCK-92 Wave B-1 — Result Studio 上下文重投影两个 effect 已随
  // useResultStudioEditContext 外迁（activeJobId 重置 + fetchResultStudioContext）。
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
      void navigate(`/project/${resolvedTargetProjectId}?mode=${targetMode}&job=${encodeURIComponent(jobId)}`);
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
        const data = (await resp.json()) as { ok?: unknown; id?: string; toolId?: string; status?: unknown; createdAt?: string | number; completedAt?: string | number; error?: string; projectId?: string; conversationId?: string | null };
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
        void navigate(`/project/${nextProjectId}?mode=${targetMode}&job=${encodeURIComponent(nextJob.id)}`);
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
  // BLOCK-92 Wave B-1 — 结果/文件打开事件 effects 簇外迁
  // （./project-workspace/useWorkspaceOpenEffects.ts：URL 请求参数自动打开、
  // projectOpenResult/projectOpenArtifact/独立窗 relay/projectOpenWorkspaceFile）。
  useWorkspaceOpenEffects({
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
    activeWorkspaceFilePath: activeWorkspaceFile?.path,
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
  });
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
  // BLOCK-80 — 欢迎页首问接力：欢迎页创建会话后经 sessionStorage 交接
  // {conversationId, prompt}；本工作区会话种子完成（activeConvId 就位）即
  // 派发 copilotAsk 启动首个任务，然后清除交接（一次性）。
  useEffect(() => {
    if (!activeConvId) return;
    try {
      const raw = sessionStorage.getItem('gewu.welcomeLaunch');
      if (!raw) return;
      const launch = JSON.parse(raw) as { conversationId?: string; prompt?: string };
      if (launch.conversationId !== activeConvId || !launch.prompt) return;
      sessionStorage.removeItem('gewu.welcomeLaunch');
      if (isConversationRunning(activeConvId)) return;
      dispatchGewuEvent(gewuEvents.copilotAsk, { prompt: String(launch.prompt) });
    } catch {
      /* 交接损坏即忽略——用户可在工作区手动发送 */
    }
  }, [activeConvId]);
  // BLOCK-92 Wave B-1 — handleResultEditSubmit 已随 useResultStudioEditContext 外迁。
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
  // backendStatus.rRuntime 可为 null（状态查询失败 = 未知）。用 `=== false`
  // 严格判定"确认缺失"，避免偶发 IPC 异常时误弹缺失横幅。
  // BLOCK-86 P2 — 领域感知：只有已装领域包声明运行时才提示（无包不提运行时），
  // 文案挂包名。
  //
  // hooks 顺序纪律（P6 渲染层实机抓真）：本块曾排在下方 `if (loading)` /
  // `if (!project)` 早退之后——首渲染（项目加载中）早退只调到前面的 hook，
  // 项目加载完成后的下一渲染才第一次走到这里 → React 抛
  // 「Rendered more hooks than during the previous render」卸载整棵树（页面全白）。
  // useState/useEffect 必须先于一切组件级早退。
  // （BLOCK-89 P3 曾独立重发现同一回归并同法上移，分叉收编两修合一。）
  // BLOCK-92 Wave B-1 — 横幅状态簇外迁（./project-workspace/useRuntimeDemandBanner.ts，
  // 调用点保持先于一切组件级早退的纪律）。
  const { showRuntimeBanner, runtimeBannerMessage } = useRuntimeDemandBanner(backendStatus);
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
    project: project,
    projectId,
    allProjects,
    activeConvId,
    conversations,
    projectConversations,
    workspaceMode,
    showPinnedSummary,
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
    openRightPanel,
    switchToProject,
    navigate: (to: string) => { void navigate(to); },
    handleSwitchConversation,
    setActiveConvId,
    setActiveJobId,
    setActiveArtifact,
    setResultAgentDraft,
    onResultEditSubmit: handleResultEditSubmit,
    setBottomTerminalOpen,
    setSummaryOpen,
    sideChatOpen,
    setSideChatOpen,
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
  const rightPanelCtx: RightPanelContext = {
    width: effectiveRightWidth,
    columnHeader: compactLayout ? undefined : <ColumnHeader side="right" />,
    project: project,
    projectId,
    activeConvId,
    // UI-385 — 右栏「智能体」tab 数据源（agentOpenInRail 事件写入）
    agentRunId: agentTabRunId,
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
    handleOpenRightBrowser,
    handleOpenRightFiles,
    handleOpenRightChat,
    setBrowserUrl,
    setBrowserCanGoBack,
    setBrowserCanGoForward,
  };
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
        {/* UI-351 加映② — 摘要卡悬浮时不再叠加 compact 侧栏遮罩：灰底托着悬浮卡
            视觉突兀（用户裁决「背景应该取消」）。悬浮卡自身可点、顶栏 toggle 可收起。 */}
        {compactLayout && (leftOpen || rightRailVisible) && !summaryFloatActive && (
          <button
            className={styles.panelBackdrop}
            onClick={() => {
              setLeftOpen(false);
              setRightOpen(false);
            }}
            aria-label="关闭侧栏"
          />
        )}
        {/* UI-341 加映三（档 2）——左栏上提为壳层 AppRail（常驻、跨页面），
            本组件不再渲染左栏；BottomTerminal 亦无需再避让左栏宽度。 */}
        {/* Center column — Simple chat (conversation-driven) */}
        <CenterPanel ctx={centerPanelCtx} refs={{ centerColRef: centerColRef as React.RefObject<HTMLElement>, sessionFrameRef }} />
        <RightPanel
          ctx={rightPanelCtx}
          visible={rightRailVisible}
          workspaceMode={workspaceMode}
          onResize={startColumnResize('right')}
        />
        <BottomTerminal
          open={bottomTerminalOpen}
          height={bottomTerminalHeight}
          leftOffset={0}
          rightOffset={rightRailVisible ? `var(--gewu-live-right-span, ${effectiveRightWidth + 1}px)` : 0}
          workspacePath={project.workspacePath}
          ssh={project.workspaceKind === 'ssh' && project.sshHost && project.remotePath
            ? { alias: project.sshHost, remotePath: project.remotePath }
            : undefined}
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
