// BLOCK-248（Q3）— 轨迹 surface：空/载/错态、筛选、失败定位、加载更早。
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TraceSurface } from './TraceSurface';
import type { TrajectoryResponse } from '@/lib/trajectoryClient';
import { fetchTrajectory } from '@/lib/trajectoryClient';

vi.mock('@/lib/trajectoryClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/trajectoryClient')>();
  return { ...actual, fetchTrajectory: vi.fn() };
});

const fetchMock = vi.mocked(fetchTrajectory);

function base(overrides: Partial<TrajectoryResponse> = {}): TrajectoryResponse {
  return {
    ok: true,
    availability: 'available',
    recordedOnly: true,
    mode: 'tail',
    conversationId: 'conv_1',
    task: {
      taskId: 'task_1',
      status: 'done',
      agentStatus: 'done',
      createdAt: '2026-10-23T00:00:00.000Z',
      finishedAt: '2026-10-23T00:00:05.000Z',
      error: null,
    },
    events: [
      { seq: 1, at: '2026-10-23T00:00:00.000Z', type: 'run_started', group: 'assistant', summary: '开始运行' },
      { seq: 2, at: '2026-10-23T00:00:01.000Z', type: 'tool_call', group: 'tool', summary: '已读取 workspace_read' },
      { seq: 3, at: '2026-10-23T00:00:02.000Z', type: 'tool_result', group: 'tool', summary: '错误: not_found', status: 'error', durationMs: 3 },
      { seq: 4, at: '2026-10-23T00:00:03.000Z', type: 'usage', group: 'system', summary: '模型调用 mock-1 · 10+5 tokens' },
    ],
    truncated: false,
    hasMoreOlder: false,
    nextAfterSeq: 4,
    oldestSeq: 1,
    stats: {
      events: 4,
      toolCalls: 1,
      toolFailures: 1,
      errors: 0,
      compactions: 0,
      promptTokens: 10,
      completionTokens: 5,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      models: ['mock-1'],
    },
    ...overrides,
  };
}

const scrollIntoViewMock = vi.fn();

beforeAll(() => {
  // jsdom 未实现 scrollIntoView；轨迹"定位失败"依赖它。用稳定 spy 捕获调用，
  // 避免对原型方法做 unbound-method 断言（@typescript-eslint/unbound-method 会红）。
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe('TraceSurface (BLOCK-248 / Q3)', () => {
  it('无会话时给诚实空态，不发请求', () => {
    render(<TraceSurface conversationId={null} />);
    expect(screen.getByTestId('trace-empty').getAttribute('data-reason')).toBe('no-conversation');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('任务不存在 / 无事件分别给不同空态', async () => {
    fetchMock.mockResolvedValueOnce(base({ availability: 'no_task', task: null, events: [] }));
    const { unmount } = render(<TraceSurface conversationId="conv_1" />);
    await waitFor(() => expect(screen.getByTestId('trace-empty').getAttribute('data-reason')).toBe('no_task'));
    unmount();

    fetchMock.mockResolvedValueOnce(base({ availability: 'no_events', events: [] }));
    render(<TraceSurface conversationId="conv_1" />);
    await waitFor(() => expect(screen.getByTestId('trace-empty').getAttribute('data-reason')).toBe('no_events'));
  });

  it('渲染统计/记录口径/筛选，并按失败镜头筛出工具失败', async () => {
    fetchMock.mockResolvedValue(base());
    render(<TraceSurface conversationId="conv_1" onOpenIo={() => undefined} />);

    const stats = await screen.findByTestId('trace-stats');
    expect(stats.textContent).toContain('事件 4');
    expect(stats.textContent).toContain('工具 1');
    expect(stats.textContent).toContain('失败 1');
    expect(stats.textContent).toContain('tokens 10+5');
    expect(stats.textContent).toContain('用时 5.0 s');
    expect(screen.getByTestId('trace-recorded-note').textContent).toContain('只显示已记录事件');

    // 全部：4 条
    expect(screen.getAllByTestId('trace-event')).toHaveLength(4);
    // 工具镜头：2 条（tool_call + tool_result）
    fireEvent.click(screen.getByTestId('trace-filter-tool'));
    expect(screen.getAllByTestId('trace-event')).toHaveLength(2);
    // 错误镜头：工具失败也计入（group=tool + status=error）
    fireEvent.click(screen.getByTestId('trace-filter-error'));
    const failures = screen.getAllByTestId('trace-event');
    expect(failures).toHaveLength(1);
    expect(failures[0].getAttribute('data-status')).toBe('error');
  });

  it('定位最近失败：切到错误镜头并滚动到该行', async () => {
    fetchMock.mockResolvedValue(base());
    render(<TraceSurface conversationId="conv_1" />);
    const locate = await screen.findByTestId('trace-locate-failure');
    fireEvent.click(locate);
    expect(screen.getByTestId('trace-filter-error').getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalled());
    expect(screen.getAllByTestId('trace-event')).toHaveLength(1);
  });

  it('加载更早：按 beforeSeq 取上一页并前置', async () => {
    fetchMock.mockResolvedValueOnce(base({ hasMoreOlder: true }));
    fetchMock.mockResolvedValueOnce(base({
      mode: 'older',
      hasMoreOlder: false,
      events: [{ seq: 0, at: '2026-10-22T23:59:59.000Z', type: 'context_compacted', group: 'compaction', summary: '上下文压缩：丢弃 2 条消息' }],
    }));
    render(<TraceSurface conversationId="conv_1" />);
    const olderButton = await screen.findByTestId('trace-load-older');
    fireEvent.click(olderButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toMatchObject({ conversationId: 'conv_1', beforeSeq: 1, limit: 200 });
    await waitFor(() => expect(screen.getAllByTestId('trace-event')).toHaveLength(5));
    expect(screen.getByText(/上下文压缩：丢弃 2 条消息/)).toBeTruthy();
  });

  it('请求失败给错误态与重试入口', async () => {
    fetchMock.mockRejectedValueOnce(new Error('conversation_not_found'));
    render(<TraceSurface conversationId="conv_1" />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-empty').getAttribute('data-reason')).toBe('error');
    });
    expect(screen.getByTestId('trace-empty').textContent).toContain('conversation_not_found');
    fetchMock.mockResolvedValueOnce(base());
    fireEvent.click(screen.getByText('重试'));
    await waitFor(() => expect(screen.getByTestId('trace-stats')).toBeTruthy());
  });
});
