import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { CopilotContext } from '@/lib/copilotContext';
import { biof3Events, dispatchBioF3Event } from '@/lib/events';
import {
  cancelAgentTask,
  findResumableAgentTask,
  streamChat,
  subscribeAgentTask,
  type ChatMessage,
  type ToolCallEvent,
  type ToolOutputEvent,
  type ToolResultEvent,
  type ResultEditProgressEvent,
  type StreamChatOptions,
} from './copilotClient';
import {
  mergeToolCallActivity,
  mergeToolOutputActivity,
  mergeToolResultActivity,
  type ToolActivityItem,
} from './toolActivity';
import { fetchLoopRuns } from '@/lib/loop-client';
import type { LoopPhaseEvent, LoopIterationEvent, LoopRunCompact } from '@/lib/loop-client';
import { formatErrorForUser } from './errorMessages';
import { recordConversationFileChange } from './conversationChangesStore';

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
}

interface StartConversationRunOptions {
  conversationId: string;
  projectId: string;
  userContent: string;
  historyLastUserTs?: string;
  messages: ChatMessage[];
  context: CopilotContext;
  modelPresetId?: string;
  modelName?: string;
  /**
   * AGENT-CONCURRENCY A-5: 恢复模式。提供则跳过重新提交，直接订阅该已存在
   * 的 task 事件流（崩溃/刷新前仍在跑的主 agent），用于 app 启动/会话重开时
   * 避免主 run 孤儿化。userContent 退化为占位提示。
   */
  resumeTaskId?: string;
}

const runs = new Map<string, ConversationRunSnapshot>();
const controllers = new Map<string, AbortController>();
const listeners = new Map<string, Set<() => void>>();

function emit(conversationId: string): void {
  listeners.get(conversationId)?.forEach((listener) => listener());
}

function replaceRun(
  conversationId: string,
  update: (current: ConversationRunSnapshot) => ConversationRunSnapshot
): void {
  const current = runs.get(conversationId);
  if (!current) return;
  runs.set(conversationId, update(current));
  emit(conversationId);
}

/**
 * HLE-C4R: fold a loop_phase event into the durable-loop projection. Pure.
 * Never derives completion — it only records the phase the backend announced.
 */
function mergeLoopPhase(
  current: ConversationLoopState | null | undefined,
  info: LoopPhaseEvent
): ConversationLoopState {
  const loopRunId = info.loopRunId || current?.loopRunId || '';
  return {
    loopRunId,
    phase: info.phase || current?.phase || 'running',
    automationMode: info.automationMode || current?.automationMode,
    executionIntent: info.executionIntent || current?.executionIntent,
    latestConclusion: info.publicConclusion || current?.latestConclusion,
    recoveryRequired: current?.recoveryRequired ?? false,
    iterations: current?.iterations || [],
    lastDecision: current?.lastDecision,
  };
}

/**
 * HLE-C4R: fold a loop_iteration event into the projection. Pure + idempotent:
 * iterations dedupe by iterationId and stay ordered by sequence ASC, so an SSE
 * event and a later API replay of the same iteration merge to one entry.
 */
function mergeLoopIteration(
  current: ConversationLoopState | null | undefined,
  info: LoopIterationEvent
): ConversationLoopState {
  const loopRunId = info.loopRunId || current?.loopRunId || '';
  const prior = current?.iterations || [];
  const withoutDup = prior.filter((it) => it.iterationId !== info.iterationId);
  const iterations = [...withoutDup, info].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  return {
    loopRunId,
    phase: current?.phase || 'running',
    automationMode: current?.automationMode,
    executionIntent: current?.executionIntent,
    latestConclusion: info.publicConclusion || current?.latestConclusion,
    recoveryRequired: current?.recoveryRequired ?? false,
    iterations,
    lastDecision: info.decision || current?.lastDecision,
  };
}

export function getConversationRunSnapshot(
  conversationId: string | null | undefined
): ConversationRunSnapshot | null {
  return conversationId ? runs.get(conversationId) || null : null;
}

export function subscribeConversationRun(
  conversationId: string | null | undefined,
  listener: () => void
): () => void {
  if (!conversationId) return () => {};
  const current = listeners.get(conversationId) || new Set<() => void>();
  current.add(listener);
  listeners.set(conversationId, current);
  return () => {
    const active = listeners.get(conversationId);
    active?.delete(listener);
    if (active?.size === 0) listeners.delete(conversationId);
  };
}

