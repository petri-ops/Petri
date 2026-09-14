// ============================================================
// BLOCK-81 P3 —— useChatStream 思考档位透传单测。
//
// 实机抓真修（P3，2026-09-11）：`send` useCallback 闭包读了 thinkingLevel
// 但依赖数组漏项 → 切档位后不刷新页面直接发送，沿用挂载时的旧档位：
// composer 显示「高」，请求体却仍是 standard，上游收不到 reasoning_effort
// （实机拦截 fetch 实证，见 acceptance/block-81/block-81-p3-thinking-live.json）。
// 本测试锁死「档位变化后 send 必须用新档位启动 run」这一契约。
// ============================================================
import { cleanup, renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { startConversationRunMock, isConversationRunningMock } = vi.hoisted(() => ({
  startConversationRunMock: vi.fn((_options: { thinkingLevel?: string }) => true),
  isConversationRunningMock: vi.fn(() => false),
}));

vi.mock('@/components/copilot/conversationRunStore', () => ({
  isConversationRunning: isConversationRunningMock,
  startConversationRun: startConversationRunMock,
  startSubAgentTask: vi.fn(),
  stopConversationRun: vi.fn(),
  clearConversationRun: vi.fn(),
}));

vi.mock('@/components/copilot/conversationDraft', () => ({
  clearConversationDraft: vi.fn(),
  migrateConversationDraft: vi.fn(),
}));

vi.mock('@/lib/events', () => ({
  gewuEvents: { copilotAsk: 'copilotAsk' },
  subscribeGewuEvent: vi.fn(() => () => {}),
}));

vi.mock('@/lib/brand', () => ({ readBrandStorage: vi.fn(() => null) }));
vi.mock('@/lib/result-edit-agent-bridge', () => ({ copilotContextOverrideForAsk: vi.fn(() => ({})) }));

import { INITIAL_NAV_STATE } from '@/components/copilot/chatHistoryNav';

import { useChatStream, type UseChatStreamArgs } from './useChatStream';

type Level = 'off' | 'standard' | 'high';

function makeArgs(overrides: Partial<UseChatStreamArgs> = {}): UseChatStreamArgs {
  return {
    projectId: 'p_test',
    conversationId: 'conv_test',
    onConversationChange: vi.fn(),
    ownsCopilotAsk: false,
    taRef: { current: null },
    historyNavRef: { current: INITIAL_NAV_STATE },
    copilotCtxRef: { current: {} },
    reconciledRunRef: { current: null },
    setMessages: vi.fn(),
    setInput: vi.fn(),
    setQueuedPrompts: vi.fn(),
    input: '',
    messages: [],
    queuedPrompts: [],
    displayMessages: [],
    activeRun: null,
    activeModel: { endpointProfileId: 'deepseek-chat', model: 'deepseek-flash' },
    activeModelId: 'deepseek-chat',
    accessMode: 'full',
    planMode: false,
    createConversationForRun: vi.fn(async () => ({ id: 'conv_new' })),
    thinkingLevel: 'standard',
    ...overrides,
  } as UseChatStreamArgs;
}

function lastRunOptions() {
  const calls = startConversationRunMock.mock.calls;
  return calls[calls.length - 1]?.[0] as { thinkingLevel?: Level } | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  startConversationRunMock.mockReturnValue(true);
  isConversationRunningMock.mockReturnValue(false);
});

afterEach(() => {
  cleanup();
});

describe('useChatStream 思考档位透传（BLOCK-81 P3）', () => {
  it('切换档位后重新发送，run 使用新档位启动（不得沿用挂载时旧档位）', async () => {
    // 关键：除 thinkingLevel 外所有入参保持**同一引用**（尤其 activeModel 对象），
    // 否则 send 会因其它依赖变化被动重建，掩盖「档位漏进依赖数组」这一缺陷。
    const base = makeArgs();
    const { result, rerender } = renderHook((props: UseChatStreamArgs) => useChatStream(props), {
      initialProps: { ...base, thinkingLevel: 'standard' },
    });

    await act(async () => {
      await result.current.send('第一轮');
    });
    expect(lastRunOptions()?.thinkingLevel).toBe('standard');

    // 组件未卸载：只换档位（模拟 composer 档位菜单点击后直接发送）
    rerender({ ...base, thinkingLevel: 'high' });
    await act(async () => {
      await result.current.send('第二轮');
    });
    expect(lastRunOptions()?.thinkingLevel).toBe('high');
  });

  it('档位回到 standard 时同样即时生效（关闭思考＝不发参数）', async () => {
    const base = makeArgs();
    const { result, rerender } = renderHook((props: UseChatStreamArgs) => useChatStream(props), {
      initialProps: { ...base, thinkingLevel: 'high' },
    });

    await act(async () => {
      await result.current.send('高档一轮');
    });
    expect(lastRunOptions()?.thinkingLevel).toBe('high');

    rerender({ ...base, thinkingLevel: 'standard' });
    await act(async () => {
      await result.current.send('标准档一轮');
    });
    expect(lastRunOptions()?.thinkingLevel).toBe('standard');
  });
});

describe('useChatStream 发送守卫（UI-373 欢迎页未选项目拦截）', () => {
  it('sendGuard 返回非空时拦截：不建会话不启动 run，文本退回输入框保留', async () => {
    const guard = vi.fn(() => 'no-project');
    const createConversationForRun = vi.fn(async () => ({ id: 'conv_new' }));
    const setInput = vi.fn();
    const { result } = renderHook((props: UseChatStreamArgs) => useChatStream(props), {
      initialProps: makeArgs({ conversationId: null, sendGuard: guard, createConversationForRun, setInput }),
    });

    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.send('帮我分析这批数据');
    });
    expect(accepted).toBe(false);
    expect(guard).toHaveBeenCalledTimes(1);
    // 拦截在一切副作用之前：不建会话、不启动 run、不清输入（文本退回输入框）
    expect(createConversationForRun).not.toHaveBeenCalled();
    expect(startConversationRunMock).not.toHaveBeenCalled();
    expect(setInput).toHaveBeenCalledWith('帮我分析这批数据');
  });

  it('sendGuard 返回 null 时放行，行为与无守卫一致', async () => {
    const guard = vi.fn(() => null);
    const { result } = renderHook((props: UseChatStreamArgs) => useChatStream(props), {
      initialProps: makeArgs({ conversationId: null, sendGuard: guard }),
    });

    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.send('正常发送');
    });
    expect(accepted).toBe(true);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(startConversationRunMock).toHaveBeenCalledTimes(1);
  });

  it('守卫缺席（undefined）时零变化——工作区/右栏用法不受影响', async () => {
    const { result } = renderHook((props: UseChatStreamArgs) => useChatStream(props), {
      initialProps: makeArgs({ conversationId: null }),
    });

    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.send('无守卫路径');
    });
    expect(accepted).toBe(true);
    expect(startConversationRunMock).toHaveBeenCalledTimes(1);
  });
});
