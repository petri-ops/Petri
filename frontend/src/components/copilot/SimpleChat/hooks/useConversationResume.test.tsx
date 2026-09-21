// BLOCK-87 L2 — useConversationResume 多端消息镜像轮询测试。
// 验证：无活跃 run 时每 5s 对账拉取，他端新消息出现在拉取结果；
// 活跃 run 时跳过轮询（本地流式快照优先）。
// BLOCK-95 A1 — 主加载改分页信封（最新窗口）；重建链保留更旧前缀。
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useConversationResume, mergeKeepOlderPrefix } from './useConversationResume';

const mocks = vi.hoisted(() => ({
  getConversationMessages: vi.fn(),
  getConversationMessagesPage: vi.fn(),
  clearConversationRun: vi.fn(),
  resumeConversationRun: vi.fn(),
  shouldClearReconciledConversationRun: vi.fn(() => false),
  fetchInFlightPrimaryTasks: vi.fn(() => Promise.resolve([] as string[])),
}));

vi.mock('../../copilotConversationsClient', () => ({
  getConversationMessages: mocks.getConversationMessages,
  getConversationMessagesPage: mocks.getConversationMessagesPage,
}));
vi.mock('../../conversationRunStore', () => ({
  clearConversationRun: mocks.clearConversationRun,
  resumeConversationRun: mocks.resumeConversationRun,
  shouldClearReconciledConversationRun: mocks.shouldClearReconciledConversationRun,
  useConversationRun: vi.fn(),
}));
vi.mock('../../copilotClient', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchInFlightPrimaryTasks: mocks.fetchInFlightPrimaryTasks,
}));

function Harness({
  conversationId,
  activeRun,
}: {
  conversationId: string | null;
  activeRun: { status: string; completedAt?: string } | null;
}): React.ReactElement {
  useConversationResume({
    conversationId,
    projectId: 'p_test',
    activeRun: activeRun as never,
    refreshConversations: async () => {},
    setMessages: () => {},
    setLoading: () => {},
  });
  return <div />;
}

