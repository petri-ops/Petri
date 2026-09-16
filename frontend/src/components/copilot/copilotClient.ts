// ============================================================
// Copilot streaming chat client — talks to /api/ai/chat (SSE)
// BLOCK-92 家法：原 import 路径保留全量 re-export（消费方与测试零改动），
// 实现分布在 copilotClient/ 子模块：apiBase / offline / types / parse /
// agentTaskApi（REST 面）/ agentTaskStream（订阅+重连+SSE 分发）。
// 本文件保留：streamChat 编排（task 模式提交→订阅，legacy 回退）与
// localStorage 断线恢复扫描。
// ============================================================

import { getApiPrefix, getAuthHeader } from './copilotClient/apiBase';
import { ensureOnlineOrThrow } from './copilotClient/offline';
import { streamChatLegacy, subscribeAgentTask } from './copilotClient/agentTaskStream';
import type { StreamChatOptions } from './copilotClient/types';

// ---- re-export surface（原 ./copilotClient 全量公开 API）----

export { getApiPrefix, getAuthHeader } from './copilotClient/apiBase';
export { OfflineError, checkOnline, isOfflineError } from './copilotClient/offline';
export type {
  ChatMessage,
  ResultEditProgressEvent,
  StreamChatOptions,
  ToolCallEvent,
  ToolOutputEvent,
  ToolResultEvent,
  ToolSideEffects,
  StructuredToolResult,
} from './copilotClient/types';
export {
  parseResultEditProgressEvent,
  parseToolCallEvent,
  parseToolOutputEvent,
  parseToolResultEvent,
  restoreResultEditProgressEvents,
} from './copilotClient/parse';
export type {
  AgentTaskMeta,
  AgentTaskOverviewItem,
  ResumeLastModelCall,
} from './copilotClient/agentTaskApi';
export {
  ackAct,
  ackRunTool,
  cancelAgentTask,
  fetchAgentTaskMeta,
  followupAgentTask,
  listAgentTasks,
  previewAgentTaskResume,
  resumeAgentTask,
  retryToolSummary,
  sendAgentTaskMessage,
} from './copilotClient/agentTaskApi';
export { AgentStreamDisconnectedError, subscribeAgentTask } from './copilotClient/agentTaskStream';

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

/** POST /ai/agent 提交，返回 taskId */
async function submitAgentTask(opts: StreamChatOptions): Promise<string> {
  const { messages, context, conversationId, modelPresetId, modelName, kind, parentTaskId, thinkingLevel, signal } = opts;
  // M2-5: 提交前先探测网络，离线时直接抛 OfflineError，避免裸 fetch 报错
  await ensureOnlineOrThrow();
  const resp = await fetch(getApiPrefix() + '/ai/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ messages, context, conversationId, modelPresetId, modelName, kind, parentTaskId, thinkingLevel }),
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
