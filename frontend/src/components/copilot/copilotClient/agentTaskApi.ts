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
  } catch {
    // A1 A 类：响应体解析失败按空 body 降级（只读预览），错误由 resp.ok 分支统一抛出；
    // 预览是 best-effort，不因畸形 body 把「不可续跑」变成整页错误。
  }
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
  } catch {
    // A1 A 类：解析失败保留空 body，下面 !taskId 分支照常抛 HTTP 错误——错误不会静默，
    // 吞掉的只是 JSON 解析异常本身（错误文案由 status / body.error 给出）。
  }
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
  } catch {
    // A1 A 类：重试摘要解析失败落到空 body，下面 !content 分支照常抛错（可感知），
    // 吞掉的只是解析异常；不需要第二套报错路径。
  }
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
    } catch {
      // A1 A 类：取消失败的响应体解析失败时保留 `HTTP <status>` 兜底文案后照常抛错，
      // 吞掉的只是「取更详细错误文案」的解析异常，用户仍看到失败。
    }
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
  } catch (error) {
    // A1 B 类：确认按钮点了没反应是用户可感知失败。renderer 无 error-log 模块，
    // 复用既有 renderer console 链带 reasonCode 留痕（主窗 console-message 捕获），
    // 保持返回 false 的 fail-soft 契约不改调用方语义。
    console.error('[A1][reasonCode=A1_ACK_SUBMIT_FAILED] 重操作确认提交失败', error);
    return false;
  }
}