export function useConversationRun(
  conversationId: string | null | undefined
): ConversationRunSnapshot | null {
  const subscribe = useCallback(
    (listener: () => void) => subscribeConversationRun(conversationId, listener),
    [conversationId]
  );
  const getSnapshot = useCallback(
    () => getConversationRunSnapshot(conversationId),
    [conversationId]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isConversationRunning(conversationId: string | null | undefined): boolean {
  return getConversationRunSnapshot(conversationId)?.status === 'running';
}

export function resultEditProgressForContext(
  snapshot: ConversationRunSnapshot | null | undefined,
  contextToken: string | null | undefined,
): ResultEditProgressEvent[] {
  if (!snapshot || !contextToken || snapshot.resultContextToken !== contextToken) return [];
  return snapshot.resultEditProgress;
}

export function shouldClearReconciledConversationRun(
  snapshot: Pick<ConversationRunSnapshot, 'status' | 'pendingApproval'>
): boolean {
  return (snapshot.status === 'done' || snapshot.status === 'stopped') && !snapshot.pendingApproval;
}

export function startConversationRun(options: StartConversationRunOptions): boolean {
  const { conversationId } = options;
  if (!conversationId || isConversationRunning(conversationId)) return false;

  const startedAt = Date.now();
  const ctrl = new AbortController();
  controllers.get(conversationId)?.abort();
  controllers.set(conversationId, ctrl);
  let assistantAcc = '';

  runs.set(conversationId, {
    conversationId,
    projectId: options.projectId,
    status: 'running',
    userContent: options.userContent,
    userTs: new Date(startedAt).toISOString(),
    historyLastUserTs: options.historyLastUserTs,
    assistantContent: '',
    assistantTs: new Date(startedAt + 1).toISOString(),
    assistantPending: true,
    assistantError: false,
    progressUpdates: [],
    resultEditProgress: [],
    resultContextToken: typeof options.context.activeArtifact?.contextToken === 'string'
      ? options.context.activeArtifact.contextToken
      : undefined,
    toolActivities: [],
    pendingApproval: null,
    startedAt,
    taskId: options.resumeTaskId ?? undefined,
  });
  emit(conversationId);

  const finish = (status: 'done' | 'error', error?: Error) => {
    if (runs.get(conversationId)?.status !== 'running') return;
    const completedAt = Date.now();
    const formattedError = error ? formatErrorForUser(error) : null;
    // UI-AGENTWB-### / chat-error-rendering: persist the raw stack + error
    // code alongside the humanised userMessage. Without this, the user only
    // ever sees "发生未知错误" with no way to reach the underlying
    // ModuleNotFoundError / worker exit code / harness validation failure
    // that triggered it. ErrorBanner reads these via SimpleMessage.
    const rawStack = error?.stack || (error ? String(error) : undefined);
    const errorCode = formattedError?.code;
    replaceRun(conversationId, (current) => ({
      ...current,
      status,
      assistantContent: error && formattedError
        ? formattedError.userMessage
        : current.assistantContent,
      assistantPending: false,
      assistantError: status === 'error',
      statusMessage: undefined,
      technicalDetails: status === 'error' ? rawStack : undefined,
      errorCode: status === 'error' ? errorCode : undefined,
      processingDurationMs: Math.max(0, completedAt - current.startedAt),
      completedAt,
    }));
  };

  const callbacks: Pick<
    StreamChatOptions,
    | 'onIter'
    | 'onTaskStarted'
    | 'onAgentStatus'
    | 'onAgentProgress'
    | 'onResultEditProgress'
    | 'onDelta'
    | 'onToolCall'
    | 'onToolOutput'
    | 'onToolResult'
    | 'onLoopPhase'
    | 'onLoopIteration'
    | 'onDone'
    | 'onError'
  > = {
    onIter: (iteration) => {
      if (iteration <= 1) return;
      assistantAcc = '';
      replaceRun(conversationId, (current) => ({
        ...current,
        assistantContent: '',
        assistantPending: true,
        statusMessage: undefined,
      }));
    },
    onTaskStarted: (taskId) => {
      replaceRun(conversationId, (current) => ({ ...current, taskId }));
    },
    onAgentStatus: (status) => {
      replaceRun(conversationId, (current) => ({
        ...current,
        statusMessage: status.message,
        assistantPending: true,
      }));
    },
    onAgentProgress: (progress) => {
      assistantAcc = '';
      replaceRun(conversationId, (current) => {
        const duplicate = current.progressUpdates.some(
          (item) => item.iteration === progress.iteration && item.content === progress.content
        );
        return {
          ...current,
          progressUpdates: duplicate
            ? current.progressUpdates
            : [...current.progressUpdates, progress].slice(-50),
          assistantContent: '',
          assistantPending: true,
          statusMessage: undefined,
        };
      });
    },
    onResultEditProgress: (progress) => {
      const labels: Record<string, string> = {
        change_set: '正在创建隔离修改',
        materialize: '正在生成独立脚本与参数',
        commit: '已保存候选版本',
        job: '正在运行结果重绘/重算',
        revision: '正在验证并登记结果版本',
        preview: '候选结果已就绪',
        cancelled: '结果修改已取消',
        failed: '结果修改未完成',
      };
      replaceRun(conversationId, (current) => {
        const withoutSameSequence = current.resultEditProgress.filter(
          (item) => item.changeSetId !== progress.changeSetId || item.sequence !== progress.sequence
        );
        return {
          ...current,
          resultEditProgress: [...withoutSameSequence, progress]
            .sort((a, b) => a.sequence - b.sequence)
            .slice(-30),
          statusMessage: labels[progress.stage] || '正在处理结果修改',
          assistantPending: true,
        };
      });
    },
    onDelta: (delta) => {
      assistantAcc += delta;
      replaceRun(conversationId, (current) => ({
        ...current,
        assistantContent: assistantAcc,
        assistantPending: false,
        statusMessage: undefined,
      }));
    },
    onToolCall: (event: ToolCallEvent) => {
      replaceRun(conversationId, (current) => ({
        ...current,
        toolActivities: mergeToolCallActivity(current.toolActivities, event),
      }));
    },
    onToolOutput: (event: ToolOutputEvent) => {
      replaceRun(conversationId, (current) => ({
        ...current,
        toolActivities: mergeToolOutputActivity(current.toolActivities, event),
      }));
    },
    onToolResult: (event: ToolResultEvent) => {
      replaceRun(conversationId, (current) => ({
        ...current,
        toolActivities: mergeToolResultActivity(current.toolActivities, event),
        pendingApproval:
          event.name === 'run_tool' && event.needApproval && event.ackToken
            ? {
                ackToken: event.ackToken,
                toolJobId: event.toolJobId,
                toolId: event.toolId,
                message: event.message,
                params: event.params,
              }
            : current.pendingApproval,
      }));
      if (
        event.toolResult?.status === 'success' &&
        ['workspace_write', 'workspace_replace', 'workspace_exec'].includes(event.toolResult.tool || event.name)
      ) {
        // BLOCK-31 P2: 实时登记本会话改动文件（收尾时由权威清单对账合并）
        const writeData = event.toolResult?.data as
          | { path?: unknown; created?: unknown; dryRun?: unknown }
          | undefined;
        if (
          (event.toolResult?.tool === 'workspace_write' || event.toolResult?.tool === 'workspace_replace') &&
          writeData &&
          typeof writeData.path === 'string' &&
          writeData.dryRun !== true
        ) {
          recordConversationFileChange(
            conversationId,
            writeData.path,
            writeData.created === true ? 'created' : 'modified'
          );
        }
        dispatchBioF3Event(biof3Events.projectWorkspaceChanged, {
          projectId: options.projectId,
          source: 'agent',
        });
      }
      if (
        event.name === 'run_tool' &&
        event.toolResult?.status === 'success' &&
        !event.needApproval &&
        event.toolJobId
      ) {
        dispatchBioF3Event(biof3Events.projectOpenResult, {
          toolJobId: event.toolJobId,
          projectId: options.projectId,
        });
      }
      // BLOCK-34 P3: 后台进程启动成功 → 通知浮窗自动弹出并轮询日志
      if (
        event.toolResult?.tool === 'workspace_exec_background' &&
        event.toolResult?.status === 'success'
      ) {
        const bgData = event.toolResult?.data as { processId?: unknown } | undefined;
        const processId =
          bgData && typeof bgData.processId === 'string' ? bgData.processId : null;
        if (processId) {
          try {
            dispatchBioF3Event(biof3Events.agentBackgroundProcess, {
              processId,
              conversationId,
            });
          } catch {
            // 事件总线失败不阻塞工具结果处理
          }
        }
      }
    },
    onLoopPhase: (info) => {
      replaceRun(conversationId, (current) => ({
        ...current,
        loop: mergeLoopPhase(current.loop, info),
      }));
    },
    onLoopIteration: (info) => {
      replaceRun(conversationId, (current) => ({
        ...current,
        loop: mergeLoopIteration(current.loop, info),
      }));
    },
    onDone: () => finish('done'),
    onError: (error) => finish('error', error),
  };

  if (options.resumeTaskId) {
    // AGENT-CONCURRENCY A-5: 恢复模式 — 直接订阅已存在的 task 事件流，不重新提交。
    void subscribeAgentTask(
      options.resumeTaskId,
      { messages: [], conversationId, signal: ctrl.signal, ...callbacks },
      0
    )
      .catch(() => finish('error', new Error('订阅失败')))
      .finally(() => {
        if (controllers.get(conversationId) === ctrl) controllers.delete(conversationId);
      });
  } else {
    void streamChat({
      messages: options.messages,
      context: options.context,
      conversationId,
      modelPresetId: options.modelPresetId,
      modelName: options.modelName,
      signal: ctrl.signal,
      ...callbacks,
    }).finally(() => {
      if (controllers.get(conversationId) === ctrl) controllers.delete(conversationId);
    });
  }

  return true;
}

export function clearConversationPendingApproval(conversationId: string): void {
  replaceRun(conversationId, (current) => ({ ...current, pendingApproval: null }));
}

export function clearConversationRun(conversationId: string): void {
  controllers.get(conversationId)?.abort();
  controllers.delete(conversationId);
  if (runs.delete(conversationId)) emit(conversationId);
}

export function stopConversationRun(conversationId: string): void {
  const current = runs.get(conversationId);
  if (!current || current.status !== 'running') return;
  const completedAt = Date.now();
  replaceRun(conversationId, (snapshot) => ({
    ...snapshot,
    status: 'stopped',
    assistantContent: snapshot.assistantContent.trim()
      ? snapshot.assistantContent
      : '任务已停止，已完成的阶段结论和工具记录已保留。',
    assistantPending: false,
    assistantError: false,
    statusMessage: undefined,
    processingDurationMs: Math.max(0, completedAt - snapshot.startedAt),
    completedAt,
  }));
  if (current.taskId) {
    void cancelAgentTask(current.taskId).catch((error) => {
      replaceRun(conversationId, (snapshot) => ({
        ...snapshot,
        statusMessage: `后台停止请求未确认：${error instanceof Error ? error.message : String(error)}`,
      }));
    });
  }
  controllers.get(conversationId)?.abort();
  controllers.delete(conversationId);
}

export function __resetConversationRunsForTests(): void {
  controllers.forEach((controller) => controller.abort());
  controllers.clear();
  runs.clear();
  listeners.clear();
  subTaskRuns.clear();
  subTaskListeners.clear();
  subTaskConvListeners.clear();
}

// ===========================================================================
// AGENT-CONCURRENCY: parallel sub-agent task subsystem.
// Each sub-agent streams independently under its own taskId while the primary
// conversation loop is busy, so the user can run extra background work without
// blocking the main thread of the conversation. The primary run path above is
// intentionally left intact.
// ===========================================================================
const subTaskRuns = new Map<string, ConversationRunSnapshot>();
const subTaskListeners = new Map<string, Set<() => void>>();
const subTaskConvListeners = new Map<string, Set<() => void>>();

function emitSubTask(taskId: string): void {
  subTaskListeners.get(taskId)?.forEach((listener) => listener());
  const convId = subTaskRuns.get(taskId)?.conversationId;
  if (convId) subTaskConvListeners.get(convId)?.forEach((listener) => listener());
}

function replaceSubTask(
  taskId: string,
  update: (current: ConversationRunSnapshot) => ConversationRunSnapshot
): void {
  const current = subTaskRuns.get(taskId);
  if (!current) return;
  subTaskRuns.set(taskId, update(current));
  emitSubTask(taskId);
}

export function getSubAgentTaskSnapshot(taskId: string | null | undefined): ConversationRunSnapshot | null {
  return taskId ? subTaskRuns.get(taskId) || null : null;
}

export function subscribeSubAgentTask(taskId: string | null | undefined, listener: () => void): () => void {
  if (!taskId) return () => {};
  const current = subTaskListeners.get(taskId) || new Set<() => void>();
  current.add(listener);
  subTaskListeners.set(taskId, current);
  return () => {
    const active = subTaskListeners.get(taskId);
    active?.delete(listener);
    if (active?.size === 0) subTaskListeners.delete(taskId);
  };
}

export function useSubAgentTask(taskId: string | null | undefined): ConversationRunSnapshot | null {
  const subscribe = useCallback((listener: () => void) => subscribeSubAgentTask(taskId, listener), [taskId]);
  const getSnapshot = useCallback(() => getSubAgentTaskSnapshot(taskId), [taskId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isSubAgentTaskRunning(taskId: string | null | undefined): boolean {
  return getSubAgentTaskSnapshot(taskId)?.status === 'running';
}

export function subscribeSubAgentTasksForConversation(
  conversationId: string | null | undefined,
  listener: () => void
): () => void {
  if (!conversationId) return () => {};
  const current = subTaskConvListeners.get(conversationId) || new Set<() => void>();
  current.add(listener);
  subTaskConvListeners.set(conversationId, current);
  return () => {
    const active = subTaskConvListeners.get(conversationId);
    active?.delete(listener);
    if (active?.size === 0) subTaskConvListeners.delete(conversationId);
  };
}

export function useSubAgentTasksForConversation(conversationId: string | null | undefined): ConversationRunSnapshot[] {
  const [list, setList] = useState(() => listSubAgentTasksForConversation(conversationId));
  useEffect(() => {
    setList(listSubAgentTasksForConversation(conversationId));
    return subscribeSubAgentTasksForConversation(conversationId, () => {
      setList(listSubAgentTasksForConversation(conversationId));
    });
  }, [conversationId]);
  return list;
}

export function listSubAgentTasksForConversation(conversationId: string | null | undefined): ConversationRunSnapshot[] {
  if (!conversationId) return [];
  return [...subTaskRuns.values()]
    .filter((s) => s.conversationId === conversationId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

export interface StartSubAgentTaskOptions {
  conversationId: string;
  projectId: string;
  userContent: string;
  messages: ChatMessage[];
  context: CopilotContext;
  parentTaskId: string;
  modelPresetId?: string;
  modelName?: string;
}

export function startSubAgentTask(options: StartSubAgentTaskOptions): void {
  const { conversationId, projectId, userContent, messages, context, parentTaskId, modelPresetId, modelName } = options;
  if (!conversationId || !parentTaskId) return;
  const startedAt = Date.now();
  let currentTaskId: string | undefined;
  let assistantAcc = '';

  const finishSub = (status: 'done' | 'error', error?: Error) => {
    if (!currentTaskId) return;
    if (subTaskRuns.get(currentTaskId)?.status !== 'running') return;
    const formattedError = error ? formatErrorForUser(error) : null;
    replaceSubTask(currentTaskId, (c) => ({
      ...c,
      status,
      assistantContent: error && formattedError ? formattedError.userMessage : c.assistantContent,
      assistantPending: false,
      assistantError: status === 'error',
      processingDurationMs: Math.max(0, Date.now() - c.startedAt),
      completedAt: Date.now(),
    }));
  };

  void streamChat({
    messages,
    context,
    conversationId,
    modelPresetId,
    modelName,
    kind: 'subagent',
    parentTaskId,
    onTaskStarted: (taskId) => {
      currentTaskId = taskId;
      subTaskRuns.set(taskId, {
        conversationId,
        projectId,
        status: 'running',
        userContent,
        userTs: new Date(startedAt).toISOString(),
        assistantContent: '',
        assistantTs: new Date(startedAt + 1).toISOString(),
        assistantPending: true,
        assistantError: false,
        progressUpdates: [],
        resultEditProgress: [],
        toolActivities: [],
        pendingApproval: null,
        startedAt,
        taskId,
        parentTaskId,
      });
      emitSubTask(taskId);
    },
    onAgentStatus: (status) => {
      if (!currentTaskId) return;
      replaceSubTask(currentTaskId, (c) => ({
        ...c,
        statusMessage: status.message,
        assistantPending: true,
      }));
    },
    onAgentProgress: (progress) => {
      if (!currentTaskId) return;
      assistantAcc = '';
      replaceSubTask(currentTaskId, (c) => {
        const duplicate = c.progressUpdates.some(
          (item) => item.iteration === progress.iteration && item.content === progress.content
        );
        return {
          ...c,
          progressUpdates: duplicate ? c.progressUpdates : [...c.progressUpdates, progress].slice(-50),
          assistantContent: '',
          assistantPending: true,
          statusMessage: undefined,
        };
      });
    },
    onResultEditProgress: (progress) => {
      if (!currentTaskId) return;
      replaceSubTask(currentTaskId, (c) => {
        const withoutSameSequence = c.resultEditProgress.filter(
          (item) => item.changeSetId !== progress.changeSetId || item.sequence !== progress.sequence
        );
        return {
          ...c,
          resultEditProgress: [...withoutSameSequence, progress]
            .sort((a, b) => a.sequence - b.sequence)
            .slice(-30),
          statusMessage: '正在处理结果修改',
          assistantPending: true,
        };
      });
    },
    onDelta: (delta) => {
      if (!currentTaskId) return;
      assistantAcc += delta;
      replaceSubTask(currentTaskId, (c) => ({
        ...c,
        assistantContent: assistantAcc,
        assistantPending: false,
        statusMessage: undefined,
      }));
    },
    onToolCall: (event) => {
      if (!currentTaskId) return;
      replaceSubTask(currentTaskId, (c) => ({
        ...c,
        toolActivities: mergeToolCallActivity(c.toolActivities, event),
      }));
    },
    onToolOutput: (event) => {
      if (!currentTaskId) return;
      replaceSubTask(currentTaskId, (c) => ({
        ...c,
        toolActivities: mergeToolOutputActivity(c.toolActivities, event),
      }));
    },
    onToolResult: (event) => {
      if (!currentTaskId) return;
      replaceSubTask(currentTaskId, (c) => ({
        ...c,
        toolActivities: mergeToolResultActivity(c.toolActivities, event),
        pendingApproval:
          event.name === 'run_tool' && event.needApproval && event.ackToken
            ? {
                ackToken: event.ackToken,
                toolJobId: event.toolJobId,
                toolId: event.toolId,
                message: event.message,
                params: event.params,
              }
            : c.pendingApproval,
      }));
    },
    onDone: () => finishSub('done'),
    onError: (error) => finishSub('error', error),
  });
}

/**
 * AGENT-CONCURRENCY: 重订阅一个已存在（崩溃/刷新前仍在跑）的 sub-agent task。
 * 不重新提交，直接订阅其后端事件流并写入 subTaskRuns 状态，避免孤儿化。
 */
function subscribeSubAgentResumed(
  taskId: string,
  conversationId: string,
  projectId: string,
  parentTaskId: string | null | undefined,
  userContent = '（恢复后台任务）'
): void {
  const startedAt = Date.now();
  let assistantAcc = '';
  const finish = (status: 'done' | 'error', error?: Error) => {
    const cur = subTaskRuns.get(taskId);
    if (!cur || cur.status !== 'running') return;
    const formattedError = error ? formatErrorForUser(error) : null;
    replaceSubTask(taskId, (c) => ({
      ...c,
      status,
      assistantContent: error && formattedError ? formattedError.userMessage : c.assistantContent,
      assistantPending: false,
      assistantError: status === 'error',
      processingDurationMs: Math.max(0, Date.now() - c.startedAt),
      completedAt: Date.now(),
    }));
  };
  subTaskRuns.set(taskId, {
    conversationId,
    projectId,
    status: 'running',
    userContent,
    userTs: new Date(startedAt).toISOString(),
    assistantContent: '',
    assistantTs: new Date(startedAt + 1).toISOString(),
    assistantPending: true,
    assistantError: false,
    progressUpdates: [],
    resultEditProgress: [],
    toolActivities: [],
    pendingApproval: null,
    startedAt,
    taskId,
    parentTaskId: parentTaskId ?? undefined,
    loop: null,
  });
  emitSubTask(taskId);
  void subscribeAgentTask(
    taskId,
    {
      messages: [],
      conversationId,
      onDelta: (delta) => {
        assistantAcc += delta;
        replaceSubTask(taskId, (c) => ({
          ...c,
          assistantContent: assistantAcc,
          assistantPending: false,
        }));
      },
      onDone: () => finish('done'),
      onError: (error) => finish('error', error),
    },
    0
  ).catch(() => finish('error', new Error('订阅失败')));
}

/**
 * AGENT-CONCURRENCY: 会话重开 / 应用重启时，从后端 loop_runs 找回仍 running
 * 的 sub-agent run 并重订阅其事件流，避免孤儿化。loop_runs 是权威来源，
 * 覆盖 localStorage 之外的恢复场景（与 copilotClient.findResumableSubAgentTasks 互补）。
 */
export async function resumeSubAgentTasks(
  conversationId: string,
  projectId?: string
): Promise<void> {
  if (!conversationId) return;
  let runs: LoopRunCompact[] = [];
  try {
    runs = await fetchLoopRuns({ conversationId, projectId });
  } catch {
    return;
  }
  const subRuns = runs.filter(
    (run) =>
      run.loopStatus === 'running' &&
      (run.kind === 'subagent' || (run.kind == null && !!run.parentLoopRunId)) &&
      !!run.taskId &&
      run.conversationId === conversationId &&
      typeof run.projectId === 'string' &&
      run.projectId.length > 0 &&
      (!projectId || run.projectId === projectId)
  );
  for (const run of subRuns) {
    const taskId = run.taskId as string;
    if (subTaskRuns.has(taskId)) continue;
    subscribeSubAgentResumed(
      taskId,
      conversationId,
      run.projectId,
      run.parentLoopRunId,
      '（恢复后台任务）'
    );
  }
}

/**
 * AGENT-CONCURRENCY A-5: 重订阅一个崩溃/刷新前仍在跑的主 agent task（来自
 * localStorage 的 findResumableAgentTask）。不重新提交，直接订阅其后端事件流
 * 并写入主 run 状态，避免主 run 孤儿化。taskId 已在 run 快照中登记。
 */
export function resumeConversationRun(
  resumeTaskId: string,
  conversationId: string,
  projectId?: string
): boolean {
  return startConversationRun({
    conversationId,
    projectId: projectId || '',
    userContent: '（恢复后台任务）',
    messages: [],
    context: { page: 'desktop-project', projectId: projectId || '' },
    resumeTaskId,
  });
}

/**
 * AGENT-CONCURRENCY A-5: app 启动 / 会话重开时的孤儿恢复入口。
 * - sub-agent：后端 loop_runs 是权威来源，覆盖刷新/崩溃场景。
 * - 主 agent：localStorage 中尚未完成的 primary task（findResumableAgentTask）。
 * 两者互补：loop_runs 覆盖服务侧仍在跑的，localStorage 覆盖前端已提交但事件流
 * 尚未结束的。仅当当前会话没有活跃主 run 时才恢复主 agent，避免重复订阅。
 */
export async function resumeOrphanAgentTasks(
  conversationId: string,
  projectId?: string
): Promise<void> {
  if (!conversationId) return;
  // 1) sub-agent：后端 loop_runs 权威。
  await resumeSubAgentTasks(conversationId, projectId);
  // 2) 主 agent：localStorage resumable task（仅当当前会话无活跃主 run）。
  const primaryTaskId = findResumableAgentTask(conversationId, projectId);
  if (primaryTaskId && !isConversationRunning(conversationId)) {
    resumeConversationRun(primaryTaskId, conversationId, projectId);
  }
}

export function stopSubAgentTask(taskId: string | null | undefined): void {
  if (!taskId) return;
  const current = subTaskRuns.get(taskId);
  if (!current || current.status !== 'running') return;
  const completedAt = Date.now();
  replaceSubTask(taskId, (c) => ({
    ...c,
    status: 'stopped',
    assistantContent: c.assistantContent.trim()
      ? c.assistantContent
      : '后台任务已停止，已完成的部分结论和工具记录已保留。',
    assistantPending: false,
    assistantError: false,
    processingDurationMs: Math.max(0, completedAt - c.startedAt),
    completedAt,
  }));
  if (current.taskId) {
    void cancelAgentTask(current.taskId).catch(() => {});
  }
}

export function clearSubAgentTask(taskId: string | null | undefined): void {
  if (!taskId) return;
  const convId = subTaskRuns.get(taskId)?.conversationId;
  if (subTaskRuns.delete(taskId)) {
    if (convId) subTaskConvListeners.get(convId)?.forEach((listener) => listener());
    emitSubTask(taskId);
  }
}
