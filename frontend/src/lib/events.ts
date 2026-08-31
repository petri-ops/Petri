/**
 * BioF3 Desktop — typed event bus
 *
 * Replaces magic string CustomEvent names with const-typed symbols.
 * Producers and consumers import from here; one typo now = TS compile error.
 *
 * Payload types mirror the actual `CustomEvent.detail` shape at each call-site.
*/

import type { CopilotContext } from '@/lib/copilotContext';

export const biof3Events = {
  /** Fired by DesktopOnboarding on completion; listened by App's DesktopOnboardingMount */
  onboardingDone: 'biof3:onboarding-done',

  /** Fired by main.js preload on Cmd+R; listened by project-workspace to refetch state */
  softRefresh: 'biof3:soft-refresh',

  /** Fired by project-workspace right-panel handlers; listened by project-workspace itself */
  projectOpenResult: 'biof3:project-open-result',

  /**
   * Fired by SimpleChat when the user clicks an internal artifact link in
   * the copilot reply. project-workspace subscribes and either focuses the
   * current job + selects the named artifact, or — when the artifact belongs
   * to a different project — navigates there first.
   */
  projectOpenArtifact: 'biof3:project-open-artifact',

  /**
   * Fired by SimpleChat when the user clicks an internal workspace-file link
   * in the copilot reply. project-workspace validates the target project,
   * opens the file in the right Files panel and adds/focuses the tab.
   */
  projectOpenWorkspaceFile: 'biof3:project-open-workspace-file',

  /**
   * Signals that files in one project may have changed. Agent workspace
   * writes emit this immediately; the Files panel also polls while visible
   * so terminal and external-editor writes converge without manual reload.
   */
  projectWorkspaceChanged: 'biof3:project-workspace-changed',

  /**
   * Fired by project-workspace (handleAskAgent); listened by SimpleChat to inject
   * a prompt into the chat input without navigating.
   */
  copilotAsk: 'biof3:copilot-ask',

  /** Fired by the shared TitleBar; listened by BrowserPanel */
  browserBack: 'biof3:browser-back',
  browserForward: 'biof3:browser-forward',

  /**
   * Fired by SimpleChat when a conversation is forked (via "创建分支" button).
   * project-workspace subscribes and refreshes the conversation list + other projects.
   */
  conversationForked: 'biof3:conversation-forked',

  /**
   * BLOCK-16 PHASE 3：agent task 收尾时由 SSE parser 派发。
   * useWorkingTreeReview 订阅：自动弹出浮层，避免用户手动点 Review 按钮。
   * payload 含 taskId（agent task identifier）+ filesChanged（若后端在 done 时附了改动清单）。
   */
  agentTaskDone: 'biof3:agent-task-done',

  /** BLOCK-20: fired by backend SSE once per agent run with live token budget. */
  tokenBudget: 'biof3:token-budget',

  /** BLOCK-22 P4.10: fired by useCodeMirrorEditor after acceptHunk IPC succeeds. */
  hunkAccepted: 'biof3:hunk-accepted',

  /** BLOCK-22 P4.10: fired by useCodeMirrorEditor after rejectHunk IPC succeeds. */
  hunkRejected: 'biof3:hunk-rejected',

  /**
   * BLOCK-28.7: 请求打开审阅并选中指定文件（聊天区改动卡片点击行触发）。
   * ProjectWorkspace 监听后 openRightPanel('review')；
   * useWorkingTreeReview 监听后 setSelectedFilePath。
   */
  reviewOpenFile: 'biof3:review-open-file',
} as const;

export interface ConversationForkedDetail {
  /** ID of the newly forked conversation */
  newConversationId: string;
  /** Project ID of the forked conversation */
  projectId: string;
}

/**
 * BLOCK-16 PHASE 3：agent task 完成事件 payload。
 * taskId 必填；filesChanged 自 BLOCK-31 P1 起由后端 SSE done 事件携带权威清单
 * （task_events 回放聚合 workspace_write/replace，workspace_exec 归属盲区不计入）；
 * conversationId 为该任务所属会话（renderer 据此建立会话级改动索引）。
 */
export interface AgentTaskDoneDetail {
  taskId: string;
  filesChanged?: Array<{ path: string; status: string }>;
  conversationId?: string;
}

/** BLOCK-20: fired by backend SSE once per agent run with live token budget. */
export interface TokenBudgetDetail {
  contextWindow: number;
  messagesTokensUsed: number;
  systemPromptTokens: number;
  messagesTokens: number;
  pct: number;
  trimmed: boolean;
}

/** BLOCK-22 P4.10: fired by useCodeMirrorEditor after acceptHunk IPC succeeds. */
export interface HunkAcceptedDetail {
  hunkId: string;
  filePath: string;
  timestamp: number;
}

