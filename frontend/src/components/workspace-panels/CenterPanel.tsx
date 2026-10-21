import React from 'react';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import {
  resultEditProgressForContext,
  useConversationRun,
  useConversationTodoList,
  useConversationCitations,
} from '@/components/copilot/conversationRunStore';
import { useDurableConversationLoop } from '@/hooks/useDurableConversationLoop';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import type { ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';
import type { HarnessWorkflowJobState } from '@/lib/harness-client';
import type { BackendStatus } from '@/lib/electron';
import { WorkspaceSummaryCard } from '@/components/workspace-panels/WorkspaceSummaryCard';
import {
  ResultStudioCanvas,
  ResultStudioContextBar,
} from '@/components/result-studio/ResultStudioSurface';
import {
  ResultAgentComposer,
  type ResultAgentComposerContext,
} from '@/components/result-studio/ResultAgentComposer';
import type { ResultEditSubmission } from '@/components/result-studio/ResultEditPanel';
import {
  buildResultInterpretationPrompt,
  completeResultSurfaceMeasure,
  describeSelection,
  describeTruthStatus,
  RESULT_SURFACE_PERFORMANCE_MARKS,
  shortRevisionLabel,
} from '@/components/result-studio/resultSurface';
import {
  ResultView,
  type ActiveArtifact,
  type JobStats,
} from '@/components/workspace-panels/ResultView';
import { ScheduledWorkspacePanel } from '@/components/workspace-panels/ScheduledWorkspacePanel';
import { ResultsLibrary } from '@/components/workspace-panels/ResultsLibrary';
import { SideChatDock } from '@/components/workspace-panels/SideChatDock';
import { resolveResultSurfaceHost } from '@/components/result-studio/resultSurfaceHost';
import { PackSurfaceFrame } from '@/components/work-surface/PackSurfaceFrame';
import type { WorkSurfaceDescriptor } from '@/lib/workSurface/types';
import { usePackResultData } from '@/lib/workSurface/packResultData';
import { shouldDowngradeToCore, usePackTabData } from '@/lib/workSurface/usePackTabData';
import { getApiPrefix } from '@/lib/env';
// UI-448 加映 v25 — 浮卡左缘拖宽把手 + 偏好持久化（摘要浮卡与会话浮面共用）
import {
  FloatCardResizeHandle,
  persistFloatWidth,
  readPersistedFloatWidth,
} from '@/components/workspace-panels/FloatCardResizer';
import { Icon } from '@/components/icons/Icon';
// UI-448 — 悬浮聊天面开态：中栏会话内容列让位（不遮切割），与 composer 让位同源
import type { RightPanelMode } from '@/pages/project-workspace/rightPanelTabs';
import styles from '@/pages/project-workspace.module.css';

export type { ActiveArtifact };

/** CK-06（C-11）— refs 与纯值拆分：混合对象触发 react-hooks/refs 类型级污染
 *  推断（47 处纯值访问被误标 render 期读 ref），拆分后规则可正确区分。 */
export interface CenterPanelRefs {
  centerColRef: React.RefObject<HTMLElement>;
  /** UI-371 — 回调式测量 ref（可同时传给 chat / scheduled 两个 SessionFrameView 实例）。 */
  sessionFrameRef: React.Ref<HTMLDivElement>;
}

export interface CenterPanelContext {
  /** BLOCK-62 P1b — 列级 header（main 第一个子元素，flex:1 子项各自让位）。 */
  columnHeader?: React.ReactNode;

  // Project + conversation state
  project: Project;
  projectId: string | undefined;
  allProjects: Project[];
  activeConvId: string | null;
  conversations: ConversationSummary[];
  projectConversations: Record<string, ConversationSummary[]>;

  // Workspace mode + routing
  workspaceMode: WorkspaceMode;
  showPinnedSummary: boolean;

  // Layout（refs 已拆至 CenterPanelRefs——CK-06）
  bottomTerminalOpen: boolean;
  bottomTerminalHeight: number;
  leftOpen: boolean;
  rightOpen: boolean;
  inputHeight: number;
  summaryCardOpen: boolean;
  summaryVisibility: 'hidden' | 'compact' | 'float' | 'expanded';
  summaryOpenWidth: number;
  activeJob: ToolJob | null;
  activeWorkflow: HarnessWorkflowJobState | null;
  activeArtifact: ActiveArtifact | null;
  resultContext: ResultAgentComposerContext | null;
  resultEditSubmitting: boolean;
  resultAgentDraft: string;
  activeJobId: string | null;
  pendingArtifactName: string | null;
  recentJobs: ToolJob[];
  liveJobsPreview: ToolJob[];
  jobStats: JobStats;
  backendStatus: BackendStatus;

  // Domain state for search + scheduled
  jobs: ToolJob[];
  datasets: Dataset[];

  /** BLOCK-216 Q5 — pack 贡献的结果面（无匹配时保留核心 transitional 面）。 */
  packResultSurfaces: WorkSurfaceDescriptor[];

  // Handlers
  updateWorkspaceMode: (next: WorkspaceMode, replace?: boolean, jobId?: string | null) => void;
  openRightPanel: (tab: RightPanelMode) => void;
  switchToProject: (id: string) => void;
  navigate: (to: string) => void;
  handleSwitchConversation: (convId: string) => void;
  setActiveConvId: (id: string | null) => void;
  setActiveJobId: (id: string | null) => void;
  setActiveArtifact: (a: ActiveArtifact | null) => void;
  setResultAgentDraft: (draft: string) => void;
  onResultEditSubmit: (submission: ResultEditSubmission) => boolean | void;
  setBottomTerminalOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  setLeftOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setRightOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setSummaryOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  /** UI-448 加映 v15 — 侧聊面板开合（壳状态，摘要概览同机制）。 */
  sideChatOpen: boolean;
  setSideChatOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  handleShowPlugins: () => void;
  handleOpenResult: (jobId: string, projectId?: string | null) => void | Promise<boolean>;
  handleAskAgent: (prompt: string) => void;
  handleOpenWorkspacePath: () => void | Promise<void>;
  onPendingArtifactConsumed: () => void;
  onWorkflowChanged: () => void;
  openRevisionWorkspaceFile: (relativePath: string) => void;
  openResultBrowser: (url: string) => void;
  openScheduledResults: () => void;
  startColumnResize: (which: 'left' | 'right' | 'input') => (e: React.MouseEvent) => void;
}

export interface CenterPanelProps {
  ctx: CenterPanelContext;
  /** CK-06 — refs 独立传递（与纯值 ctx 分离，规避 refs 类型级污染推断）。 */
  refs: CenterPanelRefs;
}

/**
 * Middle column of the workspace. Pure renderer keyed on `ctx.workspaceMode` —
 * each WorkspaceMode produces a distinct inner layout.
 *
 * Owns no state of its own: every interaction is delegated back to the
 * parent via the `ctx` callbacks. ProjectWorkspace remains the single source
 * of truth until state is further decomposed into hooks.
 */
export function CenterPanel({ ctx, refs }: CenterPanelProps): React.ReactElement {
  const { workspaceMode, bottomTerminalOpen, bottomTerminalHeight } = ctx;
  const { centerColRef, sessionFrameRef } = refs;
  // UI-448 — 悬浮聊天面展开时中栏会话内容列让位（chat 模式才有会话内容可让）
  const sideChatOpen = ctx.sideChatOpen;
  const setSideChatOpen = ctx.setSideChatOpen;
  const [returnConversationMs, setReturnConversationMs] = React.useState<number | null>(null);
  // Reuse the durable conversation run; the result Composer does not create a
  // second progress store and therefore survives tool switches/stop/failure by
  // the same rules as the conversation surface.
  const activeRun = useConversationRun(ctx.activeConvId);
  const activeResultProgress = resultEditProgressForContext(
    activeRun,
    ctx.resultContext?.status === 'ready' ? ctx.resultContext.contextToken : null,
  );
  const resultMode = workspaceMode === 'result' || workspaceMode === 'code' || workspaceMode === 'compare' || workspaceMode === 'history';
  const resultSurfaceHost = resolveResultSurfaceHost(ctx.packResultSurfaces ?? [], ctx.activeArtifact, workspaceMode);
  // BLOCK-236 — tab 级接管：取数失败即回落核心（不渲染空白 iframe）
  const packTabState = usePackTabData(
    resultSurfaceHost.tab,
    { jobId: ctx.activeJob?.id, revisionId: ctx.activeArtifact?.revisionId },
    getApiPrefix(),
  );
  const downgradeToCore = shouldDowngradeToCore(resultSurfaceHost.tab, packTabState);
  const packResultData = usePackResultData(resultSurfaceHost.source === 'pack' ? ctx.activeArtifact : null);
  const truthStatus = typeof ctx.activeArtifact?.truthStatus === 'string'
    ? ctx.activeArtifact.truthStatus
    : typeof ctx.activeWorkflow?.artifactTruth?.status === 'string'
      ? ctx.activeWorkflow.artifactTruth.status
      : null;
  const contextTitle = ctx.activeArtifact?.label || ctx.activeArtifact?.name || ctx.activeJob?.name || ctx.activeJob?.tool_id || '分析结果';
  const contextConclusion = ctx.activeArtifact?.availabilityStatus === 'unavailable'
    ? '科学校验记录仍保留，但当前产物文件不可读取；请重试预览或让 Agent 检查恢复。'
    : ctx.activeArtifact?.conclusion || (
    truthStatus === 'valid'
      ? '结果已经过产物校验，可继续查看、比较或交给 Agent 解释。'
      : truthStatus === 'blocked'
        ? '结果当前被阻断，请先查看原因或让 Agent 处理。'
        : '正在读取结果与可信状态，不会把未知信息标记为成功。'
  );

  const askAboutCurrentResult = React.useCallback(() => {
    // BIO-6（BIO-D4 裁决 b）— 解读统一走 Agent + result_summary 链，prompt 经
    // resultSurface 单一构造器出词：锚定任务与产物坐标，不接遗留模板。
    ctx.handleAskAgent(buildResultInterpretationPrompt({
      jobId: ctx.activeJob?.id,
      artifactName: ctx.activeArtifact?.name || contextTitle,
    }));
    ctx.updateWorkspaceMode('chat');
  }, [contextTitle, ctx.activeJob, ctx.activeArtifact, ctx.handleAskAgent, ctx.updateWorkspaceMode]);

  const onRevisionAgentRequest = React.useCallback((request: 'explain' | 'modify' | 'replay') => {
    if (ctx.resultContext?.status !== 'ready' || !ctx.resultContext.contextToken) return;
    const requestedOutcome = request === 'explain'
      ? '请解释当前 Revision 对应的精确代码、参数和复现边界，不要执行修改。'
      : request === 'modify'
        ? '请基于当前 Revision 的精确代码提出修改方案；先说明影响并等待确认，不要覆盖当前或历史版本。'
        : '请先展示当前 Revision 的输入、参数、运行时和副作用确认摘要；未经明确确认不要执行受控重放。';
    ctx.onResultEditSubmit({
      origin: 'agent',
      completionExpectation: 'none',
      requestedOutcome,
      parameterPatch: {},
      scientificConfirmed: false,
      contextToken: ctx.resultContext.contextToken,
    });
  }, [ctx.onResultEditSubmit, ctx.resultContext]);

  React.useLayoutEffect(() => {
    if (workspaceMode !== 'chat') return;
    const duration = completeResultSurfaceMeasure({
      start: RESULT_SURFACE_PERFORMANCE_MARKS.returnStart,
      end: RESULT_SURFACE_PERFORMANCE_MARKS.returnEnd,
      measure: RESULT_SURFACE_PERFORMANCE_MARKS.returnMeasure,
    });
    if (duration !== null) setReturnConversationMs(duration);
  }, [workspaceMode]);

  return (
    <main
      className={styles.centerCol}
      ref={centerColRef}
      style={{ paddingBottom: bottomTerminalOpen ? bottomTerminalHeight : 0 }}
      data-return-conversation-ms={returnConversationMs === null ? undefined : returnConversationMs.toFixed(2)}
    >
      {ctx.columnHeader}
      {/* UI-417 — 侧边聊天悬挂化：常驻把手 + 滑出 overlay。
          UI-448 加映 v3 — 悬挂面自立每项目独立侧聊会话（不再镜像中栏 activeConvId），
          中栏会话与悬挂面互不干扰；ownsCopilotAsk 归属仍在中央 SimpleChat。
          UI-448 加映 v10 — 挂载点迁入 SessionFrameView 的 session layout
          （与摘要卡同定位基准、同右缘），见下方 SessionFrameView。 */}
      <div
        className={`${styles.workspaceProjectionLayer} ${workspaceMode === 'chat' ? styles.workspaceProjectionLayerActive : ''}`}
        aria-hidden={workspaceMode !== 'chat'}
        data-projection="conversation"
      >
        <SessionFrameView
          ctx={ctx}
          sessionFrameRef={sessionFrameRef}
          variant="chat"
          sideChatOpen={sideChatOpen}
          onSideChatOpenChange={setSideChatOpen}
        >
          <div
            className={styles.agentMain}
          >
            {ctx.project && ctx.projectId && (
              <SimpleChat
                // The center conversation is the single owner of copilotAsk: it
                // stays mounted in every mode, so a prompt dispatched from a
                // result reaches it. The right-panel chat tab must not also
                // subscribe.
                ownsCopilotAsk
                projectId={ctx.projectId}
                conversationId={ctx.activeConvId}
                onConversationChange={ctx.setActiveConvId}
                inputHeight={ctx.inputHeight}
              />
            )}
          </div>
        </SessionFrameView>
      </div>
      {resultMode && (
        <div className={`${styles.workspaceProjectionLayer} ${styles.workspaceProjectionLayerActive}`} data-projection={workspaceMode}>
            <ResultStudioCanvas
              mode={workspaceMode}
            canProjectSource={Boolean(ctx.activeArtifact?.revisionId)}
            composer={workspaceMode === 'result' && ctx.activeArtifact ? (
              <ResultAgentComposer
                context={ctx.resultContext}
                draft={ctx.resultAgentDraft}
                onDraftChange={ctx.setResultAgentDraft}
                onSubmit={ctx.onResultEditSubmit}
                submitting={ctx.resultEditSubmitting}
                progress={activeResultProgress}
              />
            ) : null}
            contextBar={workspaceMode === 'result' ? null : (
              <ResultStudioContextBar
                title={contextTitle}
                trust={describeTruthStatus(truthStatus, ctx.activeJob?.status)}
                availabilityStatus={ctx.activeArtifact?.availabilityStatus}
                conclusion={contextConclusion}
                revisionLabel={shortRevisionLabel(ctx.activeArtifact?.revisionId, ctx.activeArtifact?.revisionOrdinal)}
                selectionLabel={describeSelection(ctx.activeArtifact?.selection)}
                onBack={() => ctx.updateWorkspaceMode('chat')}
                onAskAgent={askAboutCurrentResult}
                activeMode={workspaceMode}
                canReviewVersions={!!ctx.activeArtifact?.artifactFamilyId}
                canProjectSource={Boolean(ctx.activeArtifact?.revisionId)}
                onModeChange={(mode) => ctx.updateWorkspaceMode(mode, true, ctx.activeJob?.id || null)}
              />
            )}
          >
            {ctx.activeJob ? (
              resultSurfaceHost.descriptor && !downgradeToCore ? (
                <div data-result-surface-source="pack" data-pack-tab={resultSurfaceHost.tab} style={{ display: 'contents' }}>
                  <PackSurfaceFrame
                    descriptor={resultSurfaceHost.descriptor}
                    projectId={ctx.projectId}
                    conversationId={ctx.activeConvId}
                    artifactContext={{
                      jobId: ctx.activeJob.id,
                      toolId: ctx.activeJob.tool_id,
                      name: ctx.activeArtifact?.name ?? null,
                      type: ctx.activeArtifact?.type ?? null,
                      semanticKind: ctx.activeArtifact?.semanticKind ?? null,
                      revisionId: ctx.activeArtifact?.revisionId ?? null,
                      truthStatus: ctx.activeArtifact?.truthStatus ?? null,
                      url: ctx.activeArtifact?.url ?? null,
                    }}
                    resultData={packResultData.data}
                    tab={resultSurfaceHost.tab ?? null}
                    tabData={packTabState.data ?? null}
                  />
                </div>
              ) : (
              <div
                data-result-surface-source="core-transitional"
                data-fallback-reason={downgradeToCore ? packTabState.reason : resultSurfaceHost.reason}
                style={{ display: 'contents' }}
              >
              <ResultView
                project={ctx.project}
                conversationId={ctx.activeConvId}
                job={ctx.activeJob}
                workflow={ctx.activeWorkflow}
                activeArtifact={ctx.activeArtifact}
                onActiveArtifactChange={ctx.setActiveArtifact}
                onAskAgent={ctx.handleAskAgent}
                onWorkflowChanged={ctx.onWorkflowChanged}
                onAgentCodeRequest={onRevisionAgentRequest}
                replayContext={ctx.resultContext?.status === 'ready' && ctx.resultContext.contextToken
                  ? { conversationId: ctx.activeConvId, contextToken: ctx.resultContext.contextToken }
                  : null}
                onOpenRevisionWorkspaceFile={ctx.openRevisionWorkspaceFile}
                pendingArtifactName={ctx.pendingArtifactName}
                onPendingArtifactConsumed={ctx.onPendingArtifactConsumed}
                onOpenBrowser={ctx.openResultBrowser}
                onBack={() => ctx.updateWorkspaceMode('chat')}
                onAskCurrentResult={askAboutCurrentResult}
                mode={workspaceMode}
                onModeChange={(mode, jobId) => ctx.updateWorkspaceMode(mode, true, jobId || ctx.activeJob?.id || null)}
              />
              </div>
              )
            ) : (
              <ResultsLibrary
                projectId={ctx.projectId}
                jobs={ctx.jobs}
                onOpenJob={(jobId) => void ctx.handleOpenResult(jobId, ctx.projectId)}
              />
            )}
          </ResultStudioCanvas>
        </div>
      )}
      {workspaceMode === 'scheduled' && (
        <SessionFrameView ctx={ctx} sessionFrameRef={sessionFrameRef}>
          <ScheduledWorkspacePanel
            onBackToChat={() => ctx.updateWorkspaceMode('chat')}
          />
        </SessionFrameView>
      )}
      {/* UI-365 — settings 模式退役：DesktopSettingsPanel 独立页化 /settings */}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Internal helpers — small layout pieces extracted so the parent shell stays
// flat and easy to scan.
// ---------------------------------------------------------------------------

function SessionFrameView({
  ctx,
  sessionFrameRef,
  children,
  variant = 'default',
  sideChatOpen = false,
  onSideChatOpenChange,
}: {
  ctx: CenterPanelContext;
  sessionFrameRef: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
  variant?: 'default' | 'chat';
  /** UI-448 加映 v8 — 会话面板开启时摘要悬浮封顶上半，两面板同屏不叠加。 */
  sideChatOpen?: boolean;
  /** UI-448 加映 v15 — 侧聊面板收起回调（列区 ✕ 经它回写壳状态）。 */
  onSideChatOpenChange?: (open: boolean) => void;
}): React.ReactElement {
  // HLE-C4R: surface the active conversation's durable-loop projection in the
  // pinned summary. Reads the same shared run store the chat renders from, so
  // there is no second source of completion truth.
  const activeRun = useConversationRun(ctx.activeConvId);
  // BLOCK-97 — 任务清单（会话级存储：run 终态后末次清单保留，下一轮开始清除）
  const todoList = useConversationTodoList(ctx.activeConvId);
  // BLOCK-94 / UI-402 — 知识溯源（本轮注入的知识块，摘要卡节渲染）
  const citations = useConversationCitations(ctx.activeConvId);
  const durableLoop = useDurableConversationLoop(
    ctx.project.id,
    ctx.activeConvId,
    activeRun?.loop
  );
  // UI-448 加映 v12 — 宽窄判定与摘要切换点同源（summaryVisibility 由
  // sessionFrameWidth 纯派生：expanded ⟺ 宽窗/未测量），保证两卡同刻切换。
  const wide = ctx.summaryVisibility === 'expanded';
  // UI-448 加映 v25 — 摘要浮卡拖宽偏好优先；未拖过回落 summaryOpenWidth
  const [persistedSummaryWidth, setPersistedSummaryWidth] = React.useState<number | null>(
    () => readPersistedFloatWidth('petri:summary-float-width')
  );
  const summaryFloatWidth = persistedSummaryWidth ?? ctx.summaryOpenWidth;
  // UI-448 加映 v26 — 悬浮/钉住列两形态共用同一拖宽偏好与回调
  const summaryResizeHandlers = {
    width: summaryFloatWidth,
    onWidthChange: setPersistedSummaryWidth,
    onCommit: (w: number) => {
      setPersistedSummaryWidth(w);
      persistFloatWidth('petri:summary-float-width', w);
    },
  };

  return (
    <div
      className={`${styles.workspaceSessionLayout} ${
        variant === 'chat' ? styles.workspaceSessionFrameChat : ''
      } ${sideChatOpen ? styles.workspaceSessionLayoutSideChatOpen : ''}`}
      ref={sessionFrameRef}
    >
      <div className={styles.workspaceSessionLayout}>
        <div className={styles.workspaceSessionInset}>
          <div className={styles.workspaceSessionSurface}>
            <div className={styles.workspaceSessionContent}>
              {/*
                The conversation stays mounted in every mode. Visibility is already
                handled by CSS on the projection layer above (aria-hidden plus
                display:none/flex), so this React gate only destroyed the subtree.

                It made copilotAsk undeliverable: dispatchPetriEvent is a bare
                window.dispatchEvent with no buffering (lib/events.ts:113) and
                SimpleChat.tsx:568 is its only subscriber, so a manual edit
                submitted from ResultEditPanel — reachable from every result-opening
                path via openRightPanel('results') — was dropped in silence while
                handleResultEditSubmit's synchronous finally reset the button to
                idle. Unmounting also discarded and rebuilt the chat on every mode
                change, so keeping it does less work, not more.

                The sibling gate below still applies to the summary CARD, which is
                genuinely chat-only.
              */}
              {children}
            </div>
          </div>
        </div>
        {ctx.showPinnedSummary && ctx.summaryCardOpen && ctx.summaryVisibility === 'float' && (
          <div className={styles.workspaceSummaryFloat} aria-label="项目运行摘要（悬浮）">
            {/* UI-448 加映 v25 — 宽度走拖宽偏好（未拖过回落 summaryOpenWidth），
                左缘把手向左拖变宽、抬手记忆 */}
            <WorkspaceSummaryCard
              open
              visibility="float"
              width={summaryFloatWidth}              projectName={ctx.project.name}
              project={ctx.project}
              activeJob={ctx.activeJob}
              workflow={ctx.activeWorkflow}
              recentJobs={ctx.recentJobs}
              liveJobsPreview={ctx.liveJobsPreview}
              jobStats={ctx.jobStats}
              backendStatus={ctx.backendStatus}
              conversations={ctx.conversations}
              activeConversation={ctx.conversations.find((c) => c.id === ctx.activeConvId) ?? null}
              datasets={ctx.datasets}
              loop={durableLoop.loop}
              loopSummary={durableLoop.summary}
              todoList={todoList}
              citations={citations}
              onOpenScheduled={ctx.openScheduledResults}
              onSelectJob={(jobId) => {
                ctx.setActiveJobId(jobId);
                ctx.openRightPanel('results');
              }}
            />
            <FloatCardResizeHandle {...summaryResizeHandlers} />
          </div>
        )}
        {/* UI-448 加映 v12 — 右轨：摘要钉住列与侧聊列区垂直堆叠共享右缘；
            两者同由 summaryVisibility==='expanded'（宽窗）判定，切换点恒同步 */}
        {(ctx.showPinnedSummary && ctx.summaryCardOpen && ctx.summaryVisibility !== 'float')
          || (wide && sideChatOpen && ctx.projectId) ? (
        <div className={styles.workspaceRightRail}>
        {ctx.showPinnedSummary && ctx.summaryCardOpen && ctx.summaryVisibility !== 'float' && (
          <div className={styles.workspaceSummaryColumn}>
            {/* UI-448 加映 v26 — 钉住列形态同样可拖宽（v25 只适配了悬浮形态）：
                宽度与悬浮形态共用同一偏好，窄宽切换不跳变 */}
            <WorkspaceSummaryCard
              open
              visibility={ctx.summaryVisibility}
              width={summaryFloatWidth}
              projectName={ctx.project.name}
              project={ctx.project}
              activeJob={ctx.activeJob}
              workflow={ctx.activeWorkflow}
              recentJobs={ctx.recentJobs}
              liveJobsPreview={ctx.liveJobsPreview}
              jobStats={ctx.jobStats}
              backendStatus={ctx.backendStatus}
              conversations={ctx.conversations}
              activeConversation={ctx.conversations.find((c) => c.id === ctx.activeConvId) ?? null}
              datasets={ctx.datasets}
              loop={durableLoop.loop}
              loopSummary={durableLoop.summary}
              todoList={todoList}
              citations={citations}
              onOpenScheduled={ctx.openScheduledResults}
              onSelectJob={(jobId) => {
                ctx.setActiveJobId(jobId);
                ctx.openRightPanel('results');
              }}
            />
            <FloatCardResizeHandle {...summaryResizeHandlers} />
          </div>
        )}
        {/* UI-448 加映 v12 — 宽窗时侧聊是独立列区（占位、像摘要钉住列一样），
            窄窗时退回悬浮（把手 + 右下角浮面）。切换点与摘要同源
            （summaryVisibility==='expanded' ⟺ 宽窗）。 */}
        {wide && sideChatOpen && ctx.projectId && onSideChatOpenChange && (
          <SideChatDock
            key={ctx.projectId}
            projectId={ctx.projectId}
            sourceConversationId={ctx.activeConvId}
            variant="docked"
            open={sideChatOpen}
            onOpenChange={onSideChatOpenChange ?? (() => {})}
          />
        )}
        </div>
        ) : null}
        {/* UI-448 加映 v10 — 侧聊悬浮面与摘要卡同定位基准：同在 session layout 内
            right:0，右缘结构性同源（v8/v9 的跨参照系对齐补丁由此退役）。
            UI-448 加映 v12 — 仅窄窗用悬浮变体（宽窗走上面的独立列区）；
            收起态把手两态共用（宽窗收起时仍给入口）。 */}
        {variant === 'chat' && ctx.projectId && (
          <SideChatDock
            key={ctx.projectId}
            projectId={ctx.projectId}
            sourceConversationId={ctx.activeConvId}
            // 宽窗：面板已由上面的独立列区承载，这里只留常驻把手（图标仍在列区上方）
            surfaceSuppressed={wide && sideChatOpen}
            open={sideChatOpen}
            onOpenChange={onSideChatOpenChange ?? (() => {})}
            // UI-448 加映 v21 — 悬浮面宽度与摘要浮卡同源同值（v4 的「同宽 300px」
            // 与摘要实际 276–292 动态宽不一致，用户实测指认；缺省回落 300）
            width={ctx.summaryOpenWidth}
          />
        )}
      </div>
        {/* UI-448 加映 v16 — 入口按钮沉底：右下角常驻小气泡（开/收切换），
            与顶栏摘要概览按钮上下对应。
            UI-448 加映 v28 — FAB 挂到外层（带 padding 的 frame）而非内层布局：
            内层被外层 padding-right:14 推进且 overflow:hidden 会剪掉越界部分，
            与摘要按钮对齐所需的负偏移必被剪。外层 padding-box 右缘=分隔线，
            right:5px 与摘要按钮相对分隔线的内缩量一致 → 两钮中心线精确重合
            （IAB 实测 fabCenter==summaryCenter）。 */}
        {variant === 'chat' && ctx.projectId && (
          <button
            type="button"
            className={styles.sideChatFab}
            onClick={() => onSideChatOpenChange?.(!sideChatOpen)}
            aria-label={sideChatOpen ? '收起侧边聊天' : '侧边聊天'}
            aria-pressed={sideChatOpen}
            title={sideChatOpen ? '收起侧边聊天' : '侧边聊天'}
            data-testid="side-chat-fab"
          >
            <Icon name="message-circle" size={16} />
          </button>
        )}
    </div>
  );
}
