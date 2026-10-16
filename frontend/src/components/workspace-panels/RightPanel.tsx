import React from 'react';
import type { Project, ToolJob } from '@/lib/project-types';
import type { BackendStatus } from '@/lib/electron';
import type { HarnessWorkflowJobState } from '@/lib/harness-client';
import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';
import { ResultStudioInspector } from '@/components/result-studio/ResultStudioSurface';
import {
  ResultEditAdvancedDrawer,
  type ResultEditSubmission,
} from '@/components/result-studio/ResultEditPanel';
import type { ResultStudioEditControls } from '@/lib/result-studio-interaction-client';
import {
  type RightPanelMode,
  type ActiveArtifact,
  type ActiveWorkspaceFile,
  EmptyResult,
  RightFileTree,
  BrowserPanel,
} from '@/pages/project-workspace';
import { useToolCatalog } from '@/lib/tool-catalog';
import { AnalysisLaunchPanel } from '@/components/workspace-panels/AnalysisLaunchPanel';
// UI-446 加映 v3 — 空态磁贴的审阅未读圆点数据源
import { useConversationShortstat, useConversationUnreviewedCount } from '@/components/copilot/conversationChangesStore';
import { CommandCenterJobsWall } from '@/pages/window/CommandCenterJobsWall';
// BLOCK-28.5 — 审阅并入右侧边栏 tab 体系（复用 dock 紧凑形态，填满 tab 容器）
import { ReviewMode } from '@/components/desktop/WorkingTreeReview/ReviewMode';
// BLOCK-68 / UI-317 — 模型 I/O 信息流 dock（原 composer ⋯ 菜单 overlay 迁入）
import { LlmTranscriptViewer } from '@/components/copilot/LlmTranscriptViewer';
// UI-385 — 子智能体实时详情面板（原独立专属窗迁入右栏）
import { AgentRunPanel } from '@/components/workspace-panels/AgentRunPanel';
import styles from '@/pages/project-workspace.module.css';

type DispatchSetter<T> = React.Dispatch<React.SetStateAction<T>>;

export interface RightPanelContext {
  // Layout
  width: number;
  /** BLOCK-62 P1b — 列级 header（aside 第一个子元素，宽=栏宽，同帧刚性）。 */
  columnHeader?: React.ReactNode;

  // Project + conversation
  project: Project;
  projectId?: string;
  activeConvId: string | null;
  /** UI-385 — 右栏「智能体」tab 当前展示的子 agent 任务 id（agentOpenInRail 事件写入）。 */
  agentRunId?: string | null;
  /** UI-385 — 续派成功后切换面板到新 agent。 */
  onAgentRunSwitch?: (runId: string) => void;

  // Tab state
  openRightTabs: RightPanelMode[];
  rightTab: RightPanelMode;
  rightToolMenuOpen: boolean;
  setRightTab: (tab: RightPanelMode) => void;
  setRightToolMenuOpen: DispatchSetter<boolean>;
  openRightPanel: (tab: RightPanelMode) => void;
  closeRightPanelTab: (tab: RightPanelMode) => void;

  // Tab content data
  activeJob: ToolJob | null;
  activeWorkflow: HarnessWorkflowJobState | null;
  onWorkflowChanged: () => void;
  activeArtifact: ActiveArtifact | null;
  setActiveArtifact: (a: ActiveArtifact | null) => void;
  /** G0-RS-P3: Agent 上下文就绪状态，由后端 context-envelope 投影而来。 */
  resultContext?: {
    status: 'ready' | 'blocked' | 'loading';
    reason?: string | null;
    selectionUsable?: boolean;
    selectionCompatibility?: 'compatible' | 'stale' | 'invalid' | null;
  } | null;
  /** G0-RS-P4: Schema 驱动的编辑控件，与 Agent 可见参数同源。 */
  resultEditControls?: ResultStudioEditControls | null;
  resultEditSubmitting?: boolean;
  onResultEditSubmit?: (submission: ResultEditSubmission) => void;
  openWorkspaceFiles: ActiveWorkspaceFile[];
  activeWorkspaceFile: ActiveWorkspaceFile | null;
  setActiveWorkspaceFile: (f: ActiveWorkspaceFile | null) => void;
  pendingArtifactName: string | null;
  onPendingArtifactConsumed: () => void;
  backendStatus: BackendStatus;
  browserUrl: string;

