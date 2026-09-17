import type { LoopIterationEvent } from '@/lib/loop-client';
import type { AgentTaskTodoItem, ResultEditProgressEvent } from '../copilotClient';
import type { ToolActivityItem } from '../toolActivity';

export interface ConversationPendingApproval {
  ackToken: string;
  toolJobId?: string;
  toolId?: string;
  message?: string;
  params?: Record<string, unknown>;
}

export type ConversationRunStatus = 'running' | 'done' | 'error' | 'stopped';

/**
 * HLE-C4R: durable-loop projection carried alongside the transient run.
 * Sourced ONLY from backend loop_phase / loop_iteration SSE events; the UI
 * never derives loop completion itself. Iterations are deduped by iterationId
 * so SSE + API replay merge idempotently.
 */
export interface ConversationLoopState {
  loopRunId: string;
  /** last phase the backend announced: started | resumed | cancelled | blocked | completed | ... */
  phase: string;
  automationMode?: string;
  executionIntent?: 'task_draft' | 'task_execute';
  /** most recent public conclusion (phase or iteration), safe to display. */
  latestConclusion?: string;
  /** true once the backend reports the run was interrupted and needs recovery. */
  recoveryRequired: boolean;
  /** per-turn iterations, ordered by sequence, deduped by iterationId. */
  iterations: LoopIterationEvent[];
  /** last decision the controller made this run. */
  lastDecision?: string;
}

export interface ConversationRunSnapshot {
  conversationId: string;
  projectId: string;
  status: ConversationRunStatus;
  userContent: string;
  userTs: string;
  historyLastUserTs?: string;
  assistantContent: string;
  assistantTs: string;
  assistantPending: boolean;
  assistantError: boolean;
  statusMessage?: string;
  /** UI-AGENTWB-### / chat-error-rendering: raw stack trace of the last
   *  assistant error (tool / harness / Python worker crash). The chat
   *  surface forwards this to ErrorBanner's `technicalDetails` slot so the
   *  "查看详情" disclosure becomes available — without it the user only
   *  sees the humanised userMessage ("发生未知错误") and has no way to
   *  reach the underlying `ModuleNotFoundError` / worker exit code / SSE
   *  failure that triggered it.
   */
  technicalDetails?: string;
  /** UI-AGENTWB-### / chat-error-rendering: classifier code for the last
   *  assistant error (UNKNOWN / TOOL_ERROR / INTERNAL_ERROR / etc). Lets
   *  the UI show a stable category without re-classifying on every render.
   */
  errorCode?: string;
  progressUpdates: Array<{ iteration: number; content: string }>;
  resultEditProgress: ResultEditProgressEvent[];
  /** Opaque click-time scope used only to prevent progress crossing results. */
  resultContextToken?: string;
  toolActivities: ToolActivityItem[];
  pendingApproval: ConversationPendingApproval | null;
  processingDurationMs?: number;
  startedAt: number;
  completedAt?: number;
  taskId?: string;
  /** AGENT-CONCURRENCY: when set, this run is a sub-agent child of the primary task with this id. */
  parentTaskId?: string;
  /** HLE-C4R: live durable-loop projection (null until the backend starts a LoopRun). */
  loop?: ConversationLoopState | null;
  /** UI-272 — 按迭代聚合的模型思考段（reasoning_content），流式累积；done 后随消息展示并经后端 meta 持久化。 */
  reasoningByIteration?: Record<number, string>;
  /** BLOCK-38 P2 — 服务中断被清扫标记的任务可续跑（SSE error 事件 resumable 标记），UI 据此显示「继续执行」。 */
  resumable?: boolean;
  /** BLOCK-38 P2 — 服务中断时间（后端清扫写入 interrupted_at）。 */
  interruptedAt?: string;
  /** BLOCK-38 P2 — 续跑已发起后被续跑的原 taskId（审计链展示用）。 */
  resumeOfTaskId?: string;
  /** BLOCK-56 P1 — 模型降级提示（请求级/任务级首次发生时记录），UI 任务条显示「已降级到 X 模型」。 */
  modelFallbackNotice?: string;
  /** BLOCK-93 P2 — spawn 显式角色（服务端 agent-roles 注册表 key；未指定为 undefined → UI 文本推断兜底）。 */
  agentRole?: string;
  /** BLOCK-97 — 任务清单整单快照（task_todo 事件投影；新 run 开始自然清空）。 */
  todoList?: AgentTaskTodoItem[];
}

/** BLOCK-49 加映 — proactive：子 agent 终态通知（会话级，下一次 run 开始清除）。 */
export interface ChildFinishedNotice {
  childTaskId: string;
  status: string;
  summaryHead: string;
  ts: string;
}
