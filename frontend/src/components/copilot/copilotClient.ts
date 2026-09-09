// ============================================================
// Copilot streaming chat client — talks to /api/ai/chat (SSE)
// ============================================================

import type { CopilotContext } from '@/lib/copilotContext';

import { getPlatformApiPrefix } from '@/lib/authClient';
import { gewuEvents, dispatchGewuEvent } from '@/lib/events';
import type { AgentTaskDoneDetail, TokenBudgetDetail } from '@/lib/events';

export function getApiPrefix(): string {
  return getPlatformApiPrefix();
}

/**
 * BLOCK-16 PHASE 3：在 primary agent task 收尾时派发 biof3:agent-task-done，
 * 触发 useWorkingTreeReview 自动弹出浮层。仅 kind === 'primary' 触发；
 * subagent 收尾不广播（避免淹没）。
 * BLOCK-31 P2：payload 尽量携带 SSE done 事件中的权威 filesChanged（后端
 * task_events 回放聚合产物）与任务所属 conversationId（供会话级改动索引）；
 * legacy 路径或后端未携带时缺省，消费方仍走 git status/diff 自刷兜底。
 */
function emitAgentTaskDone(
  taskId: string,
  optsKind?: string,
  payload?: { filesChanged?: Array<{ path: string; status: string }>; conversationId?: string }
): void {
  if (!taskId) return;
  if (optsKind === 'subagent') return;
  try {
    const detail: AgentTaskDoneDetail = {
      taskId,
      filesChanged: payload?.filesChanged ?? [],
      conversationId: payload?.conversationId,
    };
    dispatchGewuEvent(gewuEvents.agentTaskDone, detail);
  } catch {
    // 事件总线失败不应阻塞 SSE 收口路径
  }
}

export function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    // BLOCK-61 读旧兼容：历史 key biof3_token
    const token = localStorage.getItem('gewu_token') ?? localStorage.getItem('biof3_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

// ============================================================
// M2-5 Copilot 离线降级提示（E3）
// 在发起 AI 请求前先做网络探测：navigator.onLine + 一次轻量 fetch。
// 离线时抛 OfflineError，调用方据此显示"离线模式"占位而非裸 fetch 堆栈。
// ============================================================

/** 离线错误 —— UI 层据此渲染友好占位，区别于普通请求失败。 */
export class OfflineError extends Error {
  readonly isOffline = true;
  constructor(message = '离线模式，AI 暂不可用') {
    super(message);
    this.name = 'OfflineError';
  }
}

/** 判断一个错误是否为离线错误（用于 UI 层区分降级占位 vs 普通报错）。 */
export function isOfflineError(err: unknown): boolean {
  return err instanceof OfflineError || (err as { isOffline?: boolean })?.isOffline === true;
}

/**
 * 探测网络是否可用：navigator.onLine + 一次 HEAD/GET 探测 fetch。
 * - navigator.onLine 为 false → 直接判定离线（不发包）。
 * - 否则对 API 根路径发一次 cache-busting 探测；fetch 抛错或返回
 *   status=0 视为离线。成功（含 4xx/5xx，只要有响应）即视为在线。
 * - 探测请求带 AbortSignal，避免长时间挂起。
 */
export async function checkOnline(timeoutMs = 4000): Promise<boolean> {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    if (!navigator.onLine) return false;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // 用 API 前缀根路径探测（同源、相对路径，避免 CORS），加 no-cache 防假在线。
    const url = getApiPrefix() + '/health?_t=' + Date.now();
    const resp = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { ...getAuthHeader() },
    });
    clearTimeout(timer);
    // status === 0 通常表示请求未真正发出（被拦截/网络层失败）
    return resp.status !== 0;
  } catch {
    // 探测失败可能是 abort（慢）或网络错误 —— 统一视为离线
    return false;
  }
}

/** 离线时抛出友好错误；在线则静默返回，调用方继续真实请求。 */
async function ensureOnlineOrThrow(): Promise<void> {
  const ok = await checkOnline();
  if (!ok) throw new OfflineError();
}

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

export function parseResultEditProgressEvent(obj: Record<string, unknown>): ResultEditProgressEvent {
  return {
    resultEditProgressVersion: 1,
    sequence: typeof obj.sequence === 'number' ? obj.sequence : 0,
    changeSetId: String(obj.changeSetId || ''),
    stage: String(obj.stage || ''),
    status: String(obj.status || ''),
    publicPhase: obj.publicPhase ? String(obj.publicPhase) : undefined,
    publicPhaseLabel: obj.publicPhaseLabel ? String(obj.publicPhaseLabel) : undefined,
    reason: obj.reason ? String(obj.reason) : undefined,
    toolJobId: obj.toolJobId ? String(obj.toolJobId) : undefined,
    revisionId: obj.revisionId ? String(obj.revisionId) : undefined,
  };
}

