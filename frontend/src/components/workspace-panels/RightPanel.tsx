import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import type { Project, ToolJob } from '@/lib/project-types';
import type { BackendStatus } from '@/lib/electron';
import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';
import {
  RIGHT_PANEL_ITEMS,
  type RightPanelMode,
  type ActiveArtifact,
  type ActiveWorkspaceFile,
  EmptyResult,
  EmptyAnalysisResult,
  ResultView,
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
  activeArtifact: ActiveArtifact | null;
  setActiveArtifact: (a: ActiveArtifact | null) => void;
  openWorkspaceFiles: ActiveWorkspaceFile[];
  activeWorkspaceFile: ActiveWorkspaceFile | null;
  setActiveWorkspaceFile: (f: ActiveWorkspaceFile | null) => void;
  backendStatus: BackendStatus | null;
  browserUrl: string;

  // Handlers
  setBottomTerminalOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setRightOpen: (v: boolean) => void;
  setActiveConvId: (id: string | null) => void;
  handleAskAgent: (prompt: string) => void;
  handleOpenWorkspaceFile: (file: ActiveWorkspaceFile) => void;
  handleCloseWorkspaceFile: (path: string) => void;
  handleOpenResult: (jobId: string) => void | Promise<void>;
  handleOpenRightTerminal: () => void;
  handleOpenRightBrowser: () => void;
  handleOpenRightFiles: () => void;
  handleOpenRightChat: () => void;
  setBrowserUrl: (url: string) => void;
}

export interface RightPanelProps {
  ctx: RightPanelContext;
  visible: boolean;
  workspaceMode: WorkspaceMode;
  onResize: (e: React.MouseEvent) => void;
}

/**
 * Right column — multi-tab tool panel (工作台/结果/文件/后端/浏览器/聊天).
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
      <div className={styles.resizeHandleV} onMouseDown={onResize} />
      <aside
        className={styles.rightCol}
        style={{
          width: ctx.width,
          paddingBottom: ctx.bottomTerminalOpen ? ctx.bottomTerminalHeight : 0,
        }}
      >
        <div className={styles.resultPanel}>
          <div className={styles.resultPanelHeader}>
            <RightPanelTabs ctx={ctx} />
            <RightPanelAddMenu ctx={ctx} />
            <button
              className={`${styles.iconBtn} ${styles.rightPanelCollapseBtn}`}
              onClick={() => ctx.setBottomTerminalOpen((value) => !value)}
              title={ctx.bottomTerminalOpen ? '隐藏终端' : '显示终端'}
              aria-label={ctx.bottomTerminalOpen ? '隐藏终端' : '显示终端'}
            >
              <Icon name="panel-bottom" size={17} />
            </button>
            <button
              className={`${styles.iconBtn} ${styles.rightPanelCollapseBtn}`}
              onClick={() => ctx.setRightOpen(false)}
              title="隐藏右侧侧边栏"
              aria-label="隐藏右侧侧边栏"
            >
              <Icon name="panel-right" size={17} />
            </button>
          </div>
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
                    onOpenTerminal={ctx.handleOpenRightTerminal}
                    onOpenBrowser={ctx.handleOpenRightBrowser}
                    onOpenFiles={ctx.handleOpenRightFiles}
                    onOpenChat={ctx.handleOpenRightChat}
                  />
                )}
                {tab === 'results' &&
                  (ctx.activeJob ? (
                    <ResultView
                      job={ctx.activeJob}
                      activeArtifact={ctx.activeArtifact}
                      onActiveArtifactChange={ctx.setActiveArtifact}
                      onAskAgent={ctx.handleAskAgent}
                    />
                  ) : (
                    <EmptyAnalysisResult />
                  ))}
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
                    obscured={ctx.rightTab !== 'browser' || ctx.rightToolMenuOpen}
                  />
                )}
                {tab === 'chat' && (
                  <div className={styles.rightChatPanel}>
                    {ctx.project && ctx.projectId && (
                      <SimpleChat
                        projectId={ctx.projectId}
                        conversationId={ctx.activeConvId}
                        onConversationChange={ctx.setActiveConvId}
                        onOpenResult={ctx.handleOpenResult}
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

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function RightPanelTabs({ ctx }: { ctx: RightPanelContext }): React.ReactElement {
  return (
    <div className={styles.rightPanelTabs}>
      {ctx.openRightTabs.map((tab) => {
        const item = RIGHT_PANEL_ITEMS.find((candidate) => candidate.id === tab)!;
        return (
          <button
            type="button"
            key={tab}
            className={`${styles.rightPanelTab} ${
              ctx.rightTab === tab ? styles.rightPanelTabActive : ''
            }`}
            onClick={() => ctx.setRightTab(tab)}
            title={item.label}
          >
            <Icon name={item.icon} size={14} />
            <span>{item.label}</span>
            {ctx.openRightTabs.length > 1 && (
              <span
                className={styles.rightPanelTabClose}
                role="button"
                tabIndex={0}
                aria-label={`关闭${item.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  ctx.closeRightPanelTab(tab);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    ctx.closeRightPanelTab(tab);
                  }
                }}
              >
                <Icon name="x" size={11} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function RightPanelAddMenu({ ctx }: { ctx: RightPanelContext }): React.ReactElement {
  return (
    <div className={styles.rightPanelAddWrap}>
      <button
        type="button"
        className={styles.rightPanelAddBtn}
        onClick={() => ctx.setRightToolMenuOpen((value) => !value)}
        title="添加或切换工具"
        aria-label="添加或切换工具"
        aria-haspopup="menu"
        aria-expanded={ctx.rightToolMenuOpen}
      >
        <Icon name="plus" size={16} />
      </button>
      {ctx.rightToolMenuOpen && (
        <>
          <button
            type="button"
            className={styles.rightToolMenuOverlay}
            onClick={() => ctx.setRightToolMenuOpen(false)}
            aria-label="关闭工具菜单"
          />
          <div className={styles.rightToolMenu} role="menu">
            {RIGHT_PANEL_ITEMS.filter((item) => item.id !== 'home').map((item) => {
              const isOpen = ctx.openRightTabs.includes(item.id);
              const isUnavailable = item.id === 'results' && !ctx.activeJob;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={isOpen ? styles.rightToolMenuItemActive : ''}
                  disabled={isUnavailable}
                  onClick={() => {
                    ctx.openRightPanel(item.id);
                    ctx.setRightToolMenuOpen(false);
                  }}
                  role="menuitem"
                >
                  <Icon name={item.icon} size={14} />
                  <span>{item.label}</span>
                  {isOpen && <Icon name="check" size={13} />}
                </button>
              );
            })}
            <div className={styles.rightToolMenuDivider} />
            <button
              type="button"
              onClick={() => {
                ctx.openRightPanel('home');
                ctx.setRightToolMenuOpen(false);
              }}
              role="menuitem"
            >
              <Icon name="layout-grid" size={14} />
              <span>工具工作台</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}