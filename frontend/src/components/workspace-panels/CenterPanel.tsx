import React from 'react';
import { DesktopDashboard } from '@/pages/_desktop-dashboard';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import { PluginStorePanel } from '@/components/desktop/PluginStorePanel';
import { DesktopSettingsPanel } from '@/components/desktop/DesktopSettingsPanel';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import type { ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';
import { WorkspaceSummaryCard } from '@/components/workspace-panels/WorkspaceSummaryCard';
import {
  WorkspaceSearchPanel,
  ScheduledWorkspacePanel,
  type ActiveArtifact,
  type BackendSummary,
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
  activeArtifact: ActiveArtifact | null;
  activeJobId: string | null;
  backendSummary: BackendSummary;
  recentJobs: ToolJob[];
  liveJobsPreview: ToolJob[];
  jobStats: JobStats;

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

  return (
    <main
      className={styles.centerCol}
      ref={centerColRef}
      style={{ paddingBottom: bottomTerminalOpen ? bottomTerminalHeight : 0 }}
    >
      {workspaceMode === 'cloud' && (
        <div className={styles.workspaceEmbeddedPage}>
          <DesktopDashboard embedded activeProject={ctx.project} />
        </div>
      )}
      {workspaceMode === 'search' && (
        <WorkspaceSearchView ctx={ctx} />
      )}
      {workspaceMode === 'chat' && (
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
  return (
    <div
      className={`${styles.workspaceSessionFrame} ${
        variant === 'chat' ? styles.workspaceSessionFrameChat : ''
      }`}
      ref={ctx.sessionFrameRef}
      style={{
        ['--workspace-summary-reserve-right' as string]: ctx.summaryCardOpen
          ? `${ctx.summaryOpenWidth + 28}px`
          : '0px',
      }}
    >
      <div className={styles.workspaceSessionSurface}>
        <div className={styles.workspaceSessionContent}>
          {ctx.showPinnedSummary && children}
        </div>
      </div>
      <div className={styles.workspaceSummaryOverlay}>
        {ctx.showPinnedSummary && (
          <WorkspaceSummaryCard
            open={ctx.summaryCardOpen}
            visibility={ctx.summaryVisibility}
            width={ctx.summaryOpenWidth}
            projectName={ctx.project.name}
            activeJob={ctx.activeJob}
            recentJobs={ctx.recentJobs}
            backendSummary={ctx.backendSummary}
            liveJobsPreview={ctx.liveJobsPreview}
            jobStats={ctx.jobStats}
            onOpenScheduled={ctx.openScheduledResults}
            onSelectJob={(jobId) => {
              ctx.setActiveJobId(jobId);
              ctx.openRightPanel('results');
            }}
          />
        )}
      </div>
    </div>
  );
}
