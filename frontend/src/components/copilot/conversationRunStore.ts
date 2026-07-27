import { useCallback, useSyncExternalStore } from 'react';
import type { CopilotContext } from '@/lib/copilotContext';
import { biof3Events, dispatchBioF3Event } from '@/lib/events';
import {
  cancelAgentTask,
  streamChat,
  type ChatMessage,
  type ToolCallEvent,
  type ToolResultEvent,
  type ResultEditProgressEvent,
} from './copilotClient';
import {
  mergeToolCallActivity,
  mergeToolResultActivity,
  type ToolActivityItem,
} from './toolActivity';
import type { LoopPhaseEvent, LoopIterationEvent } from '@/lib/loop-client';

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
  });
  emit(conversationId);

  const finish = (status: 'done' | 'error', error?: Error) => {
    if (runs.get(conversationId)?.status !== 'running') return;
    const completedAt = Date.now();
    replaceRun(conversationId, (current) => ({
      ...current,
      status,
      assistantContent: error
        ? `⚠️ ${error.message || '请求失败'}`
        : current.assistantContent,
      assistantPending: false,
      assistantError: status === 'error',
      statusMessage: undefined,
      processingDurationMs: Math.max(0, completedAt - current.startedAt),
      completedAt,
    }));
  };

  void streamChat({
    messages: options.messages,
    context: options.context,
    conversationId,
    modelPresetId: options.modelPresetId,
    modelName: options.modelName,
    signal: ctrl.signal,
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
  }).finally(() => {
    if (controllers.get(conversationId) === ctrl) controllers.delete(conversationId);
  });

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
}
