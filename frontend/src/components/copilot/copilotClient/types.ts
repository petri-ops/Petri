import type { CopilotContext } from '@/lib/copilotContext';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** MULTIMODAL_v1 — optional image URLs (OSS) for this message. Threaded to
   *  the backend; only used by the model when a multimodal model is configured. */
  images?: string[];
}

export interface ToolCallEvent {
  name: string;
  args: Record<string, unknown>;
  traceId?: string;
  callId?: string;
  iteration?: number;
}

/** BLOCK-33 P3 — workspace_exec 流式输出增量（callId 关联 tool_call/tool_result）。 */
export interface ToolOutputEvent {
  name: string;
  traceId?: string;
  callId?: string;
  iteration?: number;
  text: string;
  truncated?: boolean;
}

export interface ToolSideEffects {
  type: 'none' | 'state-write' | 'workspace-write' | 'execution' | 'external-request';
  riskTier: 'R0' | 'R1' | 'R2' | 'R3';
  resources: string[];
}

export interface StructuredToolResult {
  contractVersion: string;
  traceId: string;
  callId: string;
  tool: string;
  status: 'success' | 'error' | 'denied';
  terminationReason: string;
  durationMs: number;
  /** The source result exceeded a configured safety bound. */
  sourceTruncated?: boolean;
  /** The UI-facing preview was shortened for compact activity rendering. */
  previewTruncated?: boolean;
  /** Legacy combined flag; retained for older event producers. */
  truncated: boolean;
  sideEffects: ToolSideEffects;
  data?: unknown;
  /** UI-273 — 写操作（workspace_write / workspace_replace）的逐行改动（toolResult 顶层，独立于 data 截断）。 */
  changeDiff?: unknown;
  /** UI-315 — exec 实际使用的 shell 短标签（toolResult 顶层，独立于 data 截断）。 */
  shellLabel?: string;
}

export interface ToolResultEvent {
  name: string;
  summary: string;
  iteration?: number;
  toolResult?: StructuredToolResult;
  actType?: string;
  message?: string;
  undoToken?: string;
  undoableUntil?: number;
  actError?: string;
  analysisId?: string;
  taskId?: string;
  /** scRNA UI controls */
  scTab?: 'preview' | 'plots' | 'data' | 'params';
  scCluster?: string;
  scGene?: string;
  scColumnFilters?: Record<string, string>;
  scSubsetName?: string | null;
  scLabelKey?: string;
  scLabelValue?: string;
  scDatasetIds?: string[];
  scMergeName?: string | null;
  scOpenReplotForAnalysis?: string;
  scUploadHint?: boolean;
  /** open_tool */
  toolId?: string;
  /** open_tool autofill — when LLM passes autofillFromJobId, frontend uses
   * the prior job's output as the new tool's input. Saves user 2-3 manual
   * steps when chaining (e.g. DESeq2 → GO-KEGG). */
  autofillFromJobId?: string;
  autofillSourceTool?: string;
  /** Plan tool — propagated for inline plan card UI */
  planId?: string;
  allDone?: boolean;
  /** ACK token to confirm UI handler fired */
  ackToken?: string;
  /** TOOL_JOB_APPROVAL_v1（阶段2 Task3）：run_tool 重操作需用户确认 */
  needApproval?: boolean;
  toolJobId?: string;
  /** 6.4 — 参数确认卡片：agent 返回的参数供用户审阅/微调 */
  params?: Record<string, unknown>;
}

export interface ResultEditProgressEvent {
  resultEditProgressVersion: 1;
  sequence: number;
  changeSetId: string;
  stage: string;
  status: string;
  /** P4R-3 public projection; never exposes materialize/Git internals in result focus UI. */
  publicPhase?: string;
  publicPhaseLabel?: string;
  reason?: string;
  toolJobId?: string;
  revisionId?: string;
}

/** BLOCK-97 — 任务清单条目（todo_write 整单快照，task_todo 事件承载） */
export interface AgentTaskTodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** BLOCK-94 / UI-402 — 知识溯源：本轮自动召回注入了哪些知识块（事件快照）。 */
export interface KnowledgeCitation {
  docId?: string;
  docName?: string;
  seq?: number;
  channels?: { vector?: number; fts?: number };
}