export function restoreResultEditProgressEvents(value: unknown): ResultEditProgressEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-30)
    .flatMap((item) => item && typeof item === 'object'
      ? [parseResultEditProgressEvent(item as Record<string, unknown>)]
      : [])
    // intent/plan and an early terminal failure legitimately precede any
    // ChangeSet, so an empty changeSetId is not evidence of a malformed event.
    .filter((item) => item.stage && item.status)
    .sort((a, b) => a.sequence - b.sequence);
}

export function parseToolCallEvent(obj: Record<string, unknown>): ToolCallEvent {
  return {
    name: String(obj.name || ''),
    args: obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args)
      ? obj.args as Record<string, unknown>
      : {},
    traceId: typeof obj.traceId === 'string' ? obj.traceId : undefined,
    callId: typeof obj.callId === 'string' ? obj.callId : undefined,
    iteration: typeof obj.iteration === 'number' ? obj.iteration : undefined,
  };
}

export function parseToolOutputEvent(obj: Record<string, unknown>): ToolOutputEvent {
  return {
    name: String(obj.name || ''),
    traceId: typeof obj.traceId === 'string' ? obj.traceId : undefined,
    callId: typeof obj.callId === 'string' ? obj.callId : undefined,
    iteration: typeof obj.iteration === 'number' ? obj.iteration : undefined,
    text: typeof obj.text === 'string' ? obj.text : '',
    truncated: obj.truncated === true,
  };
}

