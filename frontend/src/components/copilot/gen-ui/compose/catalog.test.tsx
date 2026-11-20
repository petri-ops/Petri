import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposeCard } from './ComposeCard';
import type { ComposeSpec } from './spec';

// BLOCK-461 P0 — catalog 最小集渲染契约（HK-01 红绿先行）。
// ResultNode 插座通电：Metric/Table/Chart 叶子经既有 ResultCardRenderer 渲染（零第二渲染真相）。
// 降级：无效 spec（null）→ 占位 + console 留痕，不冒充渲染成功。

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const spec: ComposeSpec = {
  version: 1,
  root: 'card1',
  nodes: {
    card1: { kind: 'card', title: 'Job 概览' },
    m1: { kind: 'metric', parent: 'card1', title: '总行数', value: '42', unit: '行' },
    t1: { kind: 'table', parent: 'card1', title: '明细', columns: ['名称', '值'], rows: [['alpha', '1']] },
    c1: { kind: 'chart', parent: 'card1', title: '趋势', chartType: 'bar', labels: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] },
  },
};

describe('ComposeCard（P0 catalog 渲染）', () => {
  it('渲染 Card 标题与三个叶子（ResultNode 插座通电）', () => {
    render(<ComposeCard spec={spec} conversationId={null} />);
    expect(screen.getByText('Job 概览')).toBeTruthy();
    expect(screen.getByText(/总行数/)).toBeTruthy();
    expect(screen.getByText(/明细/)).toBeTruthy();
    expect(screen.getByText(/趋势/)).toBeTruthy();
  });

  it('Metric 叶子带单位（payload 归一为 "42 行"）', () => {
    const { container } = render(<ComposeCard spec={spec} conversationId={null} />);
    expect(container.textContent).toContain('42 行');
  });

  it('spec=null → 降级占位 + console 留痕（不冒充渲染）', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ComposeCard spec={null} conversationId={null} />);
    expect(screen.getByTestId('compose-invalid')).toBeTruthy();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('UI-714 — chart 叶子走 ChartRenderer（svg 在场，不再 raw-payload 兜底）', () => {
    const { container } = render(<ComposeCard spec={spec} conversationId={null} />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.textContent).not.toContain('"series"');
  });
});
