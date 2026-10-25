// BLOCK-261 K3 — 退出摘要逐项停止：动作可见、忙态、失败原因可见、结果随新摘要复位。
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuitSummaryDialog, type QuitSummaryItem, type QuitSummaryRequest } from './QuitSummaryDialog';

afterEach(cleanup);

const items: QuitSummaryItem[] = [
  { kind: 'toolJob', id: 'job_1', label: '运行中的差异分析', status: 'running', projectId: 'p1' },
  { kind: 'task', id: 'task_1', label: '正在跑的主任务', status: 'running' },
  { kind: 'approval', id: 'ap_1', label: '审批：run_tool', status: 'pending', taskId: 'task_1' },
  { kind: 'approval', id: 'ap_2', label: '审批：write_file', status: 'pending' },
];

function request(overrides: Partial<QuitSummaryRequest> = {}): QuitSummaryRequest {
  return {
    counts: { toolJobsRunning: 1, primaryTasks: 1, approvalsPending: 2 },
    total: 4,
    rows: [{ key: 'toolJobsRunning', label: '运行中的工具作业', value: 1 }],
    items,
    fetchedAt: '2026-10-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('QuitSummaryDialog 逐项停止', () => {
  it('四类项各自的动作文案；无所属任务的审批给禁用钮与原因', () => {
    render(
      <QuitSummaryDialog
        request={request()}
        onDecision={() => {}}
        onStopItem={() => Promise.resolve({ ok: true, message: 'ok' })}
      />,
    );
    expect(screen.getByTestId('quit-summary-stop-job_1').textContent).toBe('取消');
    expect(screen.getByTestId('quit-summary-stop-task_1').textContent).toBe('停止');
    expect(screen.getByTestId('quit-summary-stop-ap_1').textContent).toBe('停止该任务');
    const bare = screen.getByTestId('quit-summary-stop-ap_2');
    expect(bare.hasAttribute('disabled')).toBe(true);
    expect(bare.getAttribute('title')).toContain('审批卡');
    expect(screen.getByTestId('quit-summary-stop-result-ap_2').textContent).toContain('审批卡');
  });

  it('点击→忙态→成功结果文案可见（不预设已停成）', async () => {
    let resolve!: (value: { ok: boolean; message: string; reason?: string }) => void;
    const promise = new Promise<{ ok: boolean; message: string; reason?: string }>((r) => { resolve = r; });
    const onStopItem = vi.fn(() => promise);
    render(<QuitSummaryDialog request={request()} onDecision={() => {}} onStopItem={onStopItem} />);

    fireEvent.click(screen.getByTestId('quit-summary-stop-job_1'));
    expect(onStopItem).toHaveBeenCalledWith(expect.objectContaining({ kind: 'toolJob', id: 'job_1' }));
    expect(screen.getByTestId('quit-summary-stop-job_1').textContent).toBe('处理中…');

    resolve({ ok: true, reason: 'cancelled', message: '已取消。' });
    await waitFor(() => expect(screen.getByTestId('quit-summary-stop-result-job_1').textContent).toBe('已取消。'));
    expect(screen.getByTestId('quit-summary-stop-job_1').textContent).toBe('取消');
  });

  it('失败原因可见且带错误样式；再次点击可重试', async () => {
    const onStopItem = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'execution_owner_unavailable', message: '后端未能证明该作业的进程归属，已拒绝强制终止。' })
      .mockResolvedValueOnce({ ok: true, reason: 'cancelled', message: '已取消。' });
    render(<QuitSummaryDialog request={request()} onDecision={() => {}} onStopItem={onStopItem} />);

    fireEvent.click(screen.getByTestId('quit-summary-stop-task_1'));
    await waitFor(() => expect(screen.getByTestId('quit-summary-stop-result-task_1').textContent).toContain('拒绝强制终止'));
    expect(screen.getByTestId('quit-summary-stop-result-task_1').className).toContain('itemError');

    fireEvent.click(screen.getByTestId('quit-summary-stop-task_1'));
    await waitFor(() => expect(screen.getByTestId('quit-summary-stop-result-task_1').textContent).toBe('已取消。'));
    expect(onStopItem).toHaveBeenCalledTimes(2);
  });

  it('动作 Promise  reject 时也出可见原因（不静默）', async () => {
    const onStopItem = vi.fn(() => Promise.reject(new Error('boom')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<QuitSummaryDialog request={request()} onDecision={() => {}} onStopItem={onStopItem} />);
    fireEvent.click(screen.getByTestId('quit-summary-stop-task_1'));
    await waitFor(() => expect(screen.getByTestId('quit-summary-stop-result-task_1').textContent).toContain('未能发出'));
  });

  it('新摘要到达（再次退出请求）时清空旧动作态，避免旧结果误导', async () => {
    const onStopItem = vi.fn(() => Promise.resolve({ ok: true, reason: 'cancelled', message: '已取消。' }));
    const { rerender } = render(
      <QuitSummaryDialog request={request()} summaryVersion={1} onDecision={() => {}} onStopItem={onStopItem} />,
    );
    fireEvent.click(screen.getByTestId('quit-summary-stop-job_1'));
    await waitFor(() => expect(screen.getByTestId('quit-summary-stop-result-job_1').textContent).toBe('已取消。'));

    rerender(
      <QuitSummaryDialog
        request={request({ fetchedAt: '2026-10-25T00:01:00.000Z' })}
        summaryVersion={2}
        onDecision={() => {}}
        onStopItem={onStopItem}
      />,
    );
    expect(screen.getByTestId('quit-summary-stop-result-job_1').textContent).toBe('running');
  });

  it('未提供 onStopItem 时不渲染动作钮（旧宿主行为不变）', () => {
    render(<QuitSummaryDialog request={request()} onDecision={() => {}} onOpenItem={() => {}} />);
    expect(screen.queryByTestId('quit-summary-stop-job_1')).toBeNull();
    expect(screen.getByTestId('quit-summary-open-job_1')).not.toBeNull();
  });
});