describe('BLOCK-87 L2 多端消息镜像轮询', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('会话打开：启动 5s 周期对账拉取（他端消息由此进入桌面）', async () => {
    vi.useFakeTimers();
    mocks.getConversationMessagesPage.mockResolvedValue({
      messages: [{ id: 'm1', role: 'user', content: '旧消息', ts: '2026-09-17T00:00:00.000Z' }],
      hasMore: false,
      nextBefore: null,
      windowOffset: 0,
    });
    mocks.getConversationMessages.mockResolvedValue([
      { id: 'm1', role: 'user', content: '旧消息', ts: '2026-09-17T00:00:00.000Z' },
    ]);
    render(<Harness conversationId="conv_1" activeRun={null} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100); // 挂载初始加载
    });
    const initialCalls = mocks.getConversationMessages.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000); // 跨两个轮询周期
    });
    expect(mocks.getConversationMessages.mock.calls.length).toBeGreaterThan(initialCalls);
    expect(mocks.getConversationMessages.mock.calls[0][0]).toBe('conv_1');
  });

  it('活跃 run：跳过轮询（本地流式快照优先，不与手机对账冲突）', async () => {
    vi.useFakeTimers();
    mocks.getConversationMessagesPage.mockResolvedValue({
      messages: [], hasMore: false, nextBefore: null, windowOffset: 0,
    });
    mocks.getConversationMessages.mockResolvedValue([{ id: 'm1', role: 'user', content: 'x' }]);
    render(<Harness conversationId="conv_2" activeRun={{ status: 'running' }} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });
    // 仅挂载时的初始加载，无轮询增量
    expect(mocks.getConversationMessages.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe('BLOCK-95 A1 历史加载游标化', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('主加载走分页信封（最新窗口 + hasMore/nextBefore 透出）', async () => {
    const collected: { older?: unknown }[] = [];
    // 稳定引用：内联箭头会使 effect deps 每次渲染变化 + setOlderMeta 重渲染 → 死循环
    const noop = () => {};
    const noopAsync = async () => {};
    function PageHarness(): React.ReactElement {
      const { older } = useConversationResume({
        conversationId: 'conv_a1',
        projectId: 'p_a1',
        activeRun: null,
        refreshConversations: noopAsync,
        setMessages: noop,
        setLoading: noop,
      });
      collected.push({ older });
      return <div />;
    }
    mocks.getConversationMessagesPage.mockResolvedValue({
      messages: [
        { id: 'm51', role: 'user', content: '内容-50', ts: '2026-09-17T00:00:50.000Z' },
        { id: 'm52', role: 'assistant', content: '内容-51', ts: '2026-09-17T00:00:51.000Z' },
      ],
      hasMore: true,
      nextBefore: 777,
      windowOffset: 50,
    });
    render(<PageHarness />);
    await act(async () => {});
    const state = collected[collected.length - 1].older as { hasMore: boolean; nextBefore: number | null; windowOffset: number };
    expect(mocks.getConversationMessagesPage).toHaveBeenCalledWith('conv_a1', 200);
    expect(state.hasMore).toBe(true);
    expect(state.nextBefore).toBe(777);
    expect(state.windowOffset).toBe(50);
  });

  it('loadOlder 以 nextBefore 为游标 prepend 更旧一页', async () => {
    const messages: unknown[][] = [];
    // 兼容直接值与 updater 两种 setMessages 形态
    const setMessages = vi.fn((update: unknown) => {
      const prev = messages[messages.length - 1] || [];
      const next = typeof update === 'function' ? (update as (c: unknown[]) => unknown[])(prev) : update;
      messages.push(next as unknown[]);
    });
    const noop = () => {};
    const noopAsync = async () => {};
    function OlderHarness(): React.ReactElement {
      const { older } = useConversationResume({
        conversationId: 'conv_a1b',
        projectId: 'p_a1',
        activeRun: null,
        refreshConversations: noopAsync,
        setMessages: setMessages,
        setLoading: noop,
      });
      const firedRef = React.useRef(false);
      React.useEffect(() => {
        // 副作用经 effect 触发，不在 render 期 setState
        if (older.hasMore && !older.loadingMore && !firedRef.current) {
          firedRef.current = true;
          void older.loadOlder();
        }
      }, [older]);
      return <div />;
    }
    mocks.getConversationMessagesPage
      .mockResolvedValueOnce({
        messages: [{ id: 'm2', role: 'assistant', content: '新', ts: '2026-09-17T01:00:00.000Z' }],
        hasMore: true,
        nextBefore: 42,
        windowOffset: 9,
      })
      .mockResolvedValueOnce({
        messages: [{ id: 'm1', role: 'user', content: '旧', ts: '2026-09-17T00:00:00.000Z' }],
        hasMore: false,
        nextBefore: null,
        windowOffset: 0,
      });
    render(<OlderHarness />);
    await act(async () => {});
    expect(mocks.getConversationMessagesPage).toHaveBeenLastCalledWith('conv_a1b', 200, 42);
    const last = messages[messages.length - 1] as Array<{ id: string }>;
    expect(last.map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('BLOCK-95 A1 mergeKeepOlderPrefix（重建链保留更旧前缀）', () => {
  it('persisted 窗口之外的已加载旧页保留在前且不重复', () => {
    const current = [
      { id: 'old1', role: 'user', content: '更旧1', ts: '2026-09-17T00:00:00.000Z' },
      { id: 'w1', role: 'user', content: '窗口首条', ts: '2026-09-17T01:00:00.000Z' },
    ] as never[];
    const persisted = [
      { id: 'w1', role: 'user', content: '窗口首条', ts: '2026-09-17T01:00:00.000Z' },
      { id: 'w2', role: 'assistant', content: '新消息', ts: '2026-09-17T02:00:00.000Z' },
    ] as never[];
    const merged = mergeKeepOlderPrefix(current, persisted);
    expect(merged.map((m) => (m as { id: string }).id)).toEqual(['old1', 'w1', 'w2']);
  });

  it('无旧页 / persisted 空时保持原引用语义', () => {
    const persisted = [{ id: 'w1', role: 'user', content: 'x', ts: '2026-09-17T01:00:00.000Z' }] as never[];
    expect(mergeKeepOlderPrefix([], persisted)).toBe(persisted);
    expect(mergeKeepOlderPrefix(persisted, [])).toEqual([]);
  });
});
