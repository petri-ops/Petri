import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowRunsPanel } from './WorkflowRunsPanel';
import {
  cancelWorkflowRun,
  fetchWorkflowRun,
  fetchWorkflowRuns,
  resumeWorkflowRun,
  type WorkflowRunDetail,
  type WorkflowRunStatus,
  type WorkflowRunSummary,
} from '@/lib/workflowClient';

vi.mock('@/lib/workflowClient', () => ({
  fetchWorkflowRuns: vi.fn(),
  fetchWorkflowRun: vi.fn(),
  cancelWorkflowRun: vi.fn(),
  resumeWorkflowRun: vi.fn(),
}));

const runsMock = vi.mocked(fetchWorkflowRuns);
const detailMock = vi.mocked(fetchWorkflowRun);
const cancelMock = vi.mocked(cancelWorkflowRun);
const resumeMock = vi.mocked(resumeWorkflowRun);

const runningRun: WorkflowRunSummary = {
  runId: 'wf-running',
  status: 'running',
  name: '日常审阅',
  createdAt: '2026-10-29T00:00:00.000Z',
  finishedAt: null,
};
const failedRun: WorkflowRunSummary = {
  runId: 'wf-failed',
  status: 'failed',
  name: '失败审阅',
  createdAt: '2026-10-28T00:00:00.000Z',
  finishedAt: '2026-10-28T00:01:00.000Z',
};

function detail(runId: string, status: WorkflowRunStatus): WorkflowRunDetail {
  return {
    run: {
      runId,
      status,
      meta: { name: '审阅', version: 1, budget: { maxAgents: 2, maxSteps: 4, timeoutMs: 60_000 }, concurrency: 1 },
      scriptHash: 'a'.repeat(64),
      argsHash: 'b'.repeat(64),
      resumeFromRunId: null,
      error: null,
      createdAt: '2026-10-29T00:00:00.000Z',
      finishedAt: null,
    },
    journalTail: [
      { seq: 1, stepKey: 'review/agent:1', kind: 'agent', status: 'completed', agentId: 'fa-1', summaryHead: 'ok' },
      { seq: 2, stepKey: 'review', kind: 'phase', label: 'review', status: 'completed' },
    ],
  };
}

beforeEach(() => {
  runsMock.mockResolvedValue([runningRun, failedRun]);
  detailMock.mockImplementation((runId: string) => Promise.resolve(detail(runId, runId === runningRun.runId ? 'running' : 'failed')));
  cancelMock.mockResolvedValue({ ok: true, cancelled: true, mode: 'in_process' });
  resumeMock.mockResolvedValue({ ok: true, runId: 'wf-resumed', status: 'running' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WorkflowRunsPanel (NEXT-01)', () => {
  it('列出运行并自动选中第一条，展示预算与 journal', async () => {
    render(<WorkflowRunsPanel />);
    await waitFor(() => expect(screen.getAllByTestId('workflow-run-item')).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId('workflow-run-detail').textContent).toContain('2 agents · 4 steps · 60s'));
    expect(screen.getByTestId('workflow-run-detail').textContent).toContain('agent 行 1');
    expect(screen.getAllByTestId('workflow-journal-row')).toHaveLength(2);
    expect(screen.getByTestId('workflow-selected-status').textContent).toBe('运行中');
  });

  it('切换运行后按 runId 读取详情', async () => {
    render(<WorkflowRunsPanel />);
    await waitFor(() => expect(screen.getByText('失败审阅')).toBeTruthy());
    fireEvent.click(screen.getByText('失败审阅'));
    await waitFor(() => expect(detailMock).toHaveBeenLastCalledWith('wf-failed'));
    await waitFor(() => expect(screen.getByTestId('workflow-selected-status').textContent).toBe('失败'));
  });

  it('运行中可取消，失败后可从持久前缀恢复', async () => {
    render(<WorkflowRunsPanel />);
    await waitFor(() => expect(screen.getByText('取消运行')).toBeTruthy());
    expect(screen.getByText<HTMLButtonElement>('取消运行').disabled).toBe(false);
    fireEvent.click(screen.getByText('取消运行'));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith('wf-running'));

    fireEvent.click(screen.getByText('失败审阅'));
    await waitFor(() => expect(screen.getByText<HTMLButtonElement>('恢复运行').disabled).toBe(false));
    fireEvent.click(screen.getByText('恢复运行'));
    await waitFor(() => expect(resumeMock).toHaveBeenCalledWith('wf-failed'));
  });

  it('未启用时诚实空态，不发请求', () => {
    render(<WorkflowRunsPanel enabled={false} />);
    expect(screen.getByTestId('workflow-runs-panel').getAttribute('data-state')).toBe('disabled');
    expect(runsMock).not.toHaveBeenCalled();
  });
});
