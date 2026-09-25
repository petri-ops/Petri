// ===========================================================================
// AGENT-CONCURRENCY: parallel sub-agent task subsystem.
// Each sub-agent streams independently under its own taskId while the primary
// conversation loop is busy, so the user can run extra background work without
// blocking the main thread of the conversation. The primary run path lives in
// conversationRunStore.ts and is intentionally kept separate from this module.
// ===========================================================================
import { useEffect, useState } from 'react';
import type { CopilotContext } from '@/lib/copilotContext';
import {
  cancelAgentTask,
  streamChat,
  subscribeAgentTask,
  type ChatMessage,
} from '../copilotClient';
import {
  mergeToolCallActivity,
  mergeToolOutputActivity,
  mergeToolResultActivity,
} from '../toolActivity';
import { fetchLoopRuns, type LoopRunCompact } from '@/lib/loop-client';
import { formatErrorForUser } from '../errorMessages';
import type { ConversationRunSnapshot, ConversationRunStatus } from './types';

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

/** 模型 spawn_agent 派生：登记 running 快照（面板可见；已存在则跳过）。 */
export function recordModelSubAgent(
  conversationId: string,
  projectId: string | undefined,
  taskId: string,
  userContent: string,
  role?: string,
): void {
  if (!taskId || subTaskRuns.has(taskId)) return;
  const startedAt = Date.now();
  subTaskRuns.set(taskId, {
    conversationId,
    projectId: projectId || '',
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
    parentTaskId: undefined,
    // BLOCK-93 P2 — 显式角色（spawn role；未指定为 undefined → UI 走文本推断兜底）
    agentRole: role || undefined,
  });
  emitSubTask(taskId);
}

/** 子 agent 终态落账（child_finished）：running → 终态；页面刷新后无登记时建终态条目。 */
export function settleModelSubAgent(conversationId: string, projectId: string | undefined, info: { childTaskId: string; status: string; summaryHead: string }): void {
  const statusMap: Record<string, ConversationRunStatus> = {
    completed: 'done',
    failed: 'error',
    cancelled: 'stopped',
  };
  const target = statusMap[info.status] ?? 'done';
  const existing = subTaskRuns.get(info.childTaskId);
  if (existing && existing.status !== 'running') return; // 已终态，幂等
  const completedAt = Date.now();
  const snapshot: ConversationRunSnapshot = existing
    ? {
        ...existing,
        status: target,
        assistantContent: info.summaryHead,
        assistantPending: false,
        assistantError: info.status === 'failed',
        processingDurationMs: Math.max(0, completedAt - existing.startedAt),
        completedAt,
      }
    : {
        conversationId,
        projectId: projectId || '',
        status: target,
        userContent: '(页面刷新前派生的子 agent)',
        userTs: new Date(completedAt).toISOString(),
        assistantContent: info.summaryHead,
        assistantTs: new Date(completedAt).toISOString(),
        assistantPending: false,
        assistantError: info.status === 'failed',
        progressUpdates: [],
        resultEditProgress: [],
        toolActivities: [],
        pendingApproval: null,
        startedAt: completedAt,
        completedAt,
        taskId: info.childTaskId,
      };
  subTaskRuns.set(info.childTaskId, snapshot);
  emitSubTask(info.childTaskId);
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



function subscribeSubAgentTasksForConversation(
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
 * 本函数即唯一子任务恢复源（P1.2 起 localStorage 扫描器已退役，恢复全部问后端）。
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


/** Test-only：清空子 agent 存储（由 __resetConversationRunsForTests 统一调用）。 */
export function __resetSubAgentTaskStoresForTests(): void {
  subTaskRuns.clear();
  subTaskListeners.clear();
  subTaskConvListeners.clear();
}
