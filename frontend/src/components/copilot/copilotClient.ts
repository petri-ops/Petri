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
import { subscribeAgentTask } from './copilotClient/agentTaskStream';
import type { StreamChatOptions } from './copilotClient/types';

// ---- re-export surface（原 ./copilotClient 全量公开 API）----

export { getApiPrefix, getAuthHeader } from './copilotClient/apiBase';
export type {
  AgentTaskTodoItem,
  KnowledgeCitation,
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
  parseToolResultEvent,
  restoreResultEditProgressEvents,
} from './copilotClient/parse';
export type {
  AgentTaskMeta,
  AgentTaskOverviewItem,
  ResumeLastModelCall,
} from './copilotClient/agentTaskApi';
export {
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
 * AGENT_TASK_MODE_v1 → BLOCK-109-CORE-ARCH P1（D4）：task 模式是唯一路径
 * （POST 提交拿 taskId → GET 订阅事件流，支持断线重连）；legacy 直连 SSE
 * （VITE_AGENT_TASK_MODE=legacy / ?legacy=1）已随后端双轨退役。
 */
export async function streamChat(opts: StreamChatOptions): Promise<void> {
  return streamChatViaTask(opts);
}

/**
 * BLOCK-109-CORE-ARCH P1.2 — 在途主任务查询（恢复的单一后端源）。
 * 取代原 localStorage petri_agent_task_* 扫描双轨：tasks.status='running' 即权威
 * 在途真相（后端重启由 sweepInterruptedRunningTasks 清扫），无 TTL 猜测。
 * 返回该会话（可选过滤）在途主任务 taskId，新→旧排序。
 */
export async function fetchInFlightPrimaryTasks(conversationId: string): Promise<string[]> {
  const url = `${getApiPrefix()}/ai/agent/tasks/inflight${
    conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''
  }`;
  const resp = await fetch(url, { headers: { ...getAuthHeader() } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json().catch(() => null)) as { tasks?: Array<{ taskId?: string }> } | null;
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  return tasks.map((t) => String(t.taskId || '')).filter(Boolean);
}

/** task 模式：提交拿 taskId → 订阅事件流（P1.4 起唯一路径） */
async function streamChatViaTask(opts: StreamChatOptions): Promise<void> {
  let taskId: string;
  try {
    taskId = await submitAgentTask(opts);
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') return;
    // P1.4：legacy 提交失败回退已退役（后端 410）——提交失败如实上报
    opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    return;
  }
  opts.onTaskStarted?.(taskId);
  // P1.2：原 localStorage 在途标记（petri_agent_task_*）已退役——恢复改问后端
  // /ai/agent/tasks/inflight（status='running' 即权威，见 fetchInFlightPrimaryTasks）。
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
      const j = (await resp.json()) as { message?: string; error?: string } | null;
      errText = j?.message ? `${j.error || errText}: ${j.message}` : String(j?.error || errText);
    } catch {}
    throw new Error(errText);
  }
  const data = (await resp.json()) as { taskId?: string } | null;
  if (!data?.taskId) throw new Error('未返回 taskId');
  return data.taskId;
}
