import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { DesktopDashboard } from '@/pages/_desktop-dashboard';
import ToolsPage from '@/pages/tools';
import FigCodePage from '@/pages/figcode';
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
  type BackendServiceItem,
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
  rightOpen: boolean;
  inputHeight: number;

  // Pinned summary card
  summaryCardOpen: boolean;
  summaryVisibility: 'hidden' | 'compact' | 'expanded';
  summaryOpenWidth: number;
  summaryOpenHeight: number;
  compactWorkspacePath: string;
  activeJob: ToolJob | null;
  activeArtifact: ActiveArtifact | null;
  activeJobId: string | null;
  backendSummary: BackendSummary;
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
  setRightOpen: (next: boolean) => void;
  setSummaryOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  handleShowTools: () => void;
  handleShowFigCode: () => void;
  handleShowPlugins: () => void;
  handleOpenResult: (jobId: string) => void | Promise<void>;
  handleAskAgent: (prompt: string) => void;
  handleOpenWorkspacePath: () => void | Promise<void>;
  openScheduledResults: () => void;
  startColumnResize: (which: 'left' | 'right' | 'input') => (e: React.MouseEvent) => void;
  startSummaryResize: (e: React.PointerEvent | React.MouseEvent) => void;
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
        <SessionFrameView ctx={ctx}>
          <div className={styles.agentMain}>
            {ctx.project && ctx.projectId && (
              <SimpleChat
                projectId={ctx.projectId}
                conversationId={ctx.activeConvId}
                onConversationChange={ctx.setActiveConvId}
                onOpenResult={ctx.handleOpenResult}
                inputHeight={ctx.inputHeight}
              />
            )}
          </div>
          <div className={styles.resizeHandleH} onMouseDown={ctx.startColumnResize('input')} />
        </SessionFrameView>
      )}
      {workspaceMode === 'scheduled' && (
        <SessionFrameView ctx={ctx}>
          <ScheduledWorkspacePanel
            project={ctx.project}
            jobs={ctx.jobs}
            activeJobId={ctx.activeJobId}
            activeArtifact={ctx.activeArtifact}
            onSelectJob={(jobId) => {
              ctx.setActiveJobId(jobId);
              ctx.openRightPanel('results');
            }}
            onActiveArtifactChange={ctx.setActiveArtifact}
            onAskAgent={ctx.handleAskAgent}
            onBackToChat={() => ctx.updateWorkspaceMode('chat')}
          />
        </SessionFrameView>
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
        ctx.updateWorkspaceMode('scheduled');
        ctx.openRightPanel('results');
      }}
      onOpenTools={ctx.handleShowTools}
      onOpenFigCode={ctx.handleShowFigCode}
      onOpenPlugins={ctx.handleShowPlugins}
    />
  );
}

function SessionFrameView({
  ctx,
  children,
}: {
  ctx: CenterPanelContext;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={styles.workspaceSessionFrame} ref={ctx.sessionFrameRef}>
      <div className={styles.workspaceSessionSurface}>
        <div className={styles.workspaceSessionContent}>
          {ctx.showPinnedSummary && <SessionChrome ctx={ctx} />}
          {children}
        </div>
      </div>
      <div className={styles.workspaceSummaryOverlay}>
        {ctx.showPinnedSummary && (
          <WorkspaceSummaryCard
            open={ctx.summaryCardOpen}
            visibility={ctx.summaryVisibility}
            width={ctx.summaryOpenWidth}
            height={ctx.summaryOpenHeight}
            projectName={ctx.project.name}
            projectModality={ctx.project.modality}
            compactWorkspacePath={ctx.compactWorkspacePath}
            activeJob={ctx.activeJob}
            activeArtifact={ctx.activeArtifact}
            backendSummary={ctx.backendSummary}
            liveJobsPreview={ctx.liveJobsPreview}
            jobStats={ctx.jobStats}
            onResize={ctx.startSummaryResize}
            onOpenScheduled={ctx.openScheduledResults}
            onSelectJob={(jobId) => {
              ctx.setActiveJobId(jobId);
              ctx.updateWorkspaceMode(ctx.workspaceMode === 'chat' ? 'scheduled' : ctx.workspaceMode);
              ctx.openRightPanel('results');
            }}
            onOpenWorkspace={ctx.handleOpenWorkspacePath}
          />
        )}
      </div>
    </div>
  );
}

function SessionChrome({ ctx }: { ctx: CenterPanelContext }): React.ReactElement {
  return (
    <div className={styles.workspaceSessionChrome}>
      <div className={styles.workspaceSessionChromeLeft}>
        <Icon name="file" size={14} />
        <div className={styles.workspaceSessionChromeText}>
          <span className={styles.workspaceSessionChromeEyebrow}>会话信息</span>
          <span className={styles.workspaceSessionChromeTitle}>{ctx.project.name}</span>
        </div>
      </div>
      <div className={styles.workspaceSessionChromeActions}>
        <button
          type="button"
          className={styles.workspaceSessionChromeBtn}
          onClick={() => ctx.setSummaryOpen((next) => !next)}
          title={ctx.summaryCardOpen ? '收起摘要' : '展开摘要'}
          aria-label={ctx.summaryCardOpen ? '收起摘要' : '展开摘要'}
        >
          <Icon name="list-details" size={17} />
        </button>
        {!ctx.rightOpen && (
          <button
            type="button"
            className={styles.workspaceSessionChromeBtn}
            onClick={() => ctx.setBottomTerminalOpen((value) => !value)}
            title={ctx.bottomTerminalOpen ? '隐藏终端' : '显示终端'}
            aria-label={ctx.bottomTerminalOpen ? '隐藏终端' : '显示终端'}
          >
            <Icon name="panel-bottom" size={17} />
          </button>
        )}
        {!ctx.rightOpen && (
          <button
            type="button"
            className={styles.workspaceSessionChromeBtn}
            onClick={() => ctx.setRightOpen(true)}
            title="显示右侧侧边栏"
            aria-label="显示右侧侧边栏"
          >
            <Icon name="panel-right" size={17} />
          </button>
        )}
      </div>
    </div>
  );
}
