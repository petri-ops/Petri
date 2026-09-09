import React from 'react';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import type { Project, ToolJob } from '@/lib/project-types';
import type { BackendStatus } from '@/lib/electron';
import type { HarnessWorkflowJobState } from '@/lib/harness-client';
import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';
import { ResultStudioInspector } from '@/components/result-studio/ResultStudioSurface';
import { GitRepositoryConsent } from '@/components/result-studio/GitRepositoryConsent';
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
import { tools as staticTools } from '@/pages/_data';
import { AnalysisLaunchPanel } from '@/components/workspace-panels/AnalysisLaunchPanel';
// BLOCK-28.5 — 审阅并入右侧边栏 tab 体系（复用 dock 紧凑形态，填满 tab 容器）
import { ReviewMode } from '@/components/desktop/WorkingTreeReview/ReviewMode';
// BLOCK-68 / UI-317 — 模型 I/O 信息流 dock（原 composer ⋯ 菜单 overlay 迁入）
import { LlmTranscriptViewer } from '@/components/copilot/LlmTranscriptViewer';
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
        style={{ width: `var(--gewu-live-right-width, ${ctx.width}px)` }}
        data-workspace-mode={workspaceMode}
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
                    onOpenTerminal={ctx.handleOpenRightTerminal}
                    onOpenBrowser={ctx.handleOpenRightBrowser}
                    onOpenFiles={ctx.handleOpenRightFiles}
                    onOpenChat={ctx.handleOpenRightChat}
                    onOpenReview={() => ctx.openRightPanel('review')}
                  />
                )}
                {tab === 'results' && ctx.projectId && (
                  <GitRepositoryConsent projectId={ctx.projectId} />
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
                    onAskAgent={ctx.handleAskAgent}
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
                {tab === 'analyze' && (
                  <AnalysisLaunchPanel
                    tools={staticTools}
                    onLaunch={(tool) => {
                      ctx.handleAskAgent(`请运行「${tool.title}」分析（${tool.category}）。`);
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
