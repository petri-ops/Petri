import { getApiPrefix } from '@/components/copilot/copilotClient';

export type WorkflowRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowRunSummary {
  runId: string;
  status: WorkflowRunStatus;
  name?: string;
  createdAt: string;
  finishedAt: string | null;
}

interface WorkflowBudget {
  maxAgents: number;
  maxSteps: number;
  timeoutMs: number;
}

interface WorkflowRunMeta {
  name?: string;
  version?: number;
  budget?: WorkflowBudget;
  concurrency?: number;
}

export interface WorkflowJournalLine {
  seq?: number;
  stepKey?: string;
  kind?: string;
  label?: string;
  status?: string;
  agentId?: string;
  errorHead?: string;
  summaryHead?: string;
  text?: string;
  reusedFrom?: string;
}

export interface WorkflowRunDetail {
  run: {
    runId: string;
    status: WorkflowRunStatus;
    meta: WorkflowRunMeta;
    scriptHash: string;
    argsHash: string;
    resumeFromRunId: string | null;
    error: string | null;
    createdAt: string;
    finishedAt: string | null;
  };
  journalTail: WorkflowJournalLine[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiPrefix()}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
    signal: init?.signal || AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => null)) as (T & { ok?: boolean; error?: string; message?: string }) | null;
  if (!response.ok || !data || data.ok === false) {
    throw new Error((data && (data.message || data.error)) || `请求失败（HTTP ${response.status}）`);
  }
  return data;
}

export async function fetchWorkflowRuns(limit = 20): Promise<WorkflowRunSummary[]> {
  const data = await request<{ ok: true; runs: WorkflowRunSummary[] }>(`/ai/agent/workflow/runs?limit=${limit}`);
  return data.runs;
}

export function fetchWorkflowRun(runId: string): Promise<WorkflowRunDetail> {
  return request<WorkflowRunDetail & { ok: true }>(`/ai/agent/workflow/runs/${encodeURIComponent(runId)}`);
}

export function cancelWorkflowRun(runId: string): Promise<{ ok: true; cancelled: boolean; mode: string }> {
  return request(`/ai/agent/workflow/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
}

export function resumeWorkflowRun(runId: string): Promise<{ ok: true; runId: string; taskId?: string | null; status: string }> {
  return request(`/ai/agent/workflow/runs/${encodeURIComponent(runId)}/resume`, { method: 'POST' });
}
