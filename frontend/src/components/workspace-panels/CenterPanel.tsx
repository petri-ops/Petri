import React from 'react';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import {
  resultEditProgressForContext,
  useConversationRun,
} from '@/components/copilot/conversationRunStore';
import { useDurableConversationLoop } from '@/hooks/useDurableConversationLoop';
import { PluginStorePanel } from '@/components/desktop/PluginStorePanel';
import { DesktopSettingsPanel } from '@/components/desktop/DesktopSettingsPanel';
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
import { WorkspaceSearchPanel } from '@/components/workspace-panels/WorkspaceSearchPanel';
import { ResultsLibrary } from '@/components/workspace-panels/ResultsLibrary';
import styles from '@/pages/project-workspace.module.css';

export type { ActiveArtifact };

export interface CenterPanelContext {
  // Project + conversation state
  project: Project;
  projectId: string | undefined;
  allProjects: Project[];
  activeConvId: string | null;
  conversations: ConversationSummary[];
  projectConversations: Record<string, ConversationSummary[]>;
  searchConversationIndex: Record<string, ConversationSummary[]>;

  // Workspace mode + routing
  workspaceMode: WorkspaceMode;
  workspaceSearchQuery: string;
  showPinnedSummary: boolean;

  // Layout refs
  centerColRef: React.RefObject<HTMLElement>;
  sessionFrameRef: React.RefObject<HTMLDivElement>;
  bottomTerminalOpen: boolean;
  bottomTerminalHeight: number;
  leftOpen: boolean;
  rightOpen: boolean;
  inputHeight: number;
  summaryCardOpen: boolean;
  summaryVisibility: 'hidden' | 'compact' | 'expanded';
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

  // Handlers
  updateWorkspaceMode: (next: WorkspaceMode, replace?: boolean, jobId?: string | null) => void;
  setWorkspaceSearchQuery: (q: string) => void;
  openRightPanel: (tab: 'home' | 'results' | 'files' | 'terminal' | 'browser' | 'chat' | 'analyze') => void;
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
  handleShowPlugins: () => void;
  handleOpenResult: (jobId: string, projectId?: string | null) => void | Promise<void>;
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
}

/**
 * Middle column of the workspace. Pure renderer keyed on `ctx.workspaceMode` —
 * each WorkspaceMode produces a distinct inner layout.
 *
 * Owns no state of its own: every interaction is delegated back to the
 * parent via the `ctx` callbacks. ProjectWorkspace remains the single source
 * of truth until state is further decomposed into hooks.
 */
