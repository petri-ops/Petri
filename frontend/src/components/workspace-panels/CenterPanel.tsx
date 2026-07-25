import React from 'react';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import { useConversationRun } from '@/components/copilot/conversationRunStore';
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
  completeResultSurfaceMeasure,
  describeSelection,
  describeTruthStatus,
  RESULT_SURFACE_PERFORMANCE_MARKS,
  shortRevisionLabel,
} from '@/components/result-studio/resultSurface';
import {
  WorkspaceSearchPanel,
  ScheduledWorkspacePanel,
  ResultView,
  type ActiveArtifact,
  type JobStats,
} from '@/pages/project-workspace';
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
  updateWorkspaceMode: (next: WorkspaceMode, replace?: boolean) => void;
  setWorkspaceSearchQuery: (q: string) => void;
  openRightPanel: (tab: 'home' | 'results' | 'files' | 'terminal' | 'browser' | 'chat') => void;
  switchToProject: (id: string) => void;
  navigate: (to: string) => void;
  setActiveConvId: (id: string | null) => void;
  setActiveJobId: (id: string | null) => void;
  setActiveArtifact: (a: ActiveArtifact | null) => void;
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
  const resultMode = workspaceMode === 'result' || workspaceMode === 'compare';
  const truthStatus = typeof ctx.activeArtifact?.truthStatus === 'string'
    ? ctx.activeArtifact.truthStatus
    : typeof ctx.activeWorkflow?.artifactTruth?.status === 'string'
      ? ctx.activeWorkflow.artifactTruth.status
      : null;
  const contextTitle = ctx.activeArtifact?.label || ctx.activeArtifact?.name || ctx.activeJob?.name || ctx.activeJob?.tool_id || '分析结果';
  const contextConclusion = ctx.activeArtifact?.conclusion || (
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
            contextBar={(
              <ResultStudioContextBar
                title={contextTitle}
                trust={describeTruthStatus(truthStatus, ctx.activeJob?.status)}
                conclusion={contextConclusion}
                revisionLabel={shortRevisionLabel(ctx.activeArtifact?.revisionId)}
                selectionLabel={describeSelection(ctx.activeArtifact?.selection)}
                onBack={() => ctx.updateWorkspaceMode('chat')}
                onAskAgent={askAboutCurrentResult}
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
                pendingArtifactName={ctx.pendingArtifactName}
                onPendingArtifactConsumed={ctx.onPendingArtifactConsumed}
                onOpenBrowser={ctx.openResultBrowser}
              />
            ) : (
              <div className={styles.resultSurfaceEmpty}>尚未选择分析结果</div>
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
              {ctx.showPinnedSummary && children}
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
