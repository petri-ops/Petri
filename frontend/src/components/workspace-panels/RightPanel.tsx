import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import type { Project, ToolJob } from '@/lib/project-types';
import type { BackendStatus } from '@/lib/electron';
import type { HarnessWorkflowJobState } from '@/lib/harness-client';
import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';
import {
  type RightPanelMode,
  type ActiveArtifact,
  type ActiveWorkspaceFile,
  EmptyResult,
  ResultSidebarPanel,
  RightFileTree,
  TerminalPanel,
  BrowserPanel,
} from '@/pages/project-workspace';
import styles from '@/pages/project-workspace.module.css';

type DispatchSetter<T> = React.Dispatch<React.SetStateAction<T>>;

export interface RightPanelContext {
  // Layout
  width: number;
  bottomTerminalOpen: boolean;
  bottomTerminalHeight: number;

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
  activeArtifact: ActiveArtifact | null;
  setActiveArtifact: (a: ActiveArtifact | null) => void;
  openWorkspaceFiles: ActiveWorkspaceFile[];
  activeWorkspaceFile: ActiveWorkspaceFile | null;
  setActiveWorkspaceFile: (f: ActiveWorkspaceFile | null) => void;
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
  if (!visible) {
    if (workspaceMode !== 'chat' && workspaceMode !== 'scheduled') {
      return (
        <button
          type="button"
          className={styles.workspaceRightPanelToggle}
          onClick={() => ctx.setRightOpen(true)}
          title="显示右侧侧边栏"
          aria-label="显示右侧侧边栏"
        >
          <Icon name="panel-right" size={17} />
        </button>
      );
    }
    return null;
  }

  return (
    <>
      {onResize && <div className={styles.resizeHandleV} onMouseDown={onResize} />}
      <aside
        className={styles.rightCol}
        style={{
          width: ctx.rightTab === 'results'
            ? `var(--biof3-live-result-right-width, ${ctx.width}px)`
            : ctx.width,
          paddingBottom: ctx.bottomTerminalOpen ? ctx.bottomTerminalHeight : 0,
        }}
      >
        <div className={styles.resultPanel}>
          <div className={styles.resultPanelBody}>
            {ctx.openRightTabs.map((tab) => (
              <div
                key={tab}
                className={`${styles.rightPanelTabContent} ${
                  ctx.rightTab === tab ? styles.rightPanelTabContentActive : ''
                }`}
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
                  <ResultSidebarPanel
                    project={ctx.project}
                    job={ctx.activeJob}
                    workflow={ctx.activeWorkflow}
                    activeArtifact={ctx.activeArtifact}
                    onActiveArtifactChange={ctx.setActiveArtifact}
                    onAskAgent={ctx.handleAskAgent}
                  />
                )}
                {tab === 'files' && (
                  <RightFileTree
                    project={ctx.project}
                    openFiles={ctx.openWorkspaceFiles}
                    activeFile={ctx.activeWorkspaceFile}
                    onOpenFile={ctx.handleOpenWorkspaceFile}
                    onSelectFile={ctx.setActiveWorkspaceFile}
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
                    onNavigationStateChange={({ canGoBack, canGoForward }) => {
                      ctx.setBrowserCanGoBack(canGoBack);
                      ctx.setBrowserCanGoForward(canGoForward);
                    }}
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
