// ============================================================
// ResultView — center column result display
// UI-146: T85 路由化拆上帝组件·增量4
//   抽取 ResultArtifactShell + ResultView（及其本地类型/helper）到独立文件，
//   切断 CenterPanel -> project-workspace 关于结果视图的循环依赖。
//   本文件仅依赖外部模块与随本文件迁移的本地类型/helper，不 import project-workspace。
// ============================================================
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Icon, type IconName } from '@/components/icons/Icon';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import { BottomTerminal } from '@/components/workspace-panels/BottomTerminal';
import { DataIntakeControl } from '@/components/workspace-panels/DataIntakeControl';
import { WorkspaceFileIcon } from '@/components/workspace-panels/WorkspaceFileIcon';
import { getProject, listProjectJobs, listDatasetsByProject, listProjects, updateProject, createProject, setProjectStatus } from '@/lib/project-store';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { buildPreviewTable } from '@/lib/file-preview/buildPreviewTable';
import { Lightbox } from '@/components/ui/Lightbox';
import { HighlightedCode, codeLanguageForFile } from '@/components/ui/CodeHighlight';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import {
  isConversationRunning,
  useConversationRun,
} from '@/components/copilot/conversationRunStore';
import { listConversations, createConversation, renameConversation, archiveConversation, type ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import {
  useConversations,
  useOtherConversations,
} from '@/hooks/useConversations';
import {
  artifactAfterJobSelection,
  canCommitJobOpen,
  useConversationJobs,
} from '@/hooks/useConversationJobs';
import { useResizableColumns } from '@/hooks/useResizableColumns';
import { useWorkspaceLayout } from '@/hooks/useWorkspaceLayout';
import { useRightPanelTabs } from '@/hooks/useRightPanelTabs';
import { usePluginStore } from '@/hooks/usePluginStore';
import { segmentToMode, modeToSegment, type WorkspaceMode } from '@/hooks/useWorkspaceRouting';
import { isDirectRecoveryAction, useHarnessWorkflowStatus } from '@/hooks/useHarnessWorkflowStatus';
import { useSetCopilotContext } from '@/lib/copilotContextProvider';
import type { CopilotContext, HarnessContextSummary } from '@/lib/copilotContext';
import { gewuEvents, subscribeGewuEvent, dispatchGewuEvent } from '@/lib/events';
import { getBrowserViewportSize, isGewuLocalBrowserUrl, normalizeBrowserUrl } from '@/lib/browser-url';
import { useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';
import { useTheme } from '@/themes/ThemeProvider';
import {
  fetchHarnessIndex,
  runHarnessWorkflowAction,
  type HarnessIndexSummary,
  type HarnessWorkflowJobState,
} from '@/lib/harness-client';
import {
  normalizeResultManifest,
  classifyArtifact,
  buildResultArtifactNavigation,
  findArtifactByName,
  pickPreferredArtifact,
  artifactKindLabel,
  type ResultArtifactKind,
  type ResultArtifactRecord,
} from '@/lib/result-manifest';
import {
  artifactFormatLabel,
  buildResultArtifactPickerGroups,
  filterResultArtifactRelatedSections,
  findResultArtifactPickerOption,
  isRelatedArtifactKind,
} from '@/lib/result-artifact-display';
import { buildResultTitleBarTitle } from '@/lib/result-title-bar';
import {
  summarizeSelectionForAgent,
  type ArtifactInteractionManifest,
  type ArtifactSelection,
  type InteractionCapability,
} from '@/lib/artifact-selection';
import { PluginStorePanel } from '@/components/desktop/PluginStorePanel';
import { DesktopSettingsPanel } from '@/components/desktop/DesktopSettingsPanel';
import { ResultStudioChangeSetPanel } from '@/components/result-studio/ResultStudioChangeSetPanel';
import { isSameActiveArtifactProjection } from '@/components/result-studio/activeArtifactProjection';
import { isResultWorkspaceMode, resultFocusTransition } from '@/components/result-studio/resultFocusLayout';
import { RevisionCodeView } from '@/components/result-studio/RevisionCodeView';
import { revisionArtifactUrl, type ArtifactRevision } from '@/components/result-studio/resultStudioClient';
import { shouldShowWorkflowBar } from '@/components/result-studio/resultFirstScreen';
import {
  canCommitResultFetch,
  nextResultBodyState,
  revisionAfterJobSelection,
  type ResultBodyState,
} from '@/components/result-studio/resultBodyState';
import { getResultScrollPosition, setResultScrollPosition } from '@/components/result-studio/resultScrollMemory';
import { ScientificInteractionViewer } from '@/components/result-studio/ScientificInteractionViewer';
import { CompactResultNavigator } from '@/components/result-studio/CompactResultNavigator';
import {
  deleteResultStudioSelection,
  fetchArtifactInteraction,
  fetchResultStudioContext,
  restoreResultStudioSelection,
  saveResultStudioSelection,
  type ResultStudioEditControls,
  type ResultTableQuery,
} from '@/lib/result-studio-interaction-client';
import type { ResultEditSubmission } from '@/components/result-studio/ResultEditPanel';
import {
  buildResultEditCopilotAsk,
  isResultStudioContextToken,
} from '@/lib/result-edit-agent-bridge';
import {
  beginResultSurfaceMeasure,
  chooseResultArtifactName,
  completeResultSurfaceMeasure,
  describeTruthStatus,
  requestedArtifactRequestKey,
  RESULT_SURFACE_PERFORMANCE_MARKS,
  resolveResultArtifactUrl,
  resolveResultViewerAdapter,
  shouldApplyRequestedArtifact,
  shouldRequestArtifactInteraction,
  shouldShowResultInteraction,
  shouldSurfaceInteractionFailure,
  type ResultSurfaceMode,
} from '@/components/result-studio/resultSurface';
import type { BackendStatus } from '@/lib/electron';
import { getBridge } from '@/lib/desktopBridge';
import {
  describeOfficeKind,
  loadOfficePreview,
  revokeOfficePreviewBlobs,
  suggestedOpener,
  type OfficePreviewAsset,
  type OfficePreviewKind,
  type OfficePreviewModel,
} from '@/lib/office-file-preview';
import styles from '@/pages/project-workspace.module.css';
import { fileExtension, isImageFile, isTextFile, isMarkdownFile, workspaceFileUrlFor, formatPreviewText } from '@/lib/previewFileUtils';


// ── BLOCK-9.2 PHASE 2: types + helpers extracted to ./ResultView/{types,helpers} ──
import {
  toArtifactRevision,
  artifactName,
  artifactKindIcon,
  artifactPreviewLabel,
  workflowStageLabel,
} from './ResultView/helpers';
import type {
  ActiveArtifact,
  JobStats,
  JobResultFile,
  DeliveryManifestSummary,
  JobResult,
  JobDetailMeta,
} from './ResultView/types';

// Re-export compatibility: CenterPanel.tsx + project-workspace.tsx + 多 consumer
// continue to import { ActiveArtifact, JobStats } from "@/components/workspace-panels/ResultView".
export type { ActiveArtifact, JobStats } from './ResultView/types';
export function ResultView({
  project,
  conversationId,
  job,
  workflow = null,
  activeArtifact,
  onActiveArtifactChange,
  onAskAgent,
  onWorkflowChanged,
  onAgentCodeRequest,
  replayContext,
  onOpenRevisionWorkspaceFile,
  pendingArtifactName = null,
  onPendingArtifactConsumed,
  onOpenBrowser,
  onBack,
  onAskCurrentResult,
  mode = 'result',
  onModeChange,
}: {
  project: Project;
  conversationId?: string | null;
  job: ToolJob;
  workflow?: HarnessWorkflowJobState | null;
  activeArtifact: ActiveArtifact | null;
  onActiveArtifactChange: (artifact: ActiveArtifact | null) => void;
  onAskAgent: (prompt: string) => void;
  onWorkflowChanged?: () => void;
  onAgentCodeRequest?: (request: 'explain' | 'modify' | 'replay') => void;
  replayContext?: { conversationId?: string | null; contextToken: string } | null;
  onOpenRevisionWorkspaceFile?: (relativePath: string) => void;
  pendingArtifactName?: string | null;
  onPendingArtifactConsumed?: () => void;
  onOpenBrowser?: (url: string) => void;
  onBack?: () => void;
  onAskCurrentResult?: () => void;
  mode?: ResultSurfaceMode;
  onModeChange?: (mode: ResultSurfaceMode, jobId?: string | null) => void;
}): React.ReactElement {
  return (
    <ResultArtifactShell
      project={project}
      conversationId={conversationId}
      job={job}
      workflow={workflow}
      activeArtifact={activeArtifact}
      onActiveArtifactChange={onActiveArtifactChange}
      onAskAgent={onAskAgent}
      onWorkflowChanged={onWorkflowChanged}
      onAgentCodeRequest={onAgentCodeRequest}
      replayContext={replayContext}
      onOpenRevisionWorkspaceFile={onOpenRevisionWorkspaceFile}
      pendingArtifactName={pendingArtifactName}
      onPendingArtifactConsumed={onPendingArtifactConsumed}
      onOpenBrowser={onOpenBrowser}
      onBack={onBack}
      onAskCurrentResult={onAskCurrentResult}
      mode={mode}
      onModeChange={onModeChange}
    />
  );
}


// UI-305 P2 - extracted inline components now live in sibling files:
import { ResultArtifactShell } from './ResultArtifactShell';
export { EmptyAnalysisResult } from './ResultArtifactShell';
