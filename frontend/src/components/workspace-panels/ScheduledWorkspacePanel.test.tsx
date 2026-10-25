// BLOCK-256 Q7 — 自动化看板：数据展示、创建、立即运行、goal 状态、提醒确认。
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

const client = vi.hoisted(() => ({
  fetchAutomation: vi.fn(),
  createSchedule: vi.fn(),
  toggleSchedule: vi.fn(),
  runSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  setGoalStatus: vi.fn(),
  ackReminder: vi.fn(),
}));

vi.mock('@/lib/automationClient', () => client);

import { ScheduledWorkspacePanel } from './ScheduledWorkspacePanel';

const snapshot = {
  ok: true as const,
  schedules: [{
    id: 'sch_1',
    project_id: 'proj_1',
    goal_id: 'goal_1',
    title: '每日质控',
    prompt: '汇总质控结果',
    kind: 'task' as const,
    interval_minutes: 60,
    reminder_text: null,
    enabled: true,
    next_run_at: '2026-10-25T10:00:00.000Z',
    last_run_at: null,
    goal: { id: 'goal_1', title: '稳定交付', status: 'active' as const, budgetLimited: false, usageLimited: false },
    lastRun: null,
  }],
  goals: [{
    id: 'goal_1',
    project_id: 'proj_1',
    conversation_id: 'conv_1',
    title: '稳定交付',
    description: '把 Q7 收口',
    status: 'active' as const,
    budget_tokens: 1000,
    created_at: '2026-10-25T00:00:00.000Z',
    updated_at: '2026-10-25T00:00:00.000Z',
    completed_at: null,
    usageTokens: 820,
    budgetTokens: 1000,
    usagePct: 0.82,
    remainingTokens: 180,
    usageLimited: true,
    budgetLimited: false,
    elapsedMs: 3_600_000,
  }],
  runs: [{
    id: 'run_1',
    schedule_id: 'sch_1',
    schedule_title: '每日质控',
    task_id: 'task_1',
    conversation_id: 'conv_run',
    status: 'completed' as const,
    error: null,
    started_at: '2026-10-25T09:00:00.000Z',
    finished_at: '2026-10-25T09:01:00.000Z',
  }],
  reminders: [{
    id: 'rem_1',
    schedule_id: 'sch_1',
    project_id: 'proj_1',
    message: '记得看质控',
    due_at: '2026-10-25T09:30:00.000Z',
    acknowledged_at: null,
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  client.fetchAutomation.mockResolvedValue(snapshot);
  client.createSchedule.mockResolvedValue({ ok: true, schedule: snapshot.schedules[0] });
  client.toggleSchedule.mockResolvedValue({ ok: true, schedule: snapshot.schedules[0] });
  client.runSchedule.mockResolvedValue({ ok: true, result: { status: 'running', taskId: 'task_2' } });
  client.deleteSchedule.mockResolvedValue({ ok: true });
  client.setGoalStatus.mockResolvedValue({ ok: true, goal: snapshot.goals[0] });
  client.ackReminder.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe('ScheduledWorkspacePanel', () => {
  it('展示 schedule/run/goal/reminder，并允许立即运行与目标暂停', async () => {
    const onBack = vi.fn();
    const onOpenConversation = vi.fn();
    const { getByTestId, getByText, getAllByText } = render(
      <ScheduledWorkspacePanel projectId="proj_1" onBackToChat={onBack} onOpenConversation={onOpenConversation} />,
    );
    await waitFor(() => expect(getByTestId('automation-schedule-sch_1')).toBeTruthy());
    expect(getAllByText('每日质控').length).toBeGreaterThan(0);
    expect(getAllByText('稳定交付').length).toBeGreaterThan(0);
    expect(getByText('记得看质控')).toBeTruthy();
    expect(getAllByText('完成').length).toBeGreaterThan(0);

    fireEvent.click(getByText('立即运行'));
    await waitFor(() => expect(client.runSchedule).toHaveBeenCalledWith('sch_1'));

    const goalCard = getByTestId('automation-goal-goal_1');
    fireEvent.click(goalCard.querySelector('button') as HTMLButtonElement);
    await waitFor(() => expect(client.setGoalStatus).toHaveBeenCalledWith('goal_1', 'paused'));

    fireEvent.click(getByText('确认'));
    await waitFor(() => expect(client.ackReminder).toHaveBeenCalledWith('rem_1'));
    fireEvent.click(getByText('打开会话'));
    expect(onOpenConversation).toHaveBeenCalledWith('conv_run');
  });

  it('创建表单提交项目/标题/间隔/prompt', async () => {
    const { getByText, getByPlaceholderText } = render(
      <ScheduledWorkspacePanel projectId="proj_1" onBackToChat={vi.fn()} />,
    );
    await waitFor(() => expect(getByText('新建')).toBeTruthy());
    fireEvent.click(getByText('新建'));
    fireEvent.change(getByPlaceholderText('例如：每日质控汇总'), { target: { value: '每日汇总' } });
    fireEvent.change(getByPlaceholderText('到点后交给 agent 的完整指令'), { target: { value: '汇总结果' } });
    fireEvent.click(getByText('创建'));
    await waitFor(() => expect(client.createSchedule).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj_1',
      title: '每日汇总',
      prompt: '汇总结果',
      kind: 'task',
    })));
  });

  it('无项目时显示隔离提示，不请求数据', () => {
    client.fetchAutomation.mockClear();
    const { getByText } = render(<ScheduledWorkspacePanel onBackToChat={vi.fn()} />);
    expect(getByText('请先选择项目：定时任务与目标按项目隔离。')).toBeTruthy();
    expect(client.fetchAutomation).not.toHaveBeenCalled();
  });
});
