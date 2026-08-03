import React from 'react';
import { SimpleChat } from '@/components/copilot/SimpleChat';
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
  TerminalPanel,
  BrowserPanel,
} from '@/pages/project-workspace';
import styles from '@/pages/project-workspace.module.css';

type DispatchSetter<T> = React.Dispatch<React.SetStateAction<T>>;

export interface RightPanelContext {
  // Layout
  width: number;

  // Project + conversation
  project: Project;
  projectId?: string;
  activeConvId: string | null;

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
  handleAskAgent: (prompt: string) => void;
  handleOpenWorkspaceFile: (file: ActiveWorkspaceFile) => void;
  handleCloseWorkspaceFile: (path: string) => void;
  handleOpenResult: (jobId: string, projectId?: string | null) => void | Promise<void>;
  handleOpenRightResults: () => void;
  handleOpenRightTerminal: () => void;
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

  if (!visible) {
    return null;
  }

  return (
    <>
      {onResize && <div className={styles.resizeHandleV} onMouseDown={onResize} />}
      <aside
        className={styles.rightCol}
        style={{ width: ctx.width }}
        data-workspace-mode={workspaceMode}
      >
        <div className={styles.resultPanel}>
          <div className={styles.resultPanelBody}>
            {ctx.openRightTabs.map((tab) => (
              <div
                key={tab}
                className={`${styles.rightPanelTabContent} ${
                  ctx.rightTab === tab ? styles.rightPanelTabContentActive : ''
                } ${tab === 'browser' ? styles.rightPanelBrowserTab : ''}`}
              >
                {tab === 'home' && (
                  <EmptyResult
                    project={ctx.project}
                    onOpenResults={ctx.handleOpenRightResults}
                    onOpenTerminal={ctx.handleOpenRightTerminal}
                    onOpenBrowser={ctx.handleOpenRightBrowser}
                    onOpenFiles={ctx.handleOpenRightFiles}
                    onOpenChat={ctx.handleOpenRightChat}
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
                    onCloseFile={ctx.handleCloseWorkspaceFile}
                  />
                )}
                {tab === 'terminal' && (
                  <TerminalPanel project={ctx.project} backendStatus={ctx.backendStatus} />
                )}
                {tab === 'browser' && (
                  <BrowserPanel
                    initialUrl={ctx.browserUrl}
                    onUrlChange={ctx.setBrowserUrl}
                    onNavigationStateChange={handleBrowserNavigationStateChange}
                    obscured={ctx.rightTab !== 'browser'}
                  />
                )}
                {tab === 'chat' && (
                  <div className={styles.rightChatPanel}>
                    {ctx.project && ctx.projectId && (
                      <SimpleChat
                        projectId={ctx.projectId}
                        conversationId={ctx.activeConvId}
                        onConversationChange={ctx.setActiveConvId}
                        inputHeight={96}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