export interface StreamChatOptions {
  messages: ChatMessage[];
  context?: CopilotContext;
  signal?: AbortSignal;
  /** Active conversation id; server will create one if absent */
  conversationId?: string;
  /** Desktop workspace selected chat model preset id */
  modelPresetId?: string;
  /** Model id discovered from the selected provider Endpoint. */
  modelName?: string;
  /** AGENT-CONCURRENCY: spawn this run as a sub-agent child of an existing primary task. */
  kind?: 'primary' | 'subagent';
  /** Parent primary taskId when kind === 'subagent' (server validates ownership). */
  parentTaskId?: string;
  /**
   * BLOCK-81 P1 — 思考档位（中性三档）。缺省/undefined＝不发任何思考参数
   * （服务端按 profile 能力位门控后映射上游参数）。P2 起由 composer 档位控件提供。
   */
  thinkingLevel?: 'off' | 'standard' | 'high';
  onDelta: (delta: string) => void;
  /** UI-272 — 模型思考段增量（reasoning_content），按迭代聚合由调用方处理 */
  onReasoning?: (delta: string) => void;
  onDone?: () => void;
  /** BLOCK-38 P2: info.resumable = 服务中断清扫标记的任务（可续跑），interruptedAt 为中断时间。
   *  BLOCK-56 P1: info.fallbackTaskId = 后端已自动切备用模型新建的续跑任务，前端应切换订阅。 */
  onError?: (
    err: Error,
    info?: {
      resumable?: boolean;
      interruptedAt?: string | null;
      fallbackTaskId?: string | null;
      fallbackLabel?: string | null;
    }
  ) => void;
  /** BLOCK-49 加映 — proactive：子 agent 终态通知（child_finished 事件）。 */
  onChildFinished?: (info: {
    childTaskId: string;
    status: string;
    summaryHead: string;
  }) => void;
  /** BLOCK-56 P1 — 模型降级事件（请求级/任务级），info.message 为用户可读文案。 */
  onModelFallback?: (info: {
    scope?: 'request_level' | 'task_level' | string;
    fromProfileId?: string | null;
    toProfileId?: string | null;
    toProfileLabel?: string | null;
    reason?: string | null;
    newTaskId?: string | null;
    message?: string | null;
  }) => void;
  /** BLOCK-39: 订阅断线进入第 attempt 次重连（afterSeq=lastSeq 续传），nextRetryMs 后重试。 */
  onStreamReconnecting?: (info: { taskId: string; attempt: number; lastSeq: number; nextRetryMs: number }) => void;
  /** Agent iteration started (1-indexed) */
  onIter?: (n: number) => void;
  /** Agent runtime status that should be visible while no answer text is available. */
  onAgentStatus?: (status: {
    phase: string;
    message: string;
    attempt?: number;
    maxAttempts?: number;
    reason?: string;
  }) => void;
  /** Model-authored, user-facing progress emitted before a tool batch. */
  onAgentProgress?: (progress: { iteration: number; content: string }) => void;
  /** RS5: durable ChangeSet materialization / Job / Revision stage progress. */
  onResultEditProgress?: (progress: ResultEditProgressEvent) => void;
  /** Tool call started */
  onToolCall?: (e: ToolCallEvent) => void;
  /** BLOCK-33 P3 — workspace_exec 增量输出（节流聚合后的文本块） */
  onToolOutput?: (e: ToolOutputEvent) => void;
  /** Tool call returned */
  onToolResult?: (e: ToolResultEvent) => void;
  /** BLOCK-97 — todo_write 成功回执后的整单清单快照（task_todo 事件） */
  onTaskTodo?: (items: AgentTaskTodoItem[]) => void;
  /** BLOCK-94 / UI-402 — 知识溯源条（自动召回注入的块清单，诚实可见） */
  onKnowledgeCitations?: (info: { citations: KnowledgeCitation[] }) => void;
  /** BLOCK-98 M4 — 用户消息插队入队通知（运行中 steer） */
  onInputQueued?: (info: { text: string; depth: number }) => void;
  /** Server announces (or creates) the active conversation */
  onConversation?: (info: { conversationId: string; title?: string }) => void;
  /** Server detected the user has pivoted to a new topic mid-conversation */
  onTopicShift?: (info: { conversationId: string; reason: string }) => void;
  /** HLE-C4: Loop Controller phase change (started / cancelled / blocked / completed) */
  onLoopPhase?: (info: { phase: string; loopRunId?: string; publicConclusion?: string; reason?: string; automationMode?: string; executionIntent?: 'task_draft' | 'task_execute' }) => void;
  /** HLE-C4: Loop Controller iteration recorded after each agent turn */
  onLoopIteration?: (info: { loopRunId: string; iterationId: string; sequence: number; decision: string; decisionReasonCode: string; publicConclusion: string; status: string; proposedActionKey: string | null; actionKeyHash: string | null }) => void;
  /** Background task created for this run. Used by the UI to request a real cancellation. */
  onTaskStarted?: (taskId: string) => void;
}