  // Handlers
  setBottomTerminalOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setRightOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setActiveConvId: (id: string | null) => void;
  handleAskAgent: (prompt: string) => boolean | void;
  handleOpenWorkspaceFile: (file: ActiveWorkspaceFile) => void;
  /** UI-451 — tab 点击激活（传数组既有对象，身份不变 → 预览不重载 → 草稿保留）。 */
  handleActivateWorkspaceFile: (file: ActiveWorkspaceFile) => void;
  /** UI-451 — 批量关闭（含单关；活动被关时相邻回退语义在 hook 内）。 */
  handleCloseWorkspaceFiles: (paths: string[]) => void;
  /** UI-451 — tab 拖拽重排。 */
  handleReorderWorkspaceFiles: (fromPath: string, toIndex: number) => void;
  /** UI-451 加映 v2 (P1-1) — rename/move 成功后重定向 tab。 */
  handleRenameWorkspaceFile: (oldPath: string, nextFile: ActiveWorkspaceFile) => void;
  /** UI-451 加映 v3（Minor）— 重开最近关闭的 tab。 */
  handleReopenWorkspaceFile: () => void;
  /** UI-451 加映 v3（Minor）— 存在可重开的关闭历史（菜单项可见性）。 */
  hasReopenableWorkspaceFile: boolean;
  /** UI-451 加映 v3（P2-7/P2-8）— 脏位图上抛（守卫/淘汰环/关窗共用同一真相；稳定引用）。 */
  handleWorkspaceFileDirtyMapChange: (dirtyMap: Record<string, boolean>) => void;
  handleOpenResult: (jobId: string, projectId?: string | null) => void | Promise<boolean>;
  handleOpenRightResults: () => void;
  handleOpenRightBrowser: () => void;
  handleOpenRightFiles: () => void;
  handleOpenRightChat: () => void;
  setBrowserUrl: (url: string) => void;
  setBrowserCanGoBack: (value: boolean) => void;
  setBrowserCanGoForward: (value: boolean) => void;
}

export interface RightPanelProps {
  ctx: RightPanelContext;
  visible: boolean;
  workspaceMode: WorkspaceMode;
  onResize?: (e: React.MouseEvent) => void;
}

/**
 * Right column — multi-tab tool panel (工作台/文件/后端/浏览器/聊天).
 *
 * Pure renderer: tab content components are provided by the parent (already
 * defined in project-workspace.tsx and re-exported). All interactions route
 * back via `ctx` callbacks.
 */