export function parseToolResultEvent(obj: Record<string, unknown>): ToolResultEvent {
  return {
    name: String(obj.name || ''),
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    iteration: typeof obj.iteration === 'number' ? obj.iteration : undefined,
    toolResult: obj.toolResult && typeof obj.toolResult === 'object'
      ? {
        ...(obj.toolResult as StructuredToolResult),
        sourceTruncated: typeof (obj.toolResult as Record<string, unknown>).sourceTruncated === 'boolean'
          ? (obj.toolResult as Record<string, unknown>).sourceTruncated as boolean
          : undefined,
        previewTruncated: typeof (obj.toolResult as Record<string, unknown>).previewTruncated === 'boolean'
          ? (obj.toolResult as Record<string, unknown>).previewTruncated as boolean
          : undefined,
      }
      : undefined,
    actType: obj.actType as string | undefined,
    message: obj.message as string | undefined,
    undoToken: obj.undoToken as string | undefined,
    undoableUntil: obj.undoableUntil as number | undefined,
    actError: obj.actError as string | undefined,
    analysisId: obj.analysisId as string | undefined,
    taskId: obj.taskId as string | undefined,
    scTab: obj.scTab as ToolResultEvent['scTab'],
    scCluster: obj.scCluster as string | undefined,
    scGene: obj.scGene as string | undefined,
    scColumnFilters: obj.scColumnFilters as Record<string, string> | undefined,
    scSubsetName: obj.scSubsetName as string | null | undefined,
    scLabelKey: obj.scLabelKey as string | undefined,
    scLabelValue: obj.scLabelValue as string | undefined,
    scDatasetIds: obj.scDatasetIds as string[] | undefined,
    scMergeName: obj.scMergeName as string | null | undefined,
    scOpenReplotForAnalysis: obj.scOpenReplotForAnalysis as string | undefined,
    scUploadHint: obj.scUploadHint as boolean | undefined,
    toolId: obj.toolId as string | undefined,
    autofillFromJobId: obj.autofillFromJobId as string | undefined,
    autofillSourceTool: obj.autofillSourceTool as string | undefined,
    planId: obj.planId as string | undefined,
    allDone: obj.allDone as boolean | undefined,
    ackToken: obj.ackToken as string | undefined,
    needApproval: obj.needApproval as boolean | undefined,
    toolJobId: obj.toolJobId as string | undefined,
    params: obj.params as Record<string, unknown> | undefined,
  };
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

// ===========================================================================
// BLOCK-38 P2 — Agent 任务中断续跑 API
// ===========================================================================

/** 中断前最后一次模型调用摘要（GET resume 预览 / POST resume 响应共用形状） */
export interface ResumeLastModelCall {
  ts: string | null;
  kind: string | null;
  model: string | null;
  provider: string | null;
  finishReason: string | null;
  toolCallNames?: string[];
  error: string | null;
  truncated?: boolean;
}

/** GET /ai/agent/task/:taskId/resume — 只读预览（确认弹层数据源） */
export async function previewAgentTaskResume(taskId: string): Promise<{
  resumable: boolean;
  interruptedAt: string | null;
  lastModelCall: ResumeLastModelCall | null;
  progressDigest: string | null;
}> {
  await ensureOnlineOrThrow();
  const resp = await fetch(`${getApiPrefix()}/ai/agent/task/${encodeURIComponent(taskId)}/resume`, {
    method: 'GET',
    headers: { ...getAuthHeader() },
  });
  let body: Record<string, unknown> = {};
  try {
    body = await resp.json();
  } catch {}
  if (!resp.ok) {
    throw new Error(String((body as { error?: string }).error || `HTTP ${resp.status}`));
  }
  return {
    resumable: body.resumable === true,
    interruptedAt: typeof body.interruptedAt === 'string' ? body.interruptedAt : null,
    lastModelCall: (body.lastModelCall as ResumeLastModelCall | null) || null,
    progressDigest: typeof body.progressDigest === 'string' ? body.progressDigest : null,
  };
}

/** POST /ai/agent/task/:taskId/resume — 执行续跑（新建关联 task 并进入 agent loop） */
export async function resumeAgentTask(taskId: string): Promise<{
  taskId: string;
  conversationId: string | null;
  resumeOfTaskId: string;
  interruptedAt: string | null;
  lastModelCall: ResumeLastModelCall | null;
}> {
  await ensureOnlineOrThrow();
  const resp = await fetch(`${getApiPrefix()}/ai/agent/task/${encodeURIComponent(taskId)}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({}),
  });
  let body: Record<string, unknown> = {};
  try {
    body = await resp.json();
  } catch {}
  if (!resp.ok || !body.taskId) {
    throw new Error(String((body as { error?: string }).error || `HTTP ${resp.status}`));
  }
  return {
    taskId: String(body.taskId),
    conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
    resumeOfTaskId: String(body.resumeOfTaskId || taskId),
    interruptedAt: typeof body.interruptedAt === 'string' ? body.interruptedAt : null,
    lastModelCall: (body.lastModelCall as ResumeLastModelCall | null) || null,
  };
}

export async function retryToolSummary(input: {
  toolJobId: string;
  projectId: string;
  conversationId: string;
  modelPresetId?: string;
}): Promise<string> {
  await ensureOnlineOrThrow();
  const resp = await fetch(getApiPrefix() + '/ai/tool-summary/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(input),
  });
  let body: { content?: string; error?: string; message?: string } = {};
  try {
    body = await resp.json();
  } catch {}
  if (!resp.ok || !body.content) {
    throw new Error(body.error || body.message || `HTTP ${resp.status}`);
  }
  return body.content;
}

/**
 * Stream a chat completion. Talks to /api/ai/agent (multi-turn tool calling),
 * falls back gracefully — server emits OpenAI-style choices.delta.content
 * plus extra `event` markers for tool_call / tool_result / iter.
 *
 * AGENT_TASK_MODE_v1：默认 task 模式（POST 提交拿 taskId → GET 订阅事件流，支持断线重连）。
 * env VITE_AGENT_TASK_MODE=legacy 或 ?legacy 回退到直连 SSE。
 */
export async function streamChat(opts: StreamChatOptions): Promise<void> {
  const useTaskMode = (import.meta.env.VITE_AGENT_TASK_MODE || 'task') !== 'legacy';
  if (useTaskMode) {
    return streamChatViaTask(opts);
  }
  return streamChatLegacy(opts);
}

/**
 * 扫描 localStorage 找出尚未完成的 agent task（页面刷新/崩溃恢复用）。
 * 返回 taskId（取最新一个）。streamChat 在提交时写入 key，订阅 [DONE] 或
 * onDone 时删除；若 mount 时 key 仍在 = 上次没跑完，需重新订阅。
 */
export function findResumableAgentTask(
  conversationId?: string,
  projectId?: string
): string | null {
  if (typeof window === 'undefined') return null;
  let latest: { taskId: string; ts: number } | null = null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !(key.startsWith('gewu_agent_task_') || key.startsWith('biof3_agent_task_'))) continue;
      try {
        const obj = JSON.parse(localStorage.getItem(key) || '{}');
        // AGENT-CONCURRENCY: sub-agent 永不被当主 run 恢复（老 key 无 kind 视为 primary）。
        const matchesConversation = !conversationId || obj.conversationId === conversationId;
        const matchesProject = !projectId || obj.projectId === projectId;
        if (
          obj?.taskId &&
          typeof obj.ts === 'number' &&
          (obj.kind || 'primary') !== 'subagent' &&
          matchesConversation &&
          matchesProject
        ) {
          if (!latest || obj.ts > latest.ts) latest = { taskId: obj.taskId, ts: obj.ts };
        }
      } catch {
        try {
          localStorage.removeItem(key);
        } catch {}
      }
    }
  } catch {}
  if (latest && Date.now() - latest.ts > 60 * 60 * 1000) {
    try {
      localStorage.removeItem('gewu_agent_task_' + latest.taskId);
      localStorage.removeItem('biof3_agent_task_' + latest.taskId);
    } catch {}
    return null;
  }
  return latest?.taskId ?? null;
}

export interface ResumableSubAgentTask {
  taskId: string;
  parentTaskId: string | null;
  ts: number;
}

/**
 * AGENT-CONCURRENCY: 扫描 localStorage 找出尚未完成的 sub-agent task
 * （与主 run 平行的后台子任务），供 app 启动/会话重开时重订阅其事件流，
 * 避免主进程崩溃/刷新后 sub-agent 孤儿化。仅返回 kind === 'subagent' 的项。
 */
export function findResumableSubAgentTasks(): ResumableSubAgentTask[] {
  if (typeof window === 'undefined') return [];
  const out: ResumableSubAgentTask[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !(key.startsWith('gewu_agent_task_') || key.startsWith('biof3_agent_task_'))) continue;
      try {
        const obj = JSON.parse(localStorage.getItem(key) || '{}');
        if (obj?.taskId && typeof obj.ts === 'number' && obj.kind === 'subagent') {
          if (Date.now() - obj.ts <= 60 * 60 * 1000) {
            out.push({ taskId: obj.taskId, parentTaskId: obj.parentTaskId ?? null, ts: obj.ts });
          } else {
            try {
              localStorage.removeItem(key);
            } catch {}
          }
        }
      } catch {
        try {
          localStorage.removeItem(key);
        } catch {}
      }
    }
  } catch {}
  return out.sort((a, b) => a.ts - b.ts);
}

/** task 模式：提交拿 taskId → 订阅事件流 */
async function streamChatViaTask(opts: StreamChatOptions): Promise<void> {
  let taskId: string;
  try {
    taskId = await submitAgentTask(opts);
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') return;
    // task 模式提交失败回退到 legacy（兼容期保护，仅限提交阶段）
    try {
      return await streamChatLegacy(opts);
    } catch {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
    return;
  }
  opts.onTaskStarted?.(taskId);
  // 存 localStorage 供重连发现（CopilotChat mount 时检查）。
  // AGENT-CONCURRENCY: 记录 kind + parentTaskId，使 sub-agent 不被误当主 run 恢复。
  try {
    localStorage.setItem(
      'gewu_agent_task_' + taskId,
      JSON.stringify({
        taskId,
        ts: Date.now(),
        kind: opts.kind || 'primary',
        parentTaskId: opts.parentTaskId || null,
        conversationId: opts.conversationId || null,
        projectId: opts.context?.projectId || null,
      })
    );
  } catch {}
  try {
    await subscribeAgentTask(taskId, opts, 0);
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') return;
    // BLOCK-39: 订阅阶段（已持有 taskId）不再回退 legacy——重发整段对话会重复执行
    // 已完成的步骤。断线已由 subscribeAgentTask 有界重连兜底，此处为重试耗尽或
    // 不可重试错误（HTTP 4xx/5xx），如实上报（用户仍可刷新走孤儿恢复）。
    opts.onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}

/** Request cancellation of a persisted background Agent task. */
export async function cancelAgentTask(taskId: string): Promise<void> {
  if (!taskId) return;
  const resp = await fetch(
    `${getApiPrefix()}/ai/agent/task/${encodeURIComponent(taskId)}/cancel`,
    {
      method: 'POST',
      headers: { ...getAuthHeader() },
    }
  );
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      message = String(body?.error || body?.message || message);
    } catch {}
    throw new Error(message);
  }
}

// ── BLOCK-65 P1-a/P2-c — agent 专属窗交互 + 俯瞰面板 ─────────

export interface AgentTaskMeta {
  taskId: string;
  status: string;
  agentStatus: string | null;
  taskText: string;
  conversationId: string | null;
  parentTaskId: string | null;
  createdAt: string | number | null;
  finishedAt: string | number | null;
}

export interface AgentTaskOverviewItem extends AgentTaskMeta {
  spawnSource: string | null;
  error: string | null;
  /** BLOCK-65 修正：会话归属项目（俯瞰面板按项目隔离） */
  projectId: string | null;
}

/** GET /ai/agent/tasks — 用户最近子 agent（跨会话，俯瞰面板数据源） */
export async function listAgentTasks(limit = 50): Promise<AgentTaskOverviewItem[]> {
  const resp = await fetch(`${getApiPrefix()}/ai/agent/tasks?limit=${encodeURIComponent(String(limit))}`, {
    headers: { ...getAuthHeader() },
  });
  const body = await resp.json().catch(() => null);
  if (!resp.ok || body?.ok !== true) {
    throw new Error(String(body?.message || body?.error || `HTTP ${resp.status}`));
  }
  return (body.tasks || []) as AgentTaskOverviewItem[];
}

/** GET /ai/agent/task/:id/meta — 专属窗标题（task 描述）+ 权威状态 */
export async function fetchAgentTaskMeta(taskId: string): Promise<AgentTaskMeta> {
  const resp = await fetch(`${getApiPrefix()}/ai/agent/task/${encodeURIComponent(taskId)}/meta`, {
    headers: { ...getAuthHeader() },
  });
  const body = await resp.json().catch(() => null);
  if (!resp.ok || body?.ok !== true) {
    throw new Error(String(body?.message || body?.error || `HTTP ${resp.status}`));
  }
  return body as AgentTaskMeta;
}

/** POST /ai/agent/task/:id/message — 留言（队列语义：续派时注入） */
export async function sendAgentTaskMessage(taskId: string, message: string): Promise<{ queued: boolean; note: string }> {
  const resp = await fetch(`${getApiPrefix()}/ai/agent/task/${encodeURIComponent(taskId)}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ message }),
  });
  const body = await resp.json().catch(() => null);
  if (!resp.ok || body?.ok !== true) {
    throw new Error(String(body?.message || body?.error || `HTTP ${resp.status}`));
  }
  return { queued: body.queued === true, note: String(body.note || '留言已入队。') };
}

