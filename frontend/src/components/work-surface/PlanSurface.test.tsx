import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanSurface } from './PlanSurface';
import {
  approvePlanRevision,
  fetchPlanRevisions,
  fetchPlansForConversation,
} from '@/components/copilot/planApprovals';

vi.mock('@/components/copilot/planApprovals', () => ({
  fetchPlansForConversation: vi.fn(),
  fetchPlanRevisions: vi.fn(),
  approvePlanRevision: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.mocked(fetchPlansForConversation).mockReset();
  vi.mocked(fetchPlanRevisions).mockReset();
  vi.mocked(approvePlanRevision).mockReset();
});

describe('plan surface', () => {
  it('renders the empty state when the conversation has no plans', async () => {
    vi.mocked(fetchPlansForConversation).mockResolvedValue([]);
    vi.mocked(fetchPlanRevisions).mockResolvedValue([]);
    render(<PlanSurface conversationId="conv-1" />);
    expect(await screen.findByText(/当前会话还没有计划/)).toBeTruthy();
    expect(screen.getByTestId('plan-surface').getAttribute('data-state')).toBe('empty');
  });

  it('lists plans and exposes copy/download/discuss actions', async () => {
    vi.mocked(fetchPlansForConversation).mockResolvedValue([{
      id: 'plan-1',
      title: '分析计划',
      status: 'active',
      goal: '完成差异表达分析',
      specMd: '## 步骤',
      steps: [{ n: 1, title: '读取数据' }, { n: 2, title: '运行 DESeq2' }],
      total_steps: 2,
      done_steps: 1,
    }]);
    vi.mocked(fetchPlanRevisions).mockResolvedValue([]);
    const onAskAgent = vi.fn();
    render(<PlanSurface conversationId="conv-1" onAskAgent={onAskAgent} />);
    expect((await screen.findAllByText('分析计划')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下载 .md' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '在对话中讨论' })).toBeTruthy();
    expect(screen.getAllByText('执行中').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1/2').length).toBeGreaterThan(0);
  });
});

describe('plan revisions (BLOCK-253 B3/H4)', () => {
  it('shows proposed revision details and applies it', async () => {
    vi.mocked(fetchPlansForConversation).mockResolvedValue([{
      id: 'plan-1',
      title: '分析计划',
      status: 'active',
      goal: '完成差异表达分析',
      steps: [{ n: 1, title: '读取数据' }],
      total_steps: 1,
      done_steps: 0,
    }]);
    vi.mocked(fetchPlanRevisions)
      .mockResolvedValueOnce([{
        id: 'prev_1',
        revNo: 1,
        reason: '第二步拆成两步',
        status: 'proposed',
        steps: [
          { n: 1, title: '读取数据' },
          { n: 2, title: '先做质控', hint: '新步骤' },
        ],
        createdAt: '2026-10-24T00:00:00Z',
        appliedAt: null,
      }])
      .mockResolvedValue([{
        id: 'prev_1',
        revNo: 1,
        reason: '第二步拆成两步',
        status: 'applied',
        steps: [{ n: 1, title: '读取数据' }, { n: 2, title: '先做质控' }],
        createdAt: '2026-10-24T00:00:00Z',
        appliedAt: '2026-10-24T00:01:00Z',
      }]);
    vi.mocked(approvePlanRevision).mockResolvedValue({ ok: true });

    render(<PlanSurface conversationId="conv-1" />);
    fireEvent.click(await screen.findByTestId('plan-revision-tab-1'));
    expect(await screen.findByText('原因：第二步拆成两步')).toBeTruthy();
    expect(screen.getByText('先做质控')).toBeTruthy();
    fireEvent.click(screen.getByTestId('plan-revision-approve'));
    await waitFor(() => expect(approvePlanRevision).toHaveBeenCalledWith('plan-1', 1));
    await waitFor(() => expect(screen.getByTestId('plan-revision-tab-1').textContent).toContain('已应用'));
    expect(screen.queryByTestId('plan-revision-approve')).toBeNull();
  });
});