export function CenterPanel({ ctx }: CenterPanelProps): React.ReactElement {
  const { workspaceMode, bottomTerminalOpen, bottomTerminalHeight, centerColRef } = ctx;
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
    ctx.handleAskAgent(`请解释当前结果“${contextTitle}”的主要结论、可信边界和最合适的下一步。`);
    ctx.updateWorkspaceMode('chat');
  }, [contextTitle, ctx.handleAskAgent, ctx.updateWorkspaceMode]);

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
      {workspaceMode === 'search' && (
        <WorkspaceSearchView ctx={ctx} />
      )}
      <div
        className={`${styles.workspaceProjectionLayer} ${workspaceMode === 'chat' ? styles.workspaceProjectionLayerActive : ''}`}
        aria-hidden={workspaceMode !== 'chat'}
        data-projection="conversation"
      >
        <SessionFrameView ctx={ctx} variant="chat">
          <div className={styles.agentMain}>
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
            ) : (
              <ResultsLibrary
                projectId={ctx.projectId}
                jobs={ctx.jobs}
                onOpenJob={(jobId) => ctx.handleOpenResult(jobId, ctx.projectId)}
              />
            )}
          </ResultStudioCanvas>
        </div>
      )}
      {workspaceMode === 'scheduled' && (
        <SessionFrameView ctx={ctx}>
          <ScheduledWorkspacePanel
            onBackToChat={() => ctx.updateWorkspaceMode('chat')}
          />
        </SessionFrameView>
      )}
      {workspaceMode === 'plugins' && (
        <div className={styles.workspaceModeSurface}>
          <PluginStorePanel onClose={() => ctx.updateWorkspaceMode('chat')} />
        </div>
      )}
      {workspaceMode === 'settings' && (
        <div className={styles.workspaceModeSurface}>
          <DesktopSettingsPanel onClose={() => ctx.updateWorkspaceMode('chat')} />
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Internal helpers — small layout pieces extracted so the parent shell stays
// flat and easy to scan.
// ---------------------------------------------------------------------------

function WorkspaceSearchView({ ctx }: { ctx: CenterPanelContext }): React.ReactElement {
  const flattened = Object.entries({
    ...ctx.searchConversationIndex,
    ...ctx.projectConversations,
    ...(ctx.projectId ? { [ctx.projectId]: ctx.conversations } : {}),
  }).flatMap(([pid, list]) => list.map((item) => ({ ...item, project_id: item.project_id || pid })));

  return (
    <WorkspaceSearchPanel
      query={ctx.workspaceSearchQuery}
      onQueryChange={ctx.setWorkspaceSearchQuery}
      projects={ctx.allProjects}
      currentProjectId={ctx.projectId || ''}
      conversations={flattened}
      jobs={ctx.jobs}
      datasets={ctx.datasets}
      onOpenProject={(id) => {
        ctx.switchToProject(id);
        ctx.updateWorkspaceMode('chat');
      }}
      onOpenConversation={(pid, convId) => {
        if (pid && pid !== ctx.projectId) ctx.navigate(`/project/${pid}`);
        ctx.updateWorkspaceMode('chat');
        ctx.setActiveConvId(convId);
      }}
      onOpenScheduled={(jobId) => {
        ctx.setActiveJobId(jobId);
        ctx.openRightPanel('results');
      }}
      onOpenPlugins={ctx.handleShowPlugins}
    />
  );
}

function SessionFrameView({
  ctx,
  children,
  variant = 'default',
}: {
  ctx: CenterPanelContext;
  children: React.ReactNode;
  variant?: 'default' | 'chat';
}): React.ReactElement {
  // HLE-C4R: surface the active conversation's durable-loop projection in the
  // pinned summary. Reads the same shared run store the chat renders from, so
  // there is no second source of completion truth.
  const activeRun = useConversationRun(ctx.activeConvId);
  const durableLoop = useDurableConversationLoop(
    ctx.project.id,
    ctx.activeConvId,
    activeRun?.loop
  );

  return (
    <div
      className={`${styles.workspaceSessionFrame} ${
        variant === 'chat' ? styles.workspaceSessionFrameChat : ''
      }`}
      ref={ctx.sessionFrameRef}
    >
      <div className={styles.workspaceSessionLayout}>
        <div className={styles.workspaceSessionInset}>
          <div className={styles.workspaceSessionSurface}>
            <div className={styles.workspaceSessionContent}>
              {/*
                The conversation stays mounted in every mode. Visibility is already
                handled by CSS on the projection layer above (aria-hidden plus
                display:none/flex), so this React gate only destroyed the subtree.

                It made copilotAsk undeliverable: dispatchGewuEvent is a bare
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
        {ctx.showPinnedSummary && ctx.summaryCardOpen && (
          <div className={styles.workspaceSummaryColumn}>
            <WorkspaceSummaryCard
              open
              visibility={ctx.summaryVisibility}
              width={ctx.summaryOpenWidth}
              projectName={ctx.project.name}
              activeJob={ctx.activeJob}
              workflow={ctx.activeWorkflow}
              recentJobs={ctx.recentJobs}
              liveJobsPreview={ctx.liveJobsPreview}
              jobStats={ctx.jobStats}
              backendStatus={ctx.backendStatus}
              loop={durableLoop.loop}
              loopSummary={durableLoop.summary}
              onOpenScheduled={ctx.openScheduledResults}
              onSelectJob={(jobId) => {
                ctx.setActiveJobId(jobId);
                ctx.openRightPanel('results');
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
