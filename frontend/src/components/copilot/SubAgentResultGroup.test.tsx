// UI-432（BLOCK-109 P3）— 子智能体终态结果组卡契约测试
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SubAgentResultGroup } from './SubAgentResultGroup';
import type { SubAgentCardData } from './SubAgentResultCard';

function task(overrides: Partial<SubAgentCardData>): SubAgentCardData {
  return {
    taskId: 't-' + Math.random().toString(36).slice(2, 8),
    taskText: '子任务描述',
    status: 'completed',
    createdAt: null,
    finishedAt: null,
    summaryHead: '摘要',
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('UI-432 子智能体结果组卡（BLOCK-109 P3）', () => {
  it('全成功：默认收起，摘要行计数正确，展开见逐任务明细', () => {
    render(
      <SubAgentResultGroup
        tasks={[
          task({ taskId: 'a', status: 'completed' }),
          task({ taskId: 'b', status: 'completed' }),
        ]}
      />
    );
    const summary = screen.getByText(/阶段汇总 · 2 个子智能体 · 成功 2/);
    expect(summary.textContent).not.toContain('失败');
    // 收起态：明细卡不可见
    expect(screen.queryByText('子任务描述')).toBeNull();
    fireEvent.click(summary);
    // 展开态：逐任务卡可见（2 张，各带摘要）
    expect(screen.getAllByText('子任务描述').length).toBe(2);
  });

  it('有失败：默认展开（失败必须显性），摘要行带失败计数', () => {
    render(
      <SubAgentResultGroup
        tasks={[
          task({ taskId: 'a', status: 'completed' }),
          task({ taskId: 'b', status: 'failed' }),
          task({ taskId: 'c', status: 'completed' }),
        ]}
      />
    );
    const summary = screen.getByText(/阶段汇总 · 3 个子智能体 · 成功 2 · 失败 1/);
    // 默认展开：明细直接可见
    expect(screen.getAllByText('子任务描述').length).toBe(3);
    // 点击收起
    fireEvent.click(summary);
    expect(screen.queryByText('子任务描述')).toBeNull();
  });

  it('空列表不渲染', () => {
    render(<SubAgentResultGroup tasks={[]} />);
    expect(screen.queryByTestId('subagent-result-group')).toBeNull();
  });
});
