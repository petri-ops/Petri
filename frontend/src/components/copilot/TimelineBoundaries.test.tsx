// BLOCK-248（Q3）— 轮次/工具行边界注入测试：子组件抛错只坏这一段，其余内容仍渲染。
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ToolRowBoundary, TurnBoundary } from './TimelineBoundaries';

function Boom(): React.ReactElement {
  throw new Error('boom');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TimelineBoundaries (BLOCK-248 / Q3)', () => {
  it('轮次边界：健康子树零额外 DOM；抛错时只替换这一段并保留别的行', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <TurnBoundary resetKey="turn-1">
        <p>健康轮次</p>
      </TurnBoundary>
    );
    expect(screen.getByText('健康轮次')).toBeTruthy();
    expect(document.querySelector('[data-segment]')).toBeNull();

    rerender(
      <div>
        <TurnBoundary resetKey="turn-2">
          <Boom />
        </TurnBoundary>
        <p>下一条消息</p>
      </div>
    );
    expect(screen.getByText('这一轮没能渲染出来')).toBeTruthy();
    expect(screen.getByText('下一条消息')).toBeTruthy();
    const crashed = document.querySelector('[data-segment="turn"]');
    expect(crashed?.getAttribute('data-segment-crashed')).toBe('true');
    expect(consoleError).toHaveBeenCalled();
  });

  it('工具行边界：只坏这一行（data-segment=tool-row）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <div>
        <ToolRowBoundary resetKey="call-1">
          <Boom />
        </ToolRowBoundary>
        <span>同轮其他工具</span>
      </div>
    );
    expect(screen.getByText('这一行工具记录没能渲染出来')).toBeTruthy();
    expect(screen.getByText('同轮其他工具')).toBeTruthy();
    expect(document.querySelector('[data-segment="tool-row"]')?.getAttribute('data-segment-crashed')).toBe('true');
  });
});
