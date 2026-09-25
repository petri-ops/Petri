// ============================================================
// ResultView — center column result display
// UI-146: T85 路由化拆上帝组件·增量4
//   抽取 ResultArtifactShell + ResultView（及其本地类型/helper）到独立文件，
//   切断 CenterPanel -> project-workspace 关于结果视图的循环依赖。
//   本文件仅依赖外部模块与随本文件迁移的本地类型/helper，不 import project-workspace。
// ============================================================
import React from 'react';
import type { Project, ToolJob } from '@/lib/project-types';
import { type HarnessWorkflowJobState } from '@/lib/harness-client';
import { type ResultSurfaceMode } from '@/components/result-studio/resultSurface';


// ── BLOCK-9.2 PHASE 2: types + helpers extracted to ./ResultView/{types,helpers} ──
import type { ActiveArtifact } from './ResultView/types';

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
