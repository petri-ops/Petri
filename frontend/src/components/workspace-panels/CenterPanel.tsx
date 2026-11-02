import React from 'react';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import {
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
import type { JobStats } from '@/components/workspace-panels/ResultView';
import { ScheduledWorkspacePanel } from '@/components/workspace-panels/ScheduledWorkspacePanel';
// UI-448 加映 v25 — 浮卡左缘拖宽把手 + 偏好持久化（摘要浮卡与会话浮面共用）
import {
  FloatCardResizeHandle,
  persistFloatWidth,
  readPersistedFloatWidth,
} from '@/components/workspace-panels/FloatCardResizer';
// UI-448 — 悬浮聊天面开态：中栏会话内容列让位（不遮切割），与 composer 让位同源
import type { RightPanelMode } from '@/pages/project-workspace/rightPanelTabs';
import styles from '@/pages/project-workspace.module.css';

// BLOCK-334 — 中央 result/code/compare/history 四态接管退役：结果查看统一由右栏
// 「结果」tab（work-surface/ResultsSurface）承载，中央永远是会话（或 scheduled 摘要）。
// pack 结果面解析 / 身份水化 / Composer / ResultsLibrary 随之迁出本文件。

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
  activeConvId: string | null;
  conversations: ConversationSummary[];

  // Workspace mode + routing
  workspaceMode: WorkspaceMode;
  showPinnedSummary: boolean;

  // Layout（refs 已拆至 CenterPanelRefs——CK-06）
  bottomTerminalOpen: boolean;
  bottomTerminalHeight: number;
  inputHeight: number;
  summaryCardOpen: boolean;
  summaryVisibility: 'hidden' | 'compact' | 'float' | 'expanded';
  summaryOpenWidth: number;
  activeJob: ToolJob | null;
  activeWorkflow: HarnessWorkflowJobState | null;
  recentJobs: ToolJob[];
  liveJobsPreview: ToolJob[];
  jobStats: JobStats;
  backendStatus: BackendStatus;
  datasets: Dataset[];

  // Handlers
  updateWorkspaceMode: (next: WorkspaceMode, replace?: boolean, jobId?: string | null) => void;
  openRightPanel: (tab: RightPanelMode) => void;
  handleSwitchConversation: (convId: string) => void;
  setActiveConvId: (id: string | null) => void;
  setActiveJobId: (id: string | null) => void;
  openScheduledResults: () => void;
}

export interface CenterPanelProps {
  ctx: CenterPanelContext;
  /** CK-06 — refs 独立传递（与纯值 ctx 分离，规避 refs 类型级污染推断）。 */
  refs: CenterPanelRefs;
}

/**
 * Middle column of the workspace. Pure renderer keyed on `ctx.workspaceMode` —
 * `chat` keeps the conversation projection visible, `scheduled` shows the
 * pinned-summary panel. Owns no state of its own: every interaction is
 * delegated back to the parent via the `ctx` callbacks.
 */
export function CenterPanel({ ctx, refs }: CenterPanelProps): React.ReactElement {
  const { workspaceMode, bottomTerminalOpen, bottomTerminalHeight } = ctx;
  const { centerColRef, sessionFrameRef } = refs;

  return (
    <main
      className={styles.centerCol}
      ref={centerColRef}
      style={{ paddingBottom: bottomTerminalOpen ? bottomTerminalHeight : 0 }}
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
      {workspaceMode === 'scheduled' && (
        <SessionFrameView ctx={ctx} sessionFrameRef={sessionFrameRef}>
          <ScheduledWorkspacePanel
            projectId={ctx.projectId}
            onBackToChat={() => ctx.updateWorkspaceMode('chat')}
            onOpenConversation={(convId) => {
              ctx.updateWorkspaceMode('chat');
              ctx.handleSwitchConversation(convId);
            }}
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
}: {
  ctx: CenterPanelContext;
  sessionFrameRef: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
  variant?: 'default' | 'chat';
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
  // UI-623 — 侧聊退役 docked 列后，此判定只服务摘要卡。
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
      }`}
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
        {/* UI-623 — 侧聊不再占固定右轨列：宽窗与窄窗统一为可拖动悬浮面
            （用户「悬浮无固定位置，可以移动到任意地方」）。右轨只保留摘要列。 */}
        {(ctx.showPinnedSummary && ctx.summaryCardOpen && ctx.summaryVisibility !== 'float') ? (
        <div className={styles.workspaceRightRail}>
          <div className={styles.workspaceSummaryColumn}>
            {/* UI-448 加映 v26 — 钉住列形态同样可拖宽（v25 只适配了悬浮形态）：
                宽度与悬浮形态共用同一偏好，窄宽切换不跳变 */}
            <WorkspaceSummaryCard
              open
              visibility={ctx.summaryVisibility}
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
        </div>
        ) : null}
        {/* UI-627（BLOCK-321）— 页内侧聊悬浮面与右下角 FAB 双退役：侧聊升级为
            frameless 原生独立窗（/window/side-chat，可拖出软件边界跨屏、OS 八方位
            resize），唯一入口 = 标题栏「侧聊」按钮（openSideChatWindow）。 */}
      </div>
    </div>
  );
}
