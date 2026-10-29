/**
 * automationClient.ts — Q7（BLOCK-256）目标与定时任务 REST 封装。
 *
 * 单一真相在 `/api/automation`（store 从真实 ai_usage 投影 goal 用量）；
 * 前端只做展示与动作，不在本地维护第二份目标/计划状态。
 */

import { getApiPrefix } from '@/components/copilot/copilotClient';

export type GoalStatus = 'active' | 'paused' | 'completed' | 'blocked';
export type ScheduleKind = 'task' | 'reminder' | 'workflow';
type ScheduleRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'reminder' | 'skipped_budget' | 'skipped_goal';

export interface AutomationGoal {
  id: string;
  project_id: string;
  conversation_id: string | null;
  title: string;
  description: string | null;
  status: GoalStatus;
  budget_tokens: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  usageTokens: number;
  budgetTokens: number;
  usagePct: number;
  remainingTokens: number | null;
  usageLimited: boolean;
  budgetLimited: boolean;
  elapsedMs: number;
}

export interface AutomationRun {
  id: string;
  schedule_id: string;
  schedule_title?: string;
  schedule_kind?: ScheduleKind;
  task_id: string | null;
  conversation_id: string | null;
  workflow_run_id?: string | null;
  status: ScheduleRunStatus;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface AutomationSchedule {
  id: string;
  project_id: string;
  goal_id: string | null;
  title: string;
  prompt: string;
  kind: ScheduleKind;
  interval_minutes: number;
  reminder_text: string | null;
  hasWorkflowScript?: boolean;
  hasWorkflowArgs?: boolean;
  enabled: boolean;
  next_run_at: string;
  last_run_at: string | null;
  goal: { id: string; title: string; status: GoalStatus; budgetLimited: boolean; usageLimited: boolean } | null;
  lastRun: AutomationRun | null;
}

export interface AutomationReminder {
  id: string;
  schedule_id: string;
  project_id: string;
  message: string;
  due_at: string;
  acknowledged_at: string | null;
}

export interface AutomationSnapshot {
  ok: true;
  schedules: AutomationSchedule[];
  goals: AutomationGoal[];
  runs: AutomationRun[];
  reminders: AutomationReminder[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiPrefix()}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = (await response.json().catch(() => null)) as (T & { ok?: boolean; error?: string; message?: string }) | null;
  if (!response.ok || !data || data.ok === false) {
    throw new Error((data && (data.message || data.error)) || `请求失败（HTTP ${response.status}）`);
  }
  return data;
}

export function fetchAutomation(projectId: string): Promise<AutomationSnapshot> {
  return request<AutomationSnapshot>(`/automation?projectId=${encodeURIComponent(projectId)}`);
}

export function createSchedule(input: {
  projectId: string;
  title?: string;
  prompt?: string;
  kind?: ScheduleKind;
  intervalMinutes?: number;
  reminderText?: string;
  workflowScript?: string;
  workflowArgs?: Record<string, unknown> | null;
  goalId?: string | null;
  enabled?: boolean;
}): Promise<{ ok: true; schedule: AutomationSchedule }> {
  return request(`/schedules`, {
    method: 'POST',
    body: JSON.stringify({
      projectId: input.projectId,
      title: input.title,
      prompt: input.prompt,
      kind: input.kind,
      intervalMinutes: input.intervalMinutes,
      reminderText: input.reminderText,
      workflowScript: input.workflowScript,
      workflowArgs: input.workflowArgs ?? null,
      goalId: input.goalId || null,
      enabled: input.enabled !== false,
    }),
  });
}

export function toggleSchedule(id: string, enabled: boolean): Promise<{ ok: true; schedule: AutomationSchedule }> {
  return request(`/schedules/${encodeURIComponent(id)}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}

export function runSchedule(id: string): Promise<{ ok: true; result: { status: string; taskId?: string; error?: string } }> {
  return request(`/schedules/${encodeURIComponent(id)}/run`, { method: 'POST' });
}

export function deleteSchedule(id: string): Promise<{ ok: true }> {
  return request(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function setGoalStatus(id: string, status: GoalStatus): Promise<{ ok: true; goal: AutomationGoal }> {
  return request(`/goals/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export function fetchReminders(projectId?: string): Promise<{ ok: true; reminders: AutomationReminder[] }> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return request(`/schedules/reminders${query}`);
}

export function ackReminder(id: string): Promise<{ ok: true }> {
  return request(`/schedules/reminders/${encodeURIComponent(id)}/ack`, { method: 'POST' });
}