export function RightPanel({
  ctx,
  visible,
  workspaceMode,
  onResize,
}: RightPanelProps): React.ReactElement | null {
  const handleBrowserNavigationStateChange = React.useCallback(
    ({ canGoBack, canGoForward }: { canGoBack: boolean; canGoForward: boolean }) => {
      ctx.setBrowserCanGoBack(canGoBack);
      ctx.setBrowserCanGoForward(canGoForward);
    },
    [ctx.setBrowserCanGoBack, ctx.setBrowserCanGoForward],
  );

  // BLOCK-83 D4：分析目录投影自已装插件（零插件 → 诚实空态）。
  const { tools: catalogTools, loading: catalogLoading } = useToolCatalog();

  // UI-446 v4 — 空态「审阅」磁贴的未审文件数徽章（当前会话有未看工作区改动）
  const reviewCount = useConversationUnreviewedCount(ctx.activeConvId);
  // UI-449（C-16）— 磁贴 ±行数（权威源=后端 git shortstat；有未审改动才拉）
  const reviewStat = useConversationShortstat(ctx.activeConvId, ctx.projectId ?? null, reviewCount > 0);

  // UI-341 加映二 — 侧栏开合平滑：原实现 !visible 直接 return null（卸载 =
  // 开合瞬时跳变）。现保持挂载、宽度收到 0，走 .rightCol 的 width transition 平滑收起。
  return (
    <>
      {visible && onResize && <div className={styles.resizeHandleV} onMouseDown={onResize} />}
      <aside
        className={`${styles.rightCol}${visible ? '' : ` ${styles.rightColCollapsed}`}`}
        style={{ width: visible ? `var(--petri-live-right-width, ${ctx.width}px)` : 0 }}
        data-workspace-mode={workspaceMode}
        aria-hidden={!visible}
        data-petri-motion="functional"
      >
        {ctx.columnHeader}
        <div className={styles.resultPanel}>
          <div className={styles.resultPanelBody}>
            {ctx.openRightTabs.map((tab) => (
              <div
                key={tab}
                className={`${styles.rightPanelTabContent} ${
                  ctx.rightTab === tab ? styles.rightPanelTabContentActive : ''
                } ${tab === 'browser' ? styles.rightPanelBrowserTab : ''} ${
                  tab === 'review' ? styles.rightPanelReviewTab : ''
                }`}
              >
                {tab === 'home' && (
                  <EmptyResult
                    onOpenResults={ctx.handleOpenRightResults}
                    onOpenBrowser={ctx.handleOpenRightBrowser}
                    onOpenFiles={ctx.handleOpenRightFiles}
                    onOpenChat={ctx.handleOpenRightChat}
                    onOpenReview={() => ctx.openRightPanel('review')}
                    onOpenJobs={() => ctx.openRightPanel('jobs')}
                    reviewCount={reviewCount}
                    reviewStat={reviewStat ? { added: reviewStat.tracked.added, removed: reviewStat.tracked.removed } : null}
                  />
                )}
                {/* UI-362 — 指挥中心 tab：项目绑定俯瞰（瓦片墙按当前项目过滤） */}
                {tab === 'jobs' && ctx.projectId && (
                  <CommandCenterJobsWall
                    projectId={ctx.projectId}
                    emptyText="本项目暂无作业——运行一个分析后，瓦片会出现在这里。"
                  />
                )}
                {tab === 'results' && (
                  <ResultStudioInspector
                    artifact={ctx.activeArtifact}
                    jobStatus={ctx.activeWorkflow?.jobStatus || ctx.activeJob?.status}
                    truthStatus={
                      typeof ctx.activeArtifact?.truthStatus === 'string'
                        ? ctx.activeArtifact.truthStatus
                        : typeof ctx.activeWorkflow?.artifactTruth?.status === 'string'
                          ? ctx.activeWorkflow.artifactTruth.status
                          : null
                    }
                    onAskAgent={ctx.handleAskAgent}
                    context={workspaceMode === 'result' ? null : ctx.resultContext ?? null}
                  />
                )}
                {tab === 'results' && ctx.activeArtifact && ctx.onResultEditSubmit && (
                  <ResultEditAdvancedDrawer
                    editControls={ctx.resultEditControls ?? null}
                    disabledReason={
                      ctx.resultContext?.status === 'blocked'
                        ? ctx.resultContext.reason || '当前结果缺少可复现的来源坐标，暂时无法修改。'
                        : ctx.resultContext?.status === 'loading'
                          ? '正在读取结果坐标…'
                          : null
                    }
                    submitting={ctx.resultEditSubmitting === true}
                    onSubmit={ctx.onResultEditSubmit}
                  />
                )}
                {tab === 'files' && (
                  <RightFileTree
                    project={ctx.project}
                    active={ctx.rightTab === 'files'}
                    openFiles={ctx.openWorkspaceFiles}
                    activeFile={ctx.activeWorkspaceFile}
                    onOpenFile={ctx.handleOpenWorkspaceFile}
                    onActivateFile={ctx.handleActivateWorkspaceFile}
                    onCloseFiles={ctx.handleCloseWorkspaceFiles}
                    onReorderFiles={ctx.handleReorderWorkspaceFiles}
                    onRenameFile={ctx.handleRenameWorkspaceFile}
                    onReopenFile={ctx.handleReopenWorkspaceFile}
                    canReopen={ctx.hasReopenableWorkspaceFile}
                    onDirtyMapChange={ctx.handleWorkspaceFileDirtyMapChange}
                  />
                )}
                {tab === 'browser' && (
                  <BrowserPanel
                    initialUrl={ctx.browserUrl}
                    onUrlChange={ctx.setBrowserUrl}
                    onNavigationStateChange={handleBrowserNavigationStateChange}
                    obscured={ctx.rightTab !== 'browser'}
                  />
                )}
                {/* UI-417 — 「聊天」tab 退役：入口收编为中栏右缘悬挂聊天面（SideChatDock），
                    复用中央同一会话同一 run；copilotAsk 中央归属不变。不预留空壳。 */}
                {tab === 'analyze' && (
                  <AnalysisLaunchPanel
                    tools={catalogTools}
                    loading={catalogLoading}
                    projectId={ctx.project ? ctx.project.id : null}
                    onLaunch={(tool, launchPrompt) => {
                      ctx.handleAskAgent(launchPrompt || `请运行「${tool.title}」分析（${tool.category}）。`);
                      ctx.handleOpenRightChat();
                    }}
                  />
                )}
                {tab === 'review' && (
                  <ReviewMode
                    variant="dock"
                    onClose={() => ctx.closeRightPanelTab('review')}
                  />
                )}
                {/* BLOCK-68 / UI-317 — 模型 I/O 信息流 dock（绑当前会话，只读；无会话诚实空态） */}
                {tab === 'io' && <LlmTranscriptViewer conversationId={ctx.activeConvId} />}
                {/* UI-385 — 子智能体实时详情（原独立专属窗迁入：中断/留言/续派完整保留；
                    未选中 agent 时诚实空态，入口=工具行内联卡「详情」/活动条/俯瞰行点击） */}
                {tab === 'agent' && (
                  ctx.agentRunId ? (
                    <AgentRunPanel
                      runId={ctx.agentRunId}
                      onSpawnedAgent={(runId) => ctx.onAgentRunSwitch?.(runId)}
                    />
                  ) : (
                    <div className={styles.panelEmpty}>尚未选择子智能体——在会话工具行或活动条中打开详情。</div>
                  )
                )}
                {/* BLOCK-72 / UI-320 — 「知识空间」「后端」tab 已迁出右栏：设备级全局能力，
                    管理面在左栏工作台入口的 /knowledge 与 /backend 全局页；不预留空壳。 */}
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
