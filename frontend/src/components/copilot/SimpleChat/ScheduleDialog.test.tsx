// BLOCK-256 Q7 — `/schedule` 对话框：标题/间隔提交，项目隔离失败可见。
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

const createSchedule = vi.hoisted(() => vi.fn());
const fetchAutomation = vi.hoisted(() => vi.fn());
const fetchAutoToolNames = vi.hoisted(() => vi.fn());
vi.mock('@/lib/automationClient', () => ({ createSchedule, fetchAutomation, fetchAutoToolNames }));

import { ScheduleDialog } from './ScheduleDialog';

beforeEach(() => {
  vi.clearAllMocks();
  createSchedule.mockResolvedValue({ ok: true, schedule: { id: 'sch_1' } });
});
afterEach(cleanup);

describe('ScheduleDialog', () => {
  it('提交当前 prompt + 标题 + 间隔，成功后回调', async () => {
    const onCreated = vi.fn();
    const { getByTestId, getByLabelText } = render(
      <ScheduleDialog open projectId="proj_1" prompt="汇总今天的数据" onClose={vi.fn()} onCreated={onCreated} />,
    );
    fireEvent.change(getByLabelText('标题'), { target: { value: '每日汇总' } });
    fireEvent.change(getByLabelText('间隔（分钟）'), { target: { value: '120' } });
    fireEvent.click(getByTestId('schedule-dialog-submit'));
    await waitFor(() => expect(createSchedule).toHaveBeenCalledWith({
      projectId: 'proj_1',
      title: '每日汇总',
      prompt: '汇总今天的数据',
      intervalMinutes: 120,
    }));
    expect(onCreated).toHaveBeenCalledWith('每日汇总');
  });

  it('无项目时拒绝提交并提示', async () => {
    const { getByTestId, getByText } = render(
      <ScheduleDialog open prompt="x" onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    fireEvent.click(getByTestId('schedule-dialog-submit'));
    await waitFor(() => expect(getByText('请先选择项目：定时计划按项目隔离。')).toBeTruthy());
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it('关闭时不渲染', () => {
    const { queryByTestId } = render(
      <ScheduleDialog open={false} prompt="x" onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    expect(queryByTestId('schedule-dialog')).toBeNull();
  });

  // BLOCK-516 — 唤醒预授权折起区：trusted 勾选 → goal 下拉（带预算 active）+ 白名单勾选
  // → 提交携 autoMode/autoToolAllowlist/goalId；不勾选则提交不携带这些字段。
  it('trusted 预授权：勾选后提交携 autoMode/白名单/goalId', async () => {
    fetchAutomation.mockResolvedValue({
      ok: true,
      goals: [
        { id: 'goal_budget', title: '带预算目标', status: 'active', budgetTokens: 5000, budgetLimited: false },
        { id: 'goal_nobudget', title: '无预算目标', status: 'active', budgetTokens: 0, budgetLimited: false },
        { id: 'goal_paused', title: '暂停目标', status: 'paused', budgetTokens: 5000, budgetLimited: false },
      ],
      schedules: [], runs: [], reminders: [],
    });
    fetchAutoToolNames.mockResolvedValue({ ok: true, names: ['read_file', 'web_fetch', 'exec'] });
    const onCreated = vi.fn();
    const { getByTestId, getByText } = render(
      <ScheduleDialog open projectId="proj_1" prompt="汇总今天的数据" onClose={vi.fn()} onCreated={onCreated} />,
    );
    // 折起区默认收起：展开后勾选 trusted
    fireEvent.click(getByTestId('schedule-dialog-trusted-fold').querySelector('summary') as HTMLElement);
    fireEvent.click(getByTestId('schedule-dialog-trusted'));
    // goal 下拉只列带预算 active（过滤无预算与暂停）
    await waitFor(() => expect(fetchAutomation).toHaveBeenCalled());
    const goalSelect = getByTestId('schedule-dialog-goal') as HTMLSelectElement;
    await waitFor(() => {
      const optionTexts = [...goalSelect.options].map((o) => o.textContent || '');
      expect(optionTexts.some((t) => t.includes('带预算目标'))).toBe(true);
      expect(optionTexts.some((t) => t.includes('无预算目标'))).toBe(false);
    });
    fireEvent.change(goalSelect, { target: { value: 'goal_budget' } });
    // 白名单勾选 read_file（不勾 exec）
    fireEvent.click(getByText('read_file'));
    fireEvent.click(getByTestId('schedule-dialog-submit'));
    await waitFor(() => expect(createSchedule).toHaveBeenCalled());
    const arg = createSchedule.mock.calls[0][0];
    expect(arg.autoMode).toBe('trusted');
    expect(arg.autoToolAllowlist).toEqual(['read_file']);
    expect(arg.goalId).toBe('goal_budget');
    expect(onCreated).toHaveBeenCalled();
  });

  it('不勾选 trusted 时提交不携带预授权字段', async () => {
    const onCreated = vi.fn();
    const { getByTestId } = render(
      <ScheduleDialog open projectId="proj_1" prompt="汇总" onClose={vi.fn()} onCreated={onCreated} />,
    );
    fireEvent.click(getByTestId('schedule-dialog-submit'));
    await waitFor(() => expect(createSchedule).toHaveBeenCalled());
    const arg = createSchedule.mock.calls[0][0];
    expect(arg.autoMode).toBeUndefined();
    expect(arg.autoToolAllowlist).toBeUndefined();
  });
});