/** BLOCK-22 P4.10: fired by useCodeMirrorEditor after rejectHunk IPC succeeds. */
export interface HunkRejectedDetail {
  hunkId: string;
  filePath: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------

export type BioF3EventName = (typeof biof3Events)[keyof typeof biof3Events];

export interface CopilotAskDetail {
  prompt: string;
  /**
   * When true, the prompt is dispatched from the AnalysisLaunchPanel and should
   * run as a background sub-agent task rather than the primary stream.
   */
  analysisMode?: boolean;
  /**
   * P4R-3: 结果 Composer 的原子上下文快照。token 不写入 prompt;
   * SimpleChat 将该快照覆盖到本轮请求 context,避免异步建会话期间漂移。
   */
  resultContext?: {
    contextToken: string;
    activeArtifact: NonNullable<CopilotContext['activeArtifact']>;
    editRequest: NonNullable<CopilotContext['resultEditRequest']>;
  };
}

export interface ProjectOpenResultDetail {
  toolJobId: string;
  projectId?: string | null;
}

/**
 * Payload for `projectOpenArtifact`. `projectId` is optional — when present
 * it indicates the artifact belongs to a different project than the current
 * one and the host should navigate there before focusing the artifact.
 */
export interface ProjectOpenArtifactDetail {
  jobId: string;
  artifactName: string;
  projectId?: string | null;
}

/**
 * Payload for `projectOpenWorkspaceFile`. `projectId` is required and must
 * be validated by the host before opening — the resolver never trusts
 * user-supplied cross-project paths.
 *
 * BLOCK-22 P4.5: 扩展支持行号、列号和 inline-diff revision 触发。
 */
export interface ProjectOpenWorkspaceFileDetail {
  projectId: string;
  relativePath: string;
  name?: string;
  openWithSystemApp?: boolean;
  /** BLOCK-22 P4.5: 行号，0=文件开头（1-based，与 EditorApi.scrollToLine 一致） */
  line?: number;
  /** BLOCK-22 P4.5: 列号（0-based 列偏移） */
  column?: number;
  /**
   * BLOCK-22 P4.5: 若设置，project-workspace 将通过 pendingRequest 触发
   * WorkspaceFilePreviewBridge 进入 inline-diff 模式并应用此 revision。
   */
  diffRevision?: DiffRevisionPayload;
}

/** BLOCK-22 P4.5: diffRevision 载荷，透传给 WorkspaceFilePreviewBridge */
export interface DiffRevisionPayload {
  filePath: string;
  originalText: string;
  modifiedText: string;
}

export interface ProjectWorkspaceChangedDetail {
  projectId: string;
  source: 'agent' | 'terminal' | 'external' | 'manual';
}

export type BioF3EventMap = {
  [biof3Events.onboardingDone]: undefined;
  [biof3Events.softRefresh]: undefined;
  [biof3Events.projectOpenResult]: ProjectOpenResultDetail;
  [biof3Events.projectOpenArtifact]: ProjectOpenArtifactDetail;
  [biof3Events.projectOpenWorkspaceFile]: ProjectOpenWorkspaceFileDetail;
  [biof3Events.projectWorkspaceChanged]: ProjectWorkspaceChangedDetail;
  [biof3Events.copilotAsk]: CopilotAskDetail;
  [biof3Events.browserBack]: undefined;
  [biof3Events.browserForward]: undefined;
  [biof3Events.conversationForked]: ConversationForkedDetail;
  [biof3Events.agentTaskDone]: AgentTaskDoneDetail;
  [biof3Events.tokenBudget]: TokenBudgetDetail;
  [biof3Events.hunkAccepted]: HunkAcceptedDetail;
  [biof3Events.hunkRejected]: HunkRejectedDetail;
  [biof3Events.reviewOpenFile]: ReviewOpenFileDetail;
};

/** BLOCK-28.7: 打开审阅并选中指定文件的载荷。 */
export interface ReviewOpenFileDetail {
  filePath: string;
}

/** Dispatch a typed event on window */
export function dispatchBioF3Event<K extends BioF3EventName>(
  name: K,
  detail?: BioF3EventMap[K]
): void {
  window.dispatchEvent(new CustomEvent(name, { detail: detail as unknown as CustomEventInit }));
}

/**
 * Subscribe to a typed event. Returns an unsubscribe function.
 * Set `{ once: true }` for one-shot listeners.
 */
export function subscribeBioF3Event<K extends BioF3EventName>(
  name: K,
  handler: (detail: BioF3EventMap[K]) => void,
  options?: { once?: boolean }
): () => void {
  const wrapped = (e: Event) => {
    handler((e as CustomEvent).detail as BioF3EventMap[K]);
  };
  window.addEventListener(name, wrapped);
  if (options?.once) {
    // replace with a self-unsubscribing wrapper
    window.addEventListener(name, () => {
      window.removeEventListener(name, wrapped);
    });
  }
  return () => window.removeEventListener(name, wrapped);
}
