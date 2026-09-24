// ============================================================
// Agent task REST 面：中断续跑预览/执行、任务概览/留言/续派、
// 取消、act 与 run_tool 确认回执。
// ============================================================

import { unknownText } from '@/lib/unknownText';
import { getApiPrefix, getAuthHeader } from './apiBase';
import { ensureOnlineOrThrow } from './offline';

/**
 * Agent task REST 信封 wire 形状（BLOCK-105 §7 Batch-5 类型化；JSON 解析出站边界契约文档）。
 * 字段 unknown＝后端可能发任意 JSON，运行时防御式解构保持原样。
 */
type AgentApiEnvelope = {
  ok?: unknown;
  message?: string;
  error?: string;
  taskId?: string;
  resumeOfTaskId?: string;
  agentId?: string;
  followupOf?: string;
  note?: string;
  [key: string]: unknown;
} | null;

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
    body = (await resp.json()) as Record<string, unknown>;
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
    body = (await resp.json()) as Record<string, unknown>;
  } catch {}
  if (!resp.ok || !body.taskId) {
    throw new Error(String((body as { error?: string }).error || `HTTP ${resp.status}`));
  }
  return {
    taskId: unknownText(body.taskId),
    conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
    resumeOfTaskId: unknownText(body.resumeOfTaskId || taskId),
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
    body = (await resp.json()) as typeof body;
  } catch {}
  if (!resp.ok || !body.content) {
    throw new Error(body.error || body.message || `HTTP ${resp.status}`);
  }
  return body.content;
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
      const body = (await resp.json()) as AgentApiEnvelope;
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
  /** BLOCK-93 P2 — spawn 显式角色（agent-roles 注册表 key；未指定不带此字段） */
  role?: string;
}

export interface AgentTaskOverviewItem extends AgentTaskMeta {
  spawnSource: string | null;
  error: string | null;
  /** BLOCK-65 修正：会话归属项目（俯瞰面板按项目隔离） */
  projectId: string | null;
  /** BLOCK-88 P2（D3）：联邦委托任务访客工程师署名（「来自工程师 X」标记） */
  federatedFrom?: string | null;
}

/** GET /ai/agent/tasks — 用户最近子 agent（跨会话，俯瞰面板数据源） */
export async function listAgentTasks(limit = 50): Promise<AgentTaskOverviewItem[]> {
  const resp = await fetch(`${getApiPrefix()}/ai/agent/tasks?limit=${encodeURIComponent(String(limit))}`, {
    headers: { ...getAuthHeader() },
  });
  const body = (await resp.json().catch(() => null)) as AgentApiEnvelope;
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
  const body = (await resp.json().catch(() => null)) as AgentApiEnvelope;
  if (!resp.ok || body?.ok !== true) {
    throw new Error(String(body?.message || body?.error || `HTTP ${resp.status}`));
  }
  return body as unknown as AgentTaskMeta;
}

/** POST /ai/agent/task/:id/message — 留言（队列语义：续派时注入） */
export async function sendAgentTaskMessage(taskId: string, message: string): Promise<{ queued: boolean; note: string }> {
  const resp = await fetch(`${getApiPrefix()}/ai/agent/task/${encodeURIComponent(taskId)}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ message }),
  });
  const body = (await resp.json().catch(() => null)) as AgentApiEnvelope;
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
  const body = (await resp.json().catch(() => null)) as AgentApiEnvelope;
  if (!resp.ok || body?.ok !== true) {
    throw new Error(String(body?.message || body?.error || `HTTP ${resp.status}`));
  }
  return { agentId: String(body.agentId), followupOf: String(body.followupOf || taskId) };
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
