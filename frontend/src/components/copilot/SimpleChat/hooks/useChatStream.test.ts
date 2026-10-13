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

const { startConversationRunMock, isConversationRunningMock, getConversationRunSnapshotMock } = vi.hoisted(() => ({
  startConversationRunMock: vi.fn((_options: { thinkingLevel?: string }) => true),
  isConversationRunningMock: vi.fn(() => false),
  getConversationRunSnapshotMock: vi.fn(() => null as { taskId?: string } | null),
}));

vi.mock('@/components/copilot/conversationRunStore', () => ({
  isConversationRunning: isConversationRunningMock,
  getConversationRunSnapshot: getConversationRunSnapshotMock,
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
  petriEvents: { copilotAsk: 'copilotAsk' },
  subscribePetriEvent: vi.fn(() => () => {}),
}));

vi.mock('@/lib/brand', () => ({ readBrandStorage: vi.fn(() => null) }));
vi.mock('@/lib/authClient', () => ({
  getApiPrefix: vi.fn(() => '/api'),
  getToken: vi.fn(() => 'desktop-local'),
  errMsg: vi.fn((e: unknown) => String(e)),
  IS_DESKTOP: true,
}));
vi.mock('@/lib/result-edit-agent-bridge', () => ({ copilotContextOverrideForAsk: vi.fn(() => ({})) }));

import { INITIAL_NAV_STATE } from '@/components/copilot/chatHistoryNav';

import { useChatStream, type QueuedPrompt, type UseChatStreamArgs } from './useChatStream';

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
    createConversationForRun: vi.fn(() => Promise.resolve({ id: 'conv_new' })),
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
  getConversationRunSnapshotMock.mockReturnValue(null);
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


// ============================================================
// CK-01（C-06）— 运行中发送自动改走 steer 通道。
// 契约：会话运行中 send → POST task/:id/steer 入队（不启动新 run），
// onSteer.ok=true 回执且 send 返回 true；POST 失败 → onSteer.ok=false +
// 文本退回输入框（setInput）；无 taskId 的极旧运行态保持静默吞。
// ============================================================
describe('useChatStream 运行中发送自动 steer（CK-01）', () => {
  it('运行中发送 → POST steer 成功：onSteer ok=true、send true、不启动新 run', async () => {
    isConversationRunningMock.mockReturnValue(true);
    getConversationRunSnapshotMock.mockReturnValue({ taskId: 'task_ck01' });
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<{ ok: boolean; queued?: boolean; depth?: number }> }>>(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, queued: true, depth: 1 }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const onSteer = vi.fn();
    const { result } = renderHook(() => useChatStream(makeArgs({ onSteer })));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.send('中途改一下参数');
    });
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ai/agent/task/task_ck01/steer');
    expect(JSON.parse(typeof init.body === 'string' ? init.body : '{}')).toEqual({ message: '中途改一下参数' });
    expect(onSteer).toHaveBeenCalledWith(expect.objectContaining({ ok: true, depth: 1 }));
    expect(startConversationRunMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('steer POST 失败：onSteer ok=false、文本退回输入框、send false', async () => {
    isConversationRunningMock.mockReturnValue(true);
    getConversationRunSnapshotMock.mockReturnValue({ taskId: 'task_ck01' });
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ ok: false, error: 'invalid_arguments', message: 'message 不能为空' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const setInput = vi.fn();
    const onSteer = vi.fn();
    const { result } = renderHook(() => useChatStream(makeArgs({ onSteer, setInput })));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.send('会被保留的输入');
    });
    expect(ok).toBe(false);
    expect(onSteer).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'message 不能为空' }));
    expect(setInput).toHaveBeenCalledWith('会被保留的输入');
    expect(startConversationRunMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('运行中但无 taskId（极旧运行态）：保持静默吞，不 fetch、不回调', async () => {
    isConversationRunningMock.mockReturnValue(true);
    getConversationRunSnapshotMock.mockReturnValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onSteer = vi.fn();
    const { result } = renderHook(() => useChatStream(makeArgs({ onSteer })));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.send('静默路径');
    });
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSteer).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// ============================================================
// BLOCK-151 A1 — queue+drain 行为锁（BLOCK-102 P2 守卫簇此前零行为测）。
// 锁现状语义（绿锚）：归属过滤 / 对账门 / 失败即弃不重试。不改生产行为。
// ============================================================
describe('useChatStream 排队追问 drain（BLOCK-102 P2 守卫行为锁）', () => {
  it('只 drain 当前会话的条目，其他会话条目保留在队列', async () => {
    const setQueuedPrompts = vi.fn();
    renderHook(() => useChatStream(makeArgs({
      conversationId: 'conv_test',
      queuedPrompts: [
        { id: 'q_test_1', createdAt: 1700000000000, conversationId: 'conv_other', text: '别的会话的追问'  },
        { id: 'q_test_2', createdAt: 1700000000000, conversationId: 'conv_test', text: '当前会话的追问'  },
      ],
      setQueuedPrompts,
    })));
    await act(async () => {});
    expect(startConversationRunMock).toHaveBeenCalledTimes(1);
    const runOptions = startConversationRunMock.mock.calls[0][0] as { userContent: string };
    expect(runOptions.userContent).toBe('当前会话的追问');
    // 消费当前会话条目后，conv_other 的条目必须原样留在队列
    expect(setQueuedPrompts).toHaveBeenCalledTimes(1);
    const kept = setQueuedPrompts.mock.calls[0][0] as Array<{ id: 'q_test_3', createdAt: 1700000000000, conversationId: string; text: string }>;
    expect(kept.map((q) => [q.conversationId, q.text])).toEqual([['conv_other', '别的会话的追问']]); // BLOCK-178 加了 id/createdAt，守卫点=归属+文本
  });

  it('对账门：run 完结但尚未从 SQLite 对账时不 drain；对账标记写入后才发送', async () => {
    const setQueuedPrompts = vi.fn();
    const reconciledRunRef = { current: null as string | null };
    const base = makeArgs({
      conversationId: 'conv_test',
      queuedPrompts: [{ id: 'q_test_4', createdAt: 1700000000000, conversationId: 'conv_test', text: '等对账的追问'  }],
      setQueuedPrompts,
      reconciledRunRef,
      activeRun: { status: 'done', completedAt: 12345 } as never,
    });
    const { rerender } = renderHook((props: UseChatStreamArgs) => useChatStream(props), { initialProps: base });
    await act(async () => {});
    expect(startConversationRunMock).not.toHaveBeenCalled();

    // 对账完成（useConversationResume 写入 reconciliationId）→ 下一轮渲染放行
    reconciledRunRef.current = 'conv_test:12345';
    act(() => {
      rerender({ ...base, activeRun: { status: 'done', completedAt: 12345 } as never });
    });
    expect(startConversationRunMock).toHaveBeenCalledTimes(1);
  });

  it('drain 边界：send 失败（startConversationRun 拒绝）时条目已消费且不重试', async () => {
    // 现状语义书面留痕：drain 先移出队列再 send；send 返回 false（如并发拒绝/
    // 守卫拦截）时条目**不回队**——回队会被 effect deps（queuedPrompts 变化）
    // 重新触发，失败持续即构成自激重试循环，故「失败即弃」是有意设计。
    startConversationRunMock.mockReturnValue(false);
    const setQueuedPrompts = vi.fn();
    renderHook(() => useChatStream(makeArgs({
      conversationId: 'conv_test',
      queuedPrompts: [{ id: 'q_test_5', createdAt: 1700000000000, conversationId: 'conv_test', text: '会被丢弃的追问'  }],
      setQueuedPrompts,
    })));
    await act(async () => {});
    expect(setQueuedPrompts).toHaveBeenCalledTimes(1);
    expect(startConversationRunMock).toHaveBeenCalledTimes(1);
  });

  it('queue 仅在 streaming 时受理并带会话归属；非 streaming 时零消费', () => {
    const setQueuedPrompts = vi.fn();
    const setInput = vi.fn();
    const { result, rerender } = renderHook((props: UseChatStreamArgs) => useChatStream(props), {
      initialProps: makeArgs({ conversationId: 'conv_test', setQueuedPrompts, setInput }),
    });
    act(() => {
      result.current.queue('不该入队');
    });
    expect(setQueuedPrompts).not.toHaveBeenCalled();

    rerender(makeArgs({
      conversationId: 'conv_test',
      setQueuedPrompts,
      setInput,
      activeRun: { status: 'running' } as never,
    }));
    act(() => {
      result.current.queue('流中追问');
    });
    expect(setQueuedPrompts).toHaveBeenCalledTimes(1);
    // BLOCK-178 — queue 改为从 props 权威态计算后直接落值（不再传 updater）
    const drafted = setQueuedPrompts.mock.calls[0][0] as QueuedPrompt[];
    expect(drafted).toHaveLength(1);
    expect(drafted[0].conversationId).toBe('conv_test');
    expect(drafted[0].text).toBe('流中追问');
    expect(drafted[0].id).toBeTruthy(); // BLOCK-178 — 稳定 ID
    expect(setInput).toHaveBeenCalledWith('');
  });
});


