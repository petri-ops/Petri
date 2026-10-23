// ============================================================
// agentTeamClient.ts — BLOCK-249（Q4a）多智能体团队 API 客户端
//
// 只消费后端 team 投影（leader/members/counts），不在这里合并本地子任务快照——
// 团队状态的唯一真相在服务端 tasks 投影。
// ============================================================

import { getApiPrefix } from '@/lib/env';
import { getToken } from '@/lib/authClient';

interface TeamStructuredStatus {
  required: boolean;
  ok: boolean;
  errors: string[];
  attempts: number;
}

export interface TeamMember {
  agentId: string;
  role: string | null;
  status: string;
  agentStatus: string | null;
  conversationId: string | null;
  taskHead: string;
  createdAt: string | null;
  finishedAt: string | null;
  error: string | null;
  lastEventAt: string | null;
  structured: TeamStructuredStatus | null;
}

interface TeamLeader {
  agentId: string;
  status: string;
  agentStatus: string | null;
  conversationId: string | null;
  taskHead: string;
  createdAt: string | null;
  finishedAt: string | null;
}

export interface AgentTeamView {
  ok: true;
  leader: TeamLeader;
  /** 面板原本打开的成员（子代理视角上溯到 leader 时存在）。 */
  viewedFrom?: string;
  members: TeamMember[];
  counts: { total: number; running: number; finished: number; structuredInvalid: number };
  journalAvailable: boolean;
}

type StopOutcome = 'cancel_requested' | 'already_finished' | 'not_cancelled';

export interface AgentTeamStopReceipt {
  ok: true;
  leader: { agentId: string; outcome: StopOutcome };
  members: Array<{ agentId: string; outcome: StopOutcome; status: string; agentStatus: string | null }>;
  summary: { requested: number; alreadyFinished: number; notCancelled: number };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiPrefix()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(init && init.body ? { 'content-type': 'application/json' } : {}),
      ...(init && init.headers ? init.headers : {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as (T & { ok?: boolean; error?: unknown }) | null;
  if (!response.ok || !payload || payload.ok !== true) {
    const code = payload && typeof payload.error === 'string' ? payload.error : `http_${response.status}`;
    throw new Error(code);
  }
  return payload;
}

export function fetchAgentTeam(taskId: string): Promise<AgentTeamView> {
  return requestJson<AgentTeamView>(`/ai/agent/team?taskId=${encodeURIComponent(taskId)}`);
}

export function stopAgentTeam(taskId: string): Promise<AgentTeamStopReceipt> {
  return requestJson<AgentTeamStopReceipt>(`/ai/agent/team/${encodeURIComponent(taskId)}/stop`, { method: 'POST' });
}

export function pauseAgentTask(taskId: string): Promise<{ ok: true; agentStatus: string; effective: string }> {
  return requestJson(`/ai/agent/task/${encodeURIComponent(taskId)}/pause`, { method: 'POST' });
}

export function resumeAgentTask(taskId: string): Promise<{ ok: true; agentStatus: string }> {
  return requestJson(`/ai/agent/task/${encodeURIComponent(taskId)}/resume`, { method: 'POST' });
}