/** POST /ai/agent/task/:id/followup — 终态后续派（沿用父链/模型/权限） */
export async function followupAgentTask(taskId: string, task: string): Promise<{ agentId: string; followupOf: string }> {
  const resp = await fetch(`${getApiPrefix()}/ai/agent/task/${encodeURIComponent(taskId)}/followup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ task }),
  });
  const body = await resp.json().catch(() => null);
  if (!resp.ok || body?.ok !== true) {
    throw new Error(String(body?.message || body?.error || `HTTP ${resp.status}`));
  }
  return { agentId: String(body.agentId), followupOf: String(body.followupOf || taskId) };
}

/** POST /ai/agent 提交，返回 taskId */
async function submitAgentTask(opts: StreamChatOptions): Promise<string> {
  const { messages, context, conversationId, modelPresetId, modelName, kind, parentTaskId, signal } = opts;
  // M2-5: 提交前先探测网络，离线时直接抛 OfflineError，避免裸 fetch 报错
  await ensureOnlineOrThrow();
  const resp = await fetch(getApiPrefix() + '/ai/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ messages, context, conversationId, modelPresetId, modelName, kind, parentTaskId }),
    signal,
  });
  if (!resp.ok) {
    let errText = `HTTP ${resp.status}`;
    try {
      const j = await resp.json();
      errText = j?.message ? `${j.error || errText}: ${j.message}` : String(j?.error || errText);
    } catch {}
    throw new Error(errText);
  }
  const data = await resp.json();
  if (!data?.taskId) throw new Error('未返回 taskId');
  return data.taskId as string;
}

/**
 * BLOCK-39: 订阅断线信号（typed）。仅三类来源：fetch 网络 reject（后端不可达）、
 * reader.read() reject（连接被切断）、流结束未见 [DONE]（干净截断）。携带 lastSeq
 * 供重连时 afterSeq 续传；HTTP 4xx/5xx 与 AbortError 不属于此类型（不重试）。
 */
export class AgentStreamDisconnectedError extends Error {
  readonly lastSeq: number;
  constructor(message: string, lastSeq: number) {
    super(message);
    this.name = 'AgentStreamDisconnected';
    this.lastSeq = lastSeq;
  }
}

/** 有界退避重连：起始 1s 指数至 4s 封顶，总窗口约 90s（覆盖 dev 后端重启 + 富余）。 */
const STREAM_RECONNECT_MAX_ATTEMPTS = 24;
const STREAM_RECONNECT_BASE_DELAY_MS = 1000;
const STREAM_RECONNECT_MAX_DELAY_MS = 4000;

function isAbortError(err: unknown): boolean {
  return (err as Error)?.name === 'AbortError';
}

/**
 * [DONE] 哨兵匹配：SSE 惯例是裸 `data: [DONE]`；防御兼容带引号的
 * `data: "[DONE]"`（JSON.stringify('[DONE]') 的历史 bug 形状——曾导致
 * 每个 task 完成后被判「在完成前中断」并烧完 90s 重连窗）。
 */
function isSseDone(data: string): boolean {
  return data === '[DONE]' || data === '"[DONE]"';
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** GET /ai/agent/task/:taskId 订阅事件流（afterSeq 支持续传；断线有界退避重连） */
export async function subscribeAgentTask(
  taskId: string,
  opts: StreamChatOptions,
  afterSeq = 0
): Promise<void> {
  let seq = afterSeq;
  for (let attempt = 0; ; attempt++) {
    try {
      seq = await subscribeAgentTaskOnce(taskId, opts, seq);
      return;
    } catch (err: unknown) {
      if (
        err instanceof AgentStreamDisconnectedError &&
        attempt < STREAM_RECONNECT_MAX_ATTEMPTS
      ) {
        // 断线时已收到的最后 seq（可能大于进入时的 afterSeq），重连从其后续传
        seq = err.lastSeq;
        const nextRetryMs = Math.min(
          STREAM_RECONNECT_BASE_DELAY_MS * 2 ** attempt,
          STREAM_RECONNECT_MAX_DELAY_MS
        );
        try {
          opts.onStreamReconnecting?.({ taskId, attempt: attempt + 1, lastSeq: seq, nextRetryMs });
          await abortableDelay(nextRetryMs, opts.signal);
        } catch (delayErr: unknown) {
          // 等待期间用户主动停止 → AbortError 上抛（调用方静默处理）
          throw delayErr;
        }
        continue;
      }
      throw err;
    }
  }
}

/** 单次订阅尝试；正常完成（收到 [DONE]）返回最后的 seq，断线抛 AgentStreamDisconnectedError */
async function subscribeAgentTaskOnce(
  taskId: string,
  opts: StreamChatOptions,
  afterSeq = 0
): Promise<number> {
  const { signal, onDone, kind } = opts;
  // token 放 query（fetch 也能带 header，但 query 兼容 EventSource 未来切换）
  const authHeader = getAuthHeader();
  const token = authHeader.Authorization?.replace('Bearer ', '');
  const url = `${getApiPrefix()}/ai/agent/task/${taskId}?afterSeq=${afterSeq}${token ? '&token=' + encodeURIComponent(token) : ''}`;
  let resp: Response;
  try {
    resp = await fetch(url, { method: 'GET', headers: { ...authHeader }, signal });
  } catch (err: unknown) {
    if (isAbortError(err)) throw err;
    throw new AgentStreamDisconnectedError('任务事件流连接中断', afterSeq);
  }
  if (!resp.ok || !resp.body) {
    let errText = `HTTP ${resp.status}`;
    try {
      const t = await resp.text();
      if (t) errText += ': ' + t.slice(0, 200);
    } catch {}
    throw new Error(errText);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let lastSeq = afterSeq;
  let sawDone = false;
  // BLOCK-31 P2: 记录 SSE done 事件携带的权威 filesChanged，随 agentTaskDone 派发
  let doneFiles: Array<{ path: string; status: string }> | undefined;
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      throw new AgentStreamDisconnectedError('任务事件流连接中断', lastSeq);
    }
    const { value, done } = chunk;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIdx;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      for (const line of rawEvent.split('\n')) {
        const m = line.match(/^data:\s?(.*)$/);
        if (!m) continue;
        const data = m[1];
        if (isSseDone(data)) {
          sawDone = true;
          try {
            localStorage.removeItem('gewu_agent_task_' + taskId);
            localStorage.removeItem('biof3_agent_task_' + taskId);
          } catch {}
          break;
        }
        try {
          const obj = JSON.parse(data);
          // task 模式事件包成 {seq, eventType, payload}，取 payload 走原解析
          const evt = obj.payload ? obj.payload : obj;
          if (typeof obj.seq === 'number') lastSeq = obj.seq;
          if (evt && evt.event === 'done' && Array.isArray(evt.filesChanged)) {
            doneFiles = evt.filesChanged;
          }
          _handleSseEvent(evt, opts);
        } catch {
          // Bad JSON — ignore
        }
      }
      if (sawDone) break;
    }
    if (sawDone) break;
  }
  if (!sawDone) {
    // BLOCK-39: 后端终态必发 [DONE]（events.js），干净截断 = 异常断线；
    // 不得误调 onDone 假装完成（任务实际可能已被清扫为 failed+interrupted）。
    throw new AgentStreamDisconnectedError('任务事件流在完成前中断', lastSeq);
  }
  onDone?.();
  emitAgentTaskDone(taskId, kind, {
    filesChanged: doneFiles,
    conversationId: opts.conversationId,
  });
  return lastSeq;
}

/** 处理单个 SSE 事件对象（原 streamChat 的解析逻辑，task/legacy 共用） */
function _handleSseEvent(obj: any, opts: StreamChatOptions): void {
  // UI-AGENTWB-###: SSE dispatch used to inline helpers (e.g.
  // localizeToolResult for backend tool-result envelopes). When those
  // helpers got refactored out of this module the call site silently
  // turned into `localizeToolResult is not a function` and bubbled up as
  // a flat "发生未知错误". Wrap the entire dispatch in a single typed
  // error guard so any dropped helper / type-coercion blow-up surfaces as
  // a friendly onError with the real message instead of swallowing the
  // whole stream.
  try {
    _dispatchSseEvent(obj, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.onError?.(new Error(`SSE dispatch failed: ${message}`));
  }
}

function _dispatchSseEvent(obj: any, opts: StreamChatOptions): void {
  const {
    onDelta,
    onReasoning,
    onDone,
    onError,
    onIter,
    onAgentStatus,
    onAgentProgress,
    onResultEditProgress,
    onToolCall,
    onToolOutput,
    onToolResult,
    onConversation,
    onTopicShift,
    onLoopPhase,
    onLoopIteration,
    onChildFinished,
    onModelFallback,
    kind,
  } = opts;
  if (obj.error) {
    // BLOCK-38 P2: 后端 error 事件携带 resumable/interruptedAt（服务中断清扫标记）
    // BLOCK-56 P1: 任务级降级时后端已自动新建续跑 task，error 附带 fallbackTaskId
    onError?.(new Error(obj.error), {
      resumable: obj.resumable === true,
      interruptedAt: typeof obj.interruptedAt === 'string' ? obj.interruptedAt : null,
      fallbackTaskId: typeof obj.fallbackTaskId === 'string' ? obj.fallbackTaskId : null,
      fallbackLabel: typeof obj.fallbackLabel === 'string' ? obj.fallbackLabel : null,
    });
    return;
  }
  if (obj.event === 'child_finished') {
    onChildFinished?.({
      childTaskId: String(obj.childTaskId || ''),
      status: String(obj.status || ''),
      summaryHead: String(obj.summaryHead || ''),
    });
    return;
  }
  if (obj.event === 'model_fallback') {
    onModelFallback?.({
      scope: typeof obj.scope === 'string' ? obj.scope : undefined,
      fromProfileId: typeof obj.fromProfileId === 'string' ? obj.fromProfileId : null,
      toProfileId: typeof obj.toProfileId === 'string' ? obj.toProfileId : null,
      toProfileLabel: typeof obj.toProfileLabel === 'string' ? obj.toProfileLabel : null,
      reason: typeof obj.reason === 'string' ? obj.reason : null,
      newTaskId: typeof obj.newTaskId === 'string' ? obj.newTaskId : null,
      message: typeof obj.message === 'string' ? obj.message : null,
    });
    return;
  }
  if (obj.event === 'conversation') {
    onConversation?.({ conversationId: obj.conversationId, title: obj.title });
    return;
  }
  if (obj.event === 'topic_shift') {
    onTopicShift?.({ conversationId: obj.conversationId, reason: obj.reason || '' });
    return;
  }
  // HLE-C4: Loop Controller events
  if (obj.event === 'loop_phase') {
    onLoopPhase?.({
      phase: String(obj.phase || ''),
      loopRunId: obj.loopRunId ? String(obj.loopRunId) : undefined,
      publicConclusion: obj.publicConclusion ? String(obj.publicConclusion) : undefined,
      reason: obj.reason ? String(obj.reason) : undefined,
      automationMode: obj.automationMode ? String(obj.automationMode) : undefined,
      executionIntent: obj.executionIntent === 'task_draft' || obj.executionIntent === 'task_execute'
        ? obj.executionIntent
        : undefined,
    });
    return;
  }
  if (obj.event === 'loop_iteration') {
    onLoopIteration?.({
      loopRunId: String(obj.loopRunId || ''),
      iterationId: String(obj.iterationId || ''),
      sequence: typeof obj.sequence === 'number' ? obj.sequence : 0,
      decision: String(obj.decision || ''),
      decisionReasonCode: String(obj.decisionReasonCode || ''),
      publicConclusion: String(obj.publicConclusion || ''),
      status: String(obj.status || ''),
      proposedActionKey: obj.proposedActionKey ? String(obj.proposedActionKey) : null,
      actionKeyHash: obj.actionKeyHash ? String(obj.actionKeyHash) : null,
    });
    return;
  }
  if (obj.event === 'iter') {
    onIter?.(obj.n || 1);
    return;
  }
  if (obj.event === 'agent_status') {
    onAgentStatus?.({
      phase: String(obj.phase || ''),
      message: String(obj.message || ''),
      attempt: typeof obj.attempt === 'number' ? obj.attempt : undefined,
      maxAttempts: typeof obj.maxAttempts === 'number' ? obj.maxAttempts : undefined,
      reason: obj.reason ? String(obj.reason) : undefined,
    });
    return;
  }
  if (obj.event === 'agent_progress') {
    const content = String(obj.content || '').trim();
    if (content) {
      onAgentProgress?.({
        iteration: typeof obj.iteration === 'number' ? obj.iteration : 1,
        content,
      });
    }
    return;
  }
  if (obj.event === 'result_edit_progress') {
    onResultEditProgress?.(parseResultEditProgressEvent(obj));
    return;
  }
  if (obj.event === 'tool_call') {
    onToolCall?.(parseToolCallEvent(obj));
    return;
  }
  if (obj.event === 'tool_output') {
    // BLOCK-33 P3 — 空 text 增量无意义，直接丢弃
    const outputEvent = parseToolOutputEvent(obj);
    if (outputEvent.text) onToolOutput?.(outputEvent);
    return;
  }
  if (obj.event === 'tool_result') {
    onToolResult?.(parseToolResultEvent(obj));
    return;
  }
  if (obj.event === 'done') {
    const doneTaskId =
      (typeof obj.taskId === 'string' && obj.taskId) || 'legacy';
    // BLOCK-31 P2: done 事件携带权威 filesChanged + 任务所属会话
    emitAgentTaskDone(doneTaskId, kind, {
      filesChanged: Array.isArray(obj.filesChanged) ? obj.filesChanged : undefined,
      conversationId: opts.conversationId,
    });
    return;
  }
  if (obj.event === 'token_budget') {
    const detail: TokenBudgetDetail = {
      contextWindow: typeof obj.contextWindow === 'number' ? obj.contextWindow : 0,
      messagesTokensUsed: typeof obj.messagesTokensUsed === 'number' ? obj.messagesTokensUsed : 0,
      systemPromptTokens: typeof obj.systemPromptTokens === 'number' ? obj.systemPromptTokens : 0,
      messagesTokens: typeof obj.messagesTokens === 'number' ? obj.messagesTokens : 0,
      pct: typeof obj.pct === 'number' ? obj.pct : 0,
      trimmed: typeof obj.trimmed === 'boolean' ? obj.trimmed : false,
    };
    dispatchGewuEvent(gewuEvents.tokenBudget, detail);
    return;
  }
  const delta = obj?.choices?.[0]?.delta?.content;
  if (typeof delta === 'string' && delta.length > 0) {
    onDelta(delta);
  }
  // UI-272 — 思考段增量（OpenAI 兼容 reasoning_content 字段）
  const reasoningDelta = obj?.choices?.[0]?.delta?.reasoning_content;
  if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
    onReasoning?.(reasoningDelta);
  }
}

/** 老路径：直连 SSE（fallback） */
async function streamChatLegacy(opts: StreamChatOptions): Promise<void> {
  const { messages, context, conversationId, modelPresetId, modelName, kind, parentTaskId, signal, onDelta, onDone, onError } = opts;
  try {
    // M2-5: 离线探测，先于 fetch 触发，避免裸 fetch 报错
    await ensureOnlineOrThrow();
    const resp = await fetch(getApiPrefix() + '/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ messages, context, conversationId, modelPresetId, modelName, kind, parentTaskId }),
      signal,
    });

    if (!resp.ok || !resp.body) {
      let errText = `HTTP ${resp.status}`;
      try {
        const j = await resp.json();
        if (j?.message) errText = `${j.error || errText}: ${j.message}`;
        else if (j?.error) errText = String(j.error);
      } catch {
        try {
          const t = await resp.text();
          if (t) errText = `HTTP ${resp.status}: ${t.slice(0, 200)}`;
        } catch {}
      }
      throw new Error(errText);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sepIdx;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        for (const line of rawEvent.split('\n')) {
          const m = line.match(/^data:\s?(.*)$/);
          if (!m) continue;
          const data = m[1];
          if (isSseDone(data)) {
            onDone?.();
            emitAgentTaskDone('legacy', kind, { conversationId: opts.conversationId });
            return;
          }
          try {
            const obj = JSON.parse(data);
            _handleSseEvent(obj, opts);
          } catch {
            // Bad JSON — ignore
          }
        }
      }
    }
    onDone?.();
    emitAgentTaskDone('legacy', kind, { conversationId: opts.conversationId });
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') return;
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Confirm to the server that a frontend-side act handler actually fired.
 * Called after each window event for `switch_result_tab`, etc.
 * If `info.error` is supplied the server records it.
 */
export async function ackAct(
  token: string,
  info?: { error?: string; ok?: boolean }
): Promise<void> {
  if (!token) return;
  try {
    await fetch(getApiPrefix() + '/ai/act-ack/' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(info || { ok: true }),
    });
  } catch {
    // best-effort
  }
}

// TOOL_JOB_APPROVAL_v1（阶段2 Task3）：重操作 run_tool 确认/取消。
// approve=true 落 ack_status=approved，agent 下轮重调 run_tool(ackToken) 续跑；
// approve=false 落 rejected，agent 收到 user_rejected 取消。
export async function ackRunTool(
  token: string,
  approve: boolean,
  scope: { projectId: string | null; conversationId: string | null },
): Promise<boolean> {
  if (!token) return false;
  try {
    const response = await fetch(getApiPrefix() + '/ai/run-tool-ack/' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ approve, projectId: scope.projectId, conversationId: scope.conversationId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