// ============================================================
// BLOCK-171 CP-1 —— Stop 贯通后端契约。
// stop() 必须同时做两件事：①向后端级联取消端点 POST
// /ai/agent/task/:taskId/cancel（cancelAgentTaskCascade 主+子级联）；
// ②翻转本地 run 状态（即时反馈）。极旧运行态（无 taskId）退化为
// 纯本地翻转；后端请求网络失败不阻塞本地停止。
// ============================================================
import { stopConversationRun } from '@/components/copilot/conversationRunStore';

describe('useChatStream Stop 贯通后端（BLOCK-171 CP-1）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stop 时向后端级联取消端点发 POST 并翻转本地 run 状态', () => {
    getConversationRunSnapshotMock.mockReturnValue({ taskId: 'task_primary_1' });
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<{ ok: boolean }> }>>(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook((props: UseChatStreamArgs) => useChatStream(props), {
      initialProps: makeArgs(),
    });

    act(() => {
      result.current.stop();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ai/agent/task/task_primary_1/cancel');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer desktop-local');
    expect(vi.mocked(stopConversationRun)).toHaveBeenCalledWith('conv_test');
  });

  it('无 taskId（极旧运行态）：不请求后端，仍翻转本地态', () => {
    getConversationRunSnapshotMock.mockReturnValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook((props: UseChatStreamArgs) => useChatStream(props), {
      initialProps: makeArgs(),
    });

    act(() => {
      result.current.stop();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.mocked(stopConversationRun)).toHaveBeenCalledWith('conv_test');
  });

  it('后端请求网络失败：不阻塞本地停止', async () => {
    getConversationRunSnapshotMock.mockReturnValue({ taskId: 'task_x' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    const { result } = renderHook((props: UseChatStreamArgs) => useChatStream(props), {
      initialProps: makeArgs(),
    });

    await act(async () => {
      result.current.stop();
      await Promise.resolve(); // 冲刷 fire-and-forget 的 rejection catch 分支
    });

    expect(vi.mocked(stopConversationRun)).toHaveBeenCalledWith('conv_test');
  });
});
