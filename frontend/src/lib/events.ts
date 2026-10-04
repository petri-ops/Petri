/**
 * Gewu Desktop — typed event bus
 *
 * Replaces magic string CustomEvent names with const-typed symbols.
 * Producers and consumers import from here; one typo now = TS compile error.
 *
 * Payload types mirror the actual `CustomEvent.detail` shape at each call-site.
*/

import type { CopilotContext } from '@/lib/copilotContext';
import type { SelectionBusState } from '@/lib/selectionBus';

export const gewuEvents = {
  /** Fired by main.js preload on Cmd+R; listened by project-workspace to refetch state */
  softRefresh: 'gewu:soft-refresh',

  /** Fired by project-workspace right-panel handlers; listened by project-workspace itself */
  projectOpenResult: 'gewu:project-open-result',

  /**
   * Fired by SimpleChat when the user clicks an internal artifact link in
   * the copilot reply. project-workspace subscribes and either focuses the
   * current job + selects the named artifact, or — when the artifact belongs
   * to a different project — navigates there first.
   */
  projectOpenArtifact: 'gewu:project-open-artifact',

  /**
   * Fired by SimpleChat when the user clicks an internal workspace-file link
   * in the copilot reply. project-workspace validates the target project,
   * opens the file in the right Files panel and adds/focuses the tab.
   */
  projectOpenWorkspaceFile: 'gewu:project-open-workspace-file',

  /**
   * Signals that files in one project may have changed. Agent workspace
   * writes emit this immediately; the Files panel also polls while visible
   * so terminal and external-editor writes converge without manual reload.
   */
  projectWorkspaceChanged: 'gewu:project-workspace-changed',

  /**
   * Fired by project-workspace (handleAskAgent); listened by SimpleChat to inject
   * a prompt into the chat input without navigating.
   */
  copilotAsk: 'gewu:copilot-ask',

  /**
   * UI-417 — 侧边聊天悬挂化：请求展开悬挂聊天面（原右栏 chat tab 入口收编——
   * home 空态卡「打开聊天」/分析完成跳转等）。SideChatDock 订阅后滑出 overlay；
   * 中央 ownsCopilotAsk 归属不变，本事件只管展开不投递内容。
   */
  sideChatOpen: 'gewu:side-chat-open',

  /** Fired by the shared TitleBar; listened by BrowserPanel */
  browserBack: 'gewu:browser-back',
  browserForward: 'gewu:browser-forward',

  /**
   * Fired by SimpleChat when a conversation is forked (via "创建分支" button).
   * project-workspace subscribes and refreshes the conversation list + other projects.
   */
  conversationForked: 'gewu:conversation-forked',

  /**
   * BLOCK-16 PHASE 3：agent task 收尾时由 SSE parser 派发。
   * useWorkingTreeReview 订阅：自动弹出浮层，避免用户手动点 Review 按钮。
   * payload 含 taskId（agent task identifier）+ filesChanged（若后端在 done 时附了改动清单）。
   */
  agentTaskDone: 'gewu:agent-task-done',

  /** BLOCK-20: fired by backend SSE once per agent run with live token budget. */
  tokenBudget: 'gewu:token-budget',

  /**
   * BLOCK-28.7: 请求打开审阅并选中指定文件（聊天区改动卡片点击行触发）。
   * ProjectWorkspace 监听后 openRightPanel('review')；
   * useWorkingTreeReview 监听后 setSelectedFilePath。
   */
  reviewOpenFile: 'gewu:review-open-file',

  /**
   * BLOCK-34 P3: agent 成功启动后台进程（workspace_exec_background）时由
   * conversationRunStore 派发；ToolActivityDock 订阅后自动弹出后台进程 tab（BLOCK-36 吸收原 BackgroundProcessDock）
   * 并开始轮询该进程日志。
   */
  agentBackgroundProcess: 'gewu:agent-background-process',

  /**
   * BLOCK-52 P1（选中即引用）：用户在右侧文件预览（CodeMirror 编辑器或
   * Markdown 渲染视图）中选中文字并点击「引用到对话」时由 WorkspaceFilePreview
   * 派发；SimpleChat（中央会话 ownsCopilotAsk 拥有者）订阅后在 composer
   * 生成引用块，随下一条消息发送。
   */
  selectionQuote: 'gewu:selection-quote',

  /**
   * BLOCK-52 P2（图片/结果图引用）：用户在右侧图片预览（WorkspaceFilePreview
   * 静态图片文件）或结果面板（ResultView 的 Result Studio 结果图）中点击
   * 「引用到对话」时派发；SimpleChat 订阅后生成图片引用卡（缩略图 + 来源行），
   * 发送时图片进附件区、artifact 元数据合成进消息文本供模型读取。
   */
  imageQuote: 'gewu:image-quote',

  /**
   * UI-385：打开子智能体实时详情（右栏「智能体」tab 承载，不再弹独立窗）。
   * 由工具行内联卡「详情」按钮 / SimpleChat spawn 自动唤起 / 摘要卡「智能体」
   * 节图标 / AgentRunPanel 续派派发；project-workspace 订阅后切右栏 tab 并把
   * 面板切到 detail.runId。
   */
  agentOpenInRail: 'gewu:agent-open-in-rail',

  /**
   * BLOCK-95 A4 — 后端 topic_shift 检测命中（SSE onTopicShift）时由
   * conversationRunStore 派发；SimpleChat 订阅后即时插入话题小节分隔，
   * 并 refreshConversations 让 DB（last_topic_shift_at）成为持久真值。
   */
  conversationTopicShift: 'gewu:conversation-topic-shift',

  /**
   * BLOCK-95 后继（用户反馈「新建聊天左侧项目列表不实时更新」）——新会话创建后
   * 由创建方派发（useChatStream 前端创建 / conversationRunStore 后端 SSE onConversation），
   * AppRailContext 订阅后立即刷新左栏项目树会话列表。
   */
  conversationCreated: 'gewu:conversation-created',

  /**
   * BLOCK-99 G4 — 知识空间管理台经会话驱动完成变更（建/改/启停/移动/删除/重建）
   * 后派发；KnowledgeSpacePanel 订阅后立即刷新（双通道同一真相：UI 手动操作与
   * 会话驱动操作共同的数据面）。
   */
  knowledgeConsoleSync: 'gewu:knowledge-console-sync',

  /**
   * BLOCK-139 P0-1（选择总线，D1）：selectionBus 每次状态写入后由总线派发最新
   * 快照（detail=SelectionBusState，与 getSelectionBusState() 一致）；跨 viewer
   * 与非 React 消费面经此读取「当前活跃 artifact 的当前选择」。React 消费面走
   * useSelectionBus()（内部订阅，不依赖本事件时序）。
   */
  selectionBus: 'gewu:selection-bus',
} as const;

