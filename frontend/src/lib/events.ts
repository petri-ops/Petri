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

  /**
   * BLOCK-28.7: 请求打开审阅并选中指定文件（聊天区改动卡片点击行触发）。
   * ProjectWorkspace 监听后 openRightPanel('review')；
   * useWorkingTreeReview 监听后 setSelectedFilePath。
   */
  reviewOpenFile: 'biof3:review-open-file',

  /**
   * BLOCK-34 P3: agent 成功启动后台进程（workspace_exec_background）时由
   * conversationRunStore 派发；ToolActivityDock 订阅后自动弹出后台进程 tab（BLOCK-36 吸收原 BackgroundProcessDock）
   * 并开始轮询该进程日志。
   */
  agentBackgroundProcess: 'biof3:agent-background-process',

  /**
   * BLOCK-52 P1（选中即引用）：用户在右侧文件预览（CodeMirror 编辑器或
   * Markdown 渲染视图）中选中文字并点击「引用到对话」时由 WorkspaceFilePreview
   * 派发；SimpleChat（中央会话 ownsCopilotAsk 拥有者）订阅后在 composer
   * 生成引用块，随下一条消息发送。
   */
  selectionQuote: 'biof3:selection-quote',

  /**
   * BLOCK-52 P2（图片/结果图引用）：用户在右侧图片预览（WorkspaceFilePreview
   * 静态图片文件）或结果面板（ResultView 的 Result Studio 结果图）中点击
   * 「引用到对话」时派发；SimpleChat 订阅后生成图片引用卡（缩略图 + 来源行），
   * 发送时图片进附件区、artifact 元数据合成进消息文本供模型读取。
   */
  imageQuote: 'biof3:image-quote',
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
  filesChanged?: Array<{
    path: string;
    status: string;
    /** UI-273 — 执行步骤归属：改动发生时的 agent 迭代号（后端聚合提供，旧清单缺省） */
    iteration?: number;
    /** UI-273 — 产生改动的工具名（workspace_write / workspace_replace） */
    tool?: string;
  }>;
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
  [biof3Events.reviewOpenFile]: ReviewOpenFileDetail;
  [biof3Events.agentBackgroundProcess]: AgentBackgroundProcessDetail;
  [biof3Events.selectionQuote]: SelectionQuoteDetail;
  [biof3Events.imageQuote]: ImageQuoteDetail;
};

/** BLOCK-34 P3: 后台进程启动事件载荷。 */
export interface AgentBackgroundProcessDetail {
  processId: string;
  conversationId?: string;
}

/**
 * BLOCK-52 P1（选中即引用）：`selectionQuote` 事件载荷。
 * 由 WorkspaceFilePreview 在用户点击「引用到对话」时派发。
 */
export interface SelectionQuoteDetail {
  /** 所属项目 ID（SimpleChat 据此过滤跨项目引用）；可为空（无项目上下文）。 */
  projectId?: string;
  /** 被引用文件的 workspace 相对路径。 */
  path: string;
  /** 文件名（chip 显示用），缺省时由 path 尾段推导。 */
  name?: string;
  /** 起始行（1-based；CodeMirror 编辑器内选中时提供，Markdown 渲染视图无行号）。 */
  startLine?: number;
  /** 结束行（1-based，含端点）。 */
  endLine?: number;
  /** 选中文字原文（已在生产侧截断到上限）。 */
  text: string;
}

/** BLOCK-28.7: 打开审阅并选中指定文件的载荷。 */
export interface ReviewOpenFileDetail {
  filePath: string;
}

/** BLOCK-52 P2: Result Studio 结果图的 artifact 血统元数据（`imageQuote` 事件携带）。 */
export interface ImageQuoteArtifact {
  /** 结果工具任务 ID（agent 的 read_image 工具按此读图解读）。 */
  toolJobId: string;
  /** Result Studio revision ID。 */
  revisionId?: string;
  /** Result Studio artifact ID。 */
  artifactId?: string;
  /** Revision 序号（1-based，用户可见版本号，供模型与 result_studio_context 交叉核对）。 */
  revisionOrdinal?: number;
}

/**
 * BLOCK-52 P2（图片/结果图引用）：`imageQuote` 事件载荷。
 * 由 WorkspaceFilePreview（静态图片文件）或 ResultView（Result Studio 结果图）
 * 在用户点击「引用到对话」时派发。
 */
export interface ImageQuoteDetail {
  /** 所属项目 ID（SimpleChat 据此过滤跨项目引用）；可为空（无项目上下文）。 */
  projectId?: string;
  /** 引用来源：workspace 静态图片文件（无血统）/ Result Studio 结果图（带 artifact 血统）。 */
  kind: 'workspace-file' | 'result-artifact';
  /** 图片名（引用卡显示用）。 */
  name: string;
  /** workspace 相对路径（kind=workspace-file 时提供，供模型按路径读图）。 */
  path?: string;
  /** 图片 src（SimpleChat 据此 fetch 转 dataUrl 进附件区）。 */
  url: string;
  /** artifact 血统（kind=result-artifact 时提供）。 */
  artifact?: ImageQuoteArtifact;
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
