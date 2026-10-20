import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanSurface } from './PlanSurface';
import { fetchPlansForConversation } from '@/components/copilot/planApprovals';

vi.mock('@/components/copilot/planApprovals', () => ({
  fetchPlansForConversation: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.mocked(fetchPlansForConversation).mockReset();
});

describe('plan surface', () => {
  it('renders the empty state when the conversation has no plans', async () => {
    vi.mocked(fetchPlansForConversation).mockResolvedValue([]);
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
