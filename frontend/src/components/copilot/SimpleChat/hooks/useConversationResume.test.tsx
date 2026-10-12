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

  // BLOCK-151 A1 — 重放/本地分叉边界的行为锁（现状语义锚定，算法不动）。
  it('重放场景：persisted 重复覆盖 current 同 id 消息（不因更旧 ts 重复入列）', () => {
    const current = [
      { id: 'm1', role: 'user', content: '旧版内容', ts: '2026-09-17T00:00:00.000Z' },
      { id: 'm1', role: 'user', content: '重放同 id', ts: '2026-09-17T01:00:00.000Z' },
    ] as never[];
    const persisted = [
      { id: 'm1', role: 'user', content: '持久层权威内容', ts: '2026-09-17T01:00:00.000Z' },
    ] as never[];
    // 两条 m1（一旧一窗口内）都被 id 去重排除，SQLite 版本唯一保留
    const merged = mergeKeepOlderPrefix(current, persisted);
    expect(merged.map((m) => (m as { id: string }).id)).toEqual(['m1']);
    expect((merged[0] as { content: string }).content).toBe('持久层权威内容');
  });

  it('本地分叉场景：ts >= 窗口边界的本地-only 消息被 SQLite 权威覆盖（现状语义）', () => {
    // 现状契约：mergeKeepOlderPrefix 只保留「比 persisted 窗口更旧的已加载前缀」，
    // 窗口内（ts >= boundary）的本地-only 消息（乐观气泡/错误卡等未持久化面）
    // 一律让位 SQLite 权威——对账语义就是「以持久层重建」。改动此语义属于
    // 恢复合并核心重设计（plan §3 升级登记面），不在守卫批范围。
    const current = [
      { id: 'old1', role: 'user', content: '更旧1', ts: '2026-09-17T00:00:00.000Z' },
      { id: 'local-new', role: 'assistant', content: '本地乐观气泡', ts: '2026-09-17T01:30:00.000Z' },
    ] as never[];
    const persisted = [
      { id: 'w1', role: 'user', content: '窗口首条', ts: '2026-09-17T01:00:00.000Z' },
    ] as never[];
    const merged = mergeKeepOlderPrefix(current, persisted);
    expect(merged.map((m) => (m as { id: string }).id)).toEqual(['old1', 'w1']);
    expect(merged.some((m) => (m as { id: string }).id === 'local-new')).toBe(false);
  });

  it('ts 边界：ts === boundary 不保留（严格小于），缺 ts 消息不保留', () => {
    const boundary = '2026-09-17T01:00:00.000Z';
    const current = [
      { id: 'eq', role: 'user', content: '恰好等于边界', ts: boundary },
      { id: 'no-ts', role: 'assistant', content: '无时间戳', ts: undefined },
      { id: 'older', role: 'user', content: '严格更旧', ts: '2026-09-17T00:59:59.999Z' },
    ] as never[];
    const persisted = [{ id: 'w1', role: 'user', content: '窗口首条', ts: boundary }] as never[];
    const merged = mergeKeepOlderPrefix(current, persisted);
    expect(merged.map((m) => (m as { id: string }).id)).toEqual(['older', 'w1']);
  });
});

