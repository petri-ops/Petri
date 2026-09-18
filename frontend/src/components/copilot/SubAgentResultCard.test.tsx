// UI-408 — 子智能体终态结果内联卡组件测试（服务端投影数据形状）
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SubAgentResultCard, type SubAgentCardData } from './SubAgentResultCard';
import { gewuEvents, subscribeGewuEvent } from '@/lib/events';

function cardData(overrides: Partial<SubAgentCardData> = {}): SubAgentCardData {
  return {
    taskId: 'sub-1',
    taskText: '报告 7 乘 6 的答案',
    status: 'completed',
    createdAt: '2026-09-18T01:00:00.000Z',
    finishedAt: '2026-09-18T01:00:42.000Z',
    summaryHead: '7 × 6 = 42。',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('UI-408 SubAgentResultCard', () => {
  it('渲染状态/时长/需求/摘要预览；点击「查看详情」派发 agentOpenInRail', () => {
    const received: Array<{ runId: string }> = [];
    const unsub = subscribeGewuEvent(gewuEvents.agentOpenInRail, (d) => received.push(d));
    render(<SubAgentResultCard data={cardData()} />);

    const card = screen.getByTestId('subagent-result-card');
    expect(card.textContent).toContain('已完成');
    expect(card.textContent).toContain('已工作 42 秒');
    expect(card.textContent).toContain('报告 7 乘 6 的答案');
    expect(card.textContent).toContain('7 × 6 = 42。');
    expect(card.textContent).toContain('父会话同源');

    fireEvent.click(screen.getByTestId('subagent-card-detail'));
    expect(received).toEqual([{ runId: 'sub-1' }]);
    unsub();
  });

  it('summaryHead 缺失诚实显示无输出；展开按钮切换', () => {
    render(<SubAgentResultCard data={cardData({ summaryHead: null })} />);
    expect(screen.getByTestId('subagent-result-card').textContent).toContain('（无文本输出）');

    fireEvent.click(screen.getByRole('button', { name: '展开全文' }));
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy();
  });

  it('长摘要收起态显示预览（截断+省略号），展开显示全文', () => {
    render(<SubAgentResultCard data={cardData({ summaryHead: `${'很长的分析结论。'.repeat(30)}结尾标记XYZ` })} />);
    const card = screen.getByTestId('subagent-result-card');
    expect(card.textContent).toContain('…');
    expect(card.textContent).not.toContain('结尾标记XYZ');
    fireEvent.click(screen.getByRole('button', { name: '展开全文' }));
    expect(card.textContent).toContain('结尾标记XYZ');
  });

  it('failed 与 running 状态标注', () => {
    render(<SubAgentResultCard data={cardData({ status: 'failed' })} />);
    expect(screen.getByTestId('subagent-result-card').textContent).toContain('失败');
    cleanup();
    render(<SubAgentResultCard data={cardData({ status: 'running', finishedAt: null })} />);
    expect(screen.getByTestId('subagent-result-card').textContent).toContain('运行中');
  });
});
