// ============================================================
// Client for /api/ai/plans — persistent task plans
// ============================================================

import { getApiPrefix } from './copilotClient';

function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const token = localStorage.getItem('biof3_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export type PlanStatus = 'active' | 'paused' | 'completed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface PlanStep {
  plan_id: string;
  n: number;
  title: string;
  hint?: string;
  status: StepStatus;
  result?: string;
  ts: string;
}

export interface PlanSummary {
  id: string;
  title: string;
  goal?: string;
  chat_context_excerpt?: string;
  status: PlanStatus;
  total_steps: number;
  done_steps: number;
  created_at: string;
  updated_at: string;
}

export interface PlanDetail extends PlanSummary {
  steps: PlanStep[];
}

export async function listPlans(): Promise<PlanSummary[] | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/plans', { headers: getAuthHeader() });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.status === 'ok' ? data.plans || [] : null;
  } catch {
    return null;
  }
}

export async function getPlan(id: string): Promise<PlanDetail | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/plans/' + encodeURIComponent(id), {
      headers: getAuthHeader(),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.status === 'ok' ? data.plan : null;
  } catch {
    return null;
  }
}

export async function setPlanStatus(id: string, status: PlanStatus): Promise<boolean> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/plans/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ status }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function deletePlan(id: string): Promise<boolean> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/plans/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: getAuthHeader(),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** PLAN_STEP_USER_UPDATE_v1 — user marks a step done/skipped from chat UI. */
export async function updateStepStatus(
  planId: string,
  stepN: number,
  status: StepStatus,
  result?: string
): Promise<{ ok: boolean; allDone?: boolean }> {
  try {
    const resp = await fetch(
      getApiPrefix() + '/ai/plans/' + encodeURIComponent(planId) + '/steps/' + stepN,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(result ? { status, result } : { status }),
      }
    );
    if (!resp.ok) return { ok: false };
    const data = await resp.json();
    return { ok: data.status === 'ok', allDone: !!data.allDone };
  } catch {
    return { ok: false };
  }
}