// BLOCK-151 A1 — loadOlder 会话切换竞态守卫的行为锁（BLOCK-102 P2：
// useConversationResume.ts 在途补页返回时会话已切换 → 整页丢弃，旧会话的
// 消息/游标不得写入新会话 state）。此前该守卫零行为测，绿锚锁现状。
describe('BLOCK-151 A1 loadOlder 会话切换竞态守卫（BLOCK-102 P2 现状锁）', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('补页在途时切会话：返回后整页丢弃（不 prepend、游标不写）', async () => {
    let releaseOlderPage: (value: unknown) => void = () => {};
    const olderPagePromise = new Promise((resolve) => { releaseOlderPage = resolve; });
    mocks.getConversationMessagesPage.mockImplementation((convId: string, _limit?: number, before?: number) => {
      if (convId === 'conv_a' && before === 42) return olderPagePromise; // 手控：补页挂起
      if (convId === 'conv_a') {
        return Promise.resolve({
          messages: [{ id: 'a1', role: 'user', content: 'A 最新', ts: '2026-09-17T02:00:00.000Z' }],
          hasMore: true, nextBefore: 42, windowOffset: 0,
        });
      }
      if (convId === 'conv_b') {
        return Promise.resolve({
          messages: [{ id: 'b1', role: 'user', content: 'B 最新', ts: '2026-09-17T02:00:00.000Z' }],
          hasMore: false, nextBefore: null, windowOffset: 0,
        });
      }
      return Promise.resolve({ messages: [], hasMore: false, nextBefore: null, windowOffset: 0 });
    });
    const setMessages = vi.fn();
    const noop = () => {};
    const noopAsync = async () => {};
    function RaceHarness({ convId }: { convId: string }): React.ReactElement {
      const { older } = useConversationResume({
        conversationId: convId,
        projectId: 'p_race',
        activeRun: null,
        refreshConversations: noopAsync,
        setMessages,
        setLoading: noop,
      });
      const firedRef = React.useRef(false);
      React.useEffect(() => {
        if (older.hasMore && !older.loadingMore && !firedRef.current) {
          firedRef.current = true;
          void older.loadOlder();
        }
      }, [older]);
      return <div />;
    }
    const { rerender } = render(<RaceHarness convId="conv_a" />);
    await act(async () => {});
    // conv_a 初始加载完成 → 自动补页（挂在手控 deferred 上）
    expect(mocks.getConversationMessagesPage).toHaveBeenCalledWith('conv_a', 200, 42);

    // 补页在途时切到 conv_b：切换 effect 清空消息
    rerender(<RaceHarness convId="conv_b" />);
    await act(async () => {});
    expect(setMessages).toHaveBeenCalledWith([]);

    // 挂起的 conv_a 补页此刻返回：守卫必须整页丢弃
    const callsAtSwitch = setMessages.mock.calls.length;
    act(() => {
      releaseOlderPage({
        messages: [{ id: 'a-old', role: 'user', content: 'A 的更旧页', ts: '2026-09-17T00:00:00.000Z' }],
        hasMore: false, nextBefore: null, windowOffset: 0,
      });
    });
    // 同步 act 不 flush 微任务：release 之后 loadOlder 的续延（守卫判定 +
    // setMessages 调用）还在微任务队列里，必须先让渡一拍再断言——否则断言
    // 跑在污染发生之前，摘守卫也不红（假绿锁）。
    await act(async () => {});
    expect(setMessages.mock.calls.length).toBe(callsAtSwitch);
    const flat = setMessages.mock.calls.flatMap(
      (c): Array<{ id?: string }> => (Array.isArray(c[0]) ? (c[0] as Array<{ id?: string }>) : [])
    );
    expect(flat.some((m) => m.id === 'a-old')).toBe(false);
  });
});
// ---------------------------------------------------------------------------
// BLOCK-169 A1 — 反例行为测锁（C-24 吸收批；现状语义留痕，算法换装=升级登记面）。
// 三条锁住 mergeKeepOlderPrefix 的已知语义边界，作为「换算法（id 全集+ts 排序
// 对账/区间并集）」立项前的事实基线：换算法时本组断言按新语义改写。
// ---------------------------------------------------------------------------
describe('BLOCK-169 A1 反例行为测锁（现状语义；升级登记见 C-24 收口）', () => {
  const msg = (id: string, ts: string, content = id) => ({ id, role: 'user', content, ts }) as never[];

  it('窗口空洞：ts<边界但非连续前缀的本地消息会被并入（现状按 ts 阈值不辨连续性）', () => {
    // loadOlder 中间页缺失时（窗口空洞），hole 的 ts 早于窗口首条——
    // 现状语义把它并入前缀；若 hole 实为「已被丢弃的分叉内容」则会复活。
    const current = [msg('old1', '2026-09-17T00:00:00.000Z'), msg('hole', '2026-09-17T00:30:00.000Z')] as never[];
    const persisted = [
      msg('w1', '2026-09-17T01:00:00.000Z'),
      msg('w2', '2026-09-17T02:00:00.000Z'),
    ] as never[];
    const merged = mergeKeepOlderPrefix(current, persisted);
    // 现状：old1 与 hole 都进前缀（空洞不辨）——换算法后预期 hole 按区间并集裁决
    expect(merged.map((m) => (m as { id: string }).id)).toEqual(['old1', 'hole', 'w1', 'w2']);
  });

  it('同 ts 边界：本地与窗口首条同 ts 时本地被丢弃（严格早于）', () => {
    const current = [msg('twin', '2026-09-17T01:00:00.000Z')] as never[];
    const persisted = [
      msg('w1', '2026-09-17T01:00:00.000Z'),
      msg('w2', '2026-09-17T02:00:00.000Z'),
    ] as never[];
    const merged = mergeKeepOlderPrefix(current, persisted);
    // 现状：严格 `<` 使同 ts 本地消息丢失（即便 id 不同、内容不同）
    expect(merged.map((m) => (m as { id: string }).id)).toEqual(['w1', 'w2']);
  });

  it('id 冲突去重：同 id 且 ts 更旧的本地产物不重复入列（既有防线锁）', () => {
    const current = [msg('dup', '2026-09-17T00:00:00.000Z')] as never[];
    const persisted = [
      msg('dup', '2026-09-17T01:00:00.000Z'),
      msg('w2', '2026-09-17T02:00:00.000Z'),
    ] as never[];
    const merged = mergeKeepOlderPrefix(current, persisted);
    expect(merged.map((m) => (m as { id: string }).id)).toEqual(['dup', 'w2']);
  });
});
