/** item88 HK-01：子任务计量卡 tok/费用/时长/轮数实时刷新（纯加视图）。 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkbenchMetricsCard } from './WorkbenchMetricsCard';

afterEach(cleanup);

const usage = {
  calls: 2,
  inputTokens: 1200,
  outputTokens: 800,
  estimatedCostCny: 0.42,
  latencyMs: 5300,
};

describe('item88 工作台计量卡', () => {
  it('HK-01 四字段渲染，刷新后数字更新', () => {
    const first = render(<WorkbenchMetricsCard taskId="task-a" usage={usage} rounds={3} />);
    expect(screen.getByTestId('wb-metrics-tokens').textContent).toContain('2,000');
    expect(screen.getByTestId('wb-metrics-cost').textContent).toContain('0.42');
    expect(screen.getByTestId('wb-metrics-duration').textContent).toContain('5.3');
    expect(screen.getByTestId('wb-metrics-rounds').textContent).toContain('3');
    first.rerender(<WorkbenchMetricsCard taskId="task-a" usage={{ ...usage, estimatedCostCny: 0.99 }} rounds={5} />);
    expect(screen.getByTestId('wb-metrics-cost').textContent).toContain('0.99');
    expect(screen.getByTestId('wb-metrics-rounds').textContent).toContain('5');
  });
});
