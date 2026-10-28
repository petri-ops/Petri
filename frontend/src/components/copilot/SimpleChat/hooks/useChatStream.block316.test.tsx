// ============================================================
// BLOCK-316 / UI-620 — 逐条插话（Qoder chatQueue 语义）契约。
//
// 运行中把某条排队消息交给当前任务的下一安全边界：
//  - 成功：POST task/:id/steer（body=该条文本）→ 该项出队 + onSteer 回执 depth
//  - 失败：条目保留、返回诚实原因、不触发 onSteer
//  - 非运行 / 缺 taskId：不发请求，返回可读原因
// ============================================================
import { renderHook, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getConversationRunSnapshotMock } = vi.hoisted(() => ({
  getConversationRunSnapshotMock: vi.fn(() => null as { taskId?: string } | null),
}));

vi.mock('@/components/copilot/conversationRunStore', () => ({
  isConversationRunning: vi.fn(() => false),
  getConversationRunSnapshot: getConversationRunSnapshotMock,
  startConversationRun: vi.fn(() => true),
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
    autoDrain: true,
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

function queued(id: string, text: string): QueuedPrompt {
  return { id, conversationId: 'conv_test', text, createdAt: 1700000000000 };
}

const RUNNING = { conversationId: 'conv_test', status: 'running', taskId: 't1' } as never;

beforeEach(() => {
  vi.clearAllMocks();
  getConversationRunSnapshotMock.mockReturnValue({ taskId: 't1' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('UI-620 steerQueuedPrompt', () => {
  it('运行中插话：POST 该条文本到 steer 端点，成功出队并回执 depth', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({ ok: true, depth: 2 }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const setQueuedPrompts = vi.fn();
    const onSteer = vi.fn();
    const prompts = [queued('q1', '总结时只列前三条'), queued('q2', '其他')];
    const { result } = renderHook(() => useChatStream(makeArgs({
      queuedPrompts: prompts,
      setQueuedPrompts,
      onSteer,
      activeRun: RUNNING,
    })));

    let out: Awaited<ReturnType<typeof result.current.steerQueuedPrompt>> | undefined;
    await act(async () => { out = await result.current.steerQueuedPrompt('q1'); });

    expect(out).toEqual({ ok: true, depth: 2 });
    const firstUrl = fetchMock.mock.calls[0][0];
    const urlText = typeof firstUrl === 'string' ? firstUrl : firstUrl instanceof URL ? firstUrl.href : firstUrl.url;
    expect(urlText).toContain('/ai/agent/task/t1/steer');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(typeof init.body === 'string' ? init.body : '')).toEqual({ message: '总结时只列前三条' });
    const updater = setQueuedPrompts.mock.calls.at(-1)?.[0] as (current: QueuedPrompt[]) => QueuedPrompt[];
    expect(updater(prompts)).toEqual([prompts[1]]);
    expect(onSteer).toHaveBeenCalledWith({ ok: true, text: '总结时只列前三条', depth: 2 });
  });

  it('插话被拒：条目保留、返回原因、不触发成功回执', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({ ok: false, message: 'not_running' }), { status: 409 })));
    vi.stubGlobal('fetch', fetchMock);
    const setQueuedPrompts = vi.fn();
    const onSteer = vi.fn();
    const prompts = [queued('q1', '待插话')];
    const { result } = renderHook(() => useChatStream(makeArgs({
      queuedPrompts: prompts,
      setQueuedPrompts,
      onSteer,
      activeRun: RUNNING,
    })));

    let out: Awaited<ReturnType<typeof result.current.steerQueuedPrompt>> | undefined;
    await act(async () => { out = await result.current.steerQueuedPrompt('q1'); });

    expect(out).toEqual({ ok: false, error: 'not_running' });
    expect(setQueuedPrompts).not.toHaveBeenCalled();
    expect(onSteer).not.toHaveBeenCalled();
  });

  it('非运行态 / 缺 taskId：不发请求并给出可读原因', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const prompts = [queued('q1', '待插话')];
    const idle = renderHook(() => useChatStream(makeArgs({ queuedPrompts: prompts })));
    let idleOut: Awaited<ReturnType<typeof idle.result.current.steerQueuedPrompt>> | undefined;
    await act(async () => { idleOut = await idle.result.current.steerQueuedPrompt('q1'); });
    expect(idleOut).toEqual({ ok: false, error: '当前没有运行中的任务' });

    getConversationRunSnapshotMock.mockReturnValue(null);
    const running = renderHook(() => useChatStream(makeArgs({ queuedPrompts: prompts, activeRun: RUNNING })));
    let runningOut: Awaited<ReturnType<typeof running.result.current.steerQueuedPrompt>> | undefined;
    await act(async () => { runningOut = await running.result.current.steerQueuedPrompt('q1'); });
    expect(runningOut).toEqual({ ok: false, error: '当前没有运行中的任务' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
