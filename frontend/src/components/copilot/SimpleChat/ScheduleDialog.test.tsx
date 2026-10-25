// BLOCK-256 Q7 — `/schedule` 对话框：标题/间隔提交，项目隔离失败可见。
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

const createSchedule = vi.hoisted(() => vi.fn());
vi.mock('@/lib/automationClient', () => ({ createSchedule }));

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
});
