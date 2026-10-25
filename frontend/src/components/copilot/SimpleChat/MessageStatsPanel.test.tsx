// BLOCK-255 C4 — 统计面板：真实字段、诚实未记录、关闭回调。
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MessageStatsPanel } from './MessageStatsPanel';
import type { SimpleMessage } from './types';

afterEach(cleanup);

const withUsage: SimpleMessage = {
  role: 'assistant',
  content: 'answer',
  processingDurationMs: 2500,
  toolActivities: [
    { key: 'a', name: 'workspace_read', status: 'success', actionLabel: '读取' },
  ],
  progressUpdates: [{ iteration: 1, content: 'first' }, { iteration: 3, content: 'third' }],
  usage: {
    calls: 2,
    unmeasuredCalls: 1,
    promptTokens: 1200,
    completionTokens: 80,
    cacheReadTokens: 600,
    cacheCreationTokens: 0,
    durationMs: 1800,
    models: ['deepseek-chat'],
  },
};

describe('MessageStatsPanel', () => {
  it('渲染本条真实字段与 token 合计', () => {
    const { getByTestId, getByText } = render(
      <MessageStatsPanel message={withUsage} onClose={vi.fn()} />,
    );
    expect(getByTestId('msg-stats-panel')).toBeTruthy();
    expect(getByText('2.5s')).toBeTruthy();
    expect(getByText('1 步')).toBeTruthy();
    expect(getByText('3 轮')).toBeTruthy();
    expect(getByText('6 字')).toBeTruthy();
    expect(getByText('deepseek-chat')).toBeTruthy();
    expect(getByText('输入 1K · 输出 80')).toBeTruthy();
    expect(getByText('读 600 · 写 0')).toBeTruthy();
    expect(getByText('2 次（有 usage） · 1 次未返回 usage')).toBeTruthy();
    expect(getByTestId('msg-stats-note').textContent).toContain('另有 1 次调用未返回 usage');
  });

  it('无 usage：Token 未记录，note 说明旧消息/渠道原因', () => {
    const { getAllByText, getByTestId } = render(
      <MessageStatsPanel message={{ ...withUsage, usage: undefined }} onClose={vi.fn()} />,
    );
    expect(getAllByText('未记录').length).toBeGreaterThanOrEqual(1);
    expect(getByTestId('msg-stats-note').textContent).toContain('旧消息或渠道未返回 usage');
  });

  it('关闭按钮回调', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<MessageStatsPanel message={withUsage} onClose={onClose} />);
    fireEvent.click(getByTestId('msg-stats-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