export interface ConversationForkedDetail {
  /** ID of the newly forked conversation */
  newConversationId: string;
  /** Project ID of the forked conversation */
  projectId: string;
}

/** BLOCK-95 A4 — 话题转移事件载荷。 */
export interface ConversationTopicShiftDetail {
  conversationId: string;
  reason: string;
  /** 检测命中时间（ISO，本地接收时刻）。 */
  at: string;
}

/** 会话创建事件载荷。 */
export interface ConversationCreatedDetail {
  conversationId: string;
  title?: string;
  projectId?: string | null;
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
  /** BLOCK-69 — 知识空间自动召回注入块估算 token（无注入为 0） */
  knowledgeTokens: number;
  pct: number;
  trimmed: boolean;
}

// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------

export type GewuEventName = (typeof gewuEvents)[keyof typeof gewuEvents];

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
   *
   * BLOCK-139 评审修订：不设 selection 负载（D2 防第二注入通道；copilot-ask
   * 监听面只消费 prompt/analysisMode/resultContext）。选择实体坐标到达 Agent
   * 的既有通道 = 结果选择持久化（saveResultStudioSelection → selectionId →
   * selection/current / tool_result_selection_run）+ composer 组装链的
   * activeArtifact.selection 摘要（≤12 有界）。
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

/** UI-385: 右栏「智能体」tab 打开载荷（runId = 子 agent 任务 id）。 */
export interface AgentOpenInRailDetail {
  runId: string;
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

export type GewuEventMap = {
  [gewuEvents.softRefresh]: undefined;
  [gewuEvents.projectOpenResult]: ProjectOpenResultDetail;
  [gewuEvents.projectOpenArtifact]: ProjectOpenArtifactDetail;
  [gewuEvents.projectOpenWorkspaceFile]: ProjectOpenWorkspaceFileDetail;
  [gewuEvents.projectWorkspaceChanged]: ProjectWorkspaceChangedDetail;
  [gewuEvents.copilotAsk]: CopilotAskDetail;
  [gewuEvents.sideChatOpen]: undefined;
  [gewuEvents.browserBack]: undefined;
  [gewuEvents.browserForward]: undefined;
  [gewuEvents.conversationForked]: ConversationForkedDetail;
  [gewuEvents.agentTaskDone]: AgentTaskDoneDetail;
  [gewuEvents.tokenBudget]: TokenBudgetDetail;
  [gewuEvents.reviewOpenFile]: ReviewOpenFileDetail;
  [gewuEvents.agentBackgroundProcess]: AgentBackgroundProcessDetail;
  [gewuEvents.agentOpenInRail]: AgentOpenInRailDetail;
  [gewuEvents.selectionQuote]: SelectionQuoteDetail;
  [gewuEvents.imageQuote]: ImageQuoteDetail;
  [gewuEvents.conversationTopicShift]: ConversationTopicShiftDetail;
  [gewuEvents.conversationCreated]: ConversationCreatedDetail;
  [gewuEvents.knowledgeConsoleSync]: undefined;
  [gewuEvents.selectionBus]: SelectionBusState;
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
export function dispatchGewuEvent<K extends GewuEventName>(
  name: K,
  detail?: GewuEventMap[K]
): void {
  window.dispatchEvent(new CustomEvent(name, { detail: detail as unknown as CustomEventInit }));
}

/**
 * Subscribe to a typed event. Returns an unsubscribe function.
 * Set `{ once: true }` for one-shot listeners.
 */
export function subscribeGewuEvent<K extends GewuEventName>(
  name: K,
  handler: (detail: GewuEventMap[K]) => void,
  options?: { once?: boolean }
): () => void {
  const wrapped = (e: Event) => {
    handler((e as CustomEvent).detail as GewuEventMap[K]);
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
