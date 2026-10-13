// ============================================================
// BLOCK-178 —— 消息队列与忙碌态投递一等化契约。
//
// 覆盖：enqueueQueuedPrompt 纯函数（稳定 ID/上限 20/诚实溢出/空文本）、
// moveQueued 同会话子序列换位、withdrawQueued 回填、sendNowQueued
// 优先消费+停当前轮、autoDrain 暂停门（跑完不自动发）、
// SimpleChatMessageRow 用户消息「编辑」钮。
// ============================================================
import { cleanup, renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

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

import {
  useChatStream,
  enqueueQueuedPrompt,
  QUEUE_CAP,
  type QueuedPrompt,
  type UseChatStreamArgs,
} from './useChatStream';
import { SimpleChatMessageRow } from '../SimpleChatMessageRow';
import type { SimpleMessage } from '../types';

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

function makeQueued(id: string, text: string, conversationId: string | null = 'conv_test'): QueuedPrompt {
  return { id, conversationId, text, createdAt: 1700000000000 };
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

describe('BLOCK-178 enqueueQueuedPrompt 纯函数', () => {
  it('入队携带稳定 ID 与时间戳；连续入队 ID 唯一', () => {
    const first = enqueueQueuedPrompt([], '第一条', 'conv_a');
    expect(first.ok).toBe(true);
    expect(first.next).toHaveLength(1);
    expect(first.next[0].id).toBeTruthy();
    expect(first.next[0].createdAt).toBeGreaterThan(0);
    const second = enqueueQueuedPrompt(first.next, '第二条', 'conv_a');
    expect(second.ok).toBe(true);
    expect(second.next[1].id).not.toBe(second.next[0].id);
  });

  it(`达到上限 ${QUEUE_CAP} 后诚实溢出（不静默丢最旧，原队列原样保留）`, () => {
    let current: QueuedPrompt[] = [];
    for (let i = 0; i < QUEUE_CAP; i += 1) {
      const r = enqueueQueuedPrompt(current, `msg-${i}`, 'conv_a');
      expect(r.ok).toBe(true);
      current = r.next;
    }
    expect(current).toHaveLength(QUEUE_CAP);
    const overflow = enqueueQueuedPrompt(current, '超限条目', 'conv_a');
    expect(overflow.ok).toBe(false);
    expect(overflow.overflow).toBe(true);
    expect(overflow.next).toBe(current); // 原样保留，不丢不截
    expect(overflow.next.some((q) => q.text === '超限条目')).toBe(false);
  });

  it('空文本不入队', () => {
    const r = enqueueQueuedPrompt([], '   ', 'conv_a');
    expect(r.ok).toBe(false);
    expect(r.overflow).toBe(false);
    expect(r.next).toHaveLength(0);
  });
});

describe('BLOCK-178 队列管理操作（hook 层）', () => {
  it('moveQueued 仅在同名会话子序列内换位（跨会话归属不动）', () => {
    const queued = [
      makeQueued('q1', 'A-1', 'conv_test'),
      makeQueued('x1', 'B-1', 'conv_other'),
      makeQueued('q2', 'A-2', 'conv_test'),
      makeQueued('q3', 'A-3', 'conv_test'),
    ];
    const setQueued = vi.fn();
    const { result } = renderHook((props: UseChatStreamArgs) => useChatStream(props), {
      initialProps: makeArgs({ queuedPrompts: queued, setQueuedPrompts: setQueued, activeRun: { conversationId: 'conv_test', status: 'running', taskId: 't1' } as never }),
    });
    act(() => { result.current.moveQueued('q3', -1); });
    const updater = setQueued.mock.calls[0][0] as (c: QueuedPrompt[]) => QueuedPrompt[];
    const next = updater(queued);
    // q3 换到 A 子序列首位前的相邻位：A 序列 q1,q2,q3 → q1,q3,q2；B-1 不动
    expect(next.map((q) => q.id)).toEqual(['q1', 'x1', 'q3', 'q2']);
  });

  it('withdrawQueued 出队并交还原文', () => {
    const queued = [makeQueued('q1', '待编辑文本'), makeQueued('q2', '另一条')];
    const setQueued = vi.fn();
    const { result } = renderHook((props: UseChatStreamArgs) => useChatStream(props), {
      // autoDrain=false 防排水效果在本用例先行触发（单一变量原则）
      initialProps: makeArgs({ queuedPrompts: queued, setQueuedPrompts: setQueued, autoDrain: false }),
    });
    let withdrawn: { ok: boolean; text?: string } = { ok: false };
    act(() => { withdrawn = result.current.withdrawQueued('q1'); });
    expect(withdrawn.ok).toBe(true);
    expect(withdrawn.text).toBe('待编辑文本');
    const calls = (setQueued.mock.calls as Array<[updater: (c: QueuedPrompt[]) => QueuedPrompt[]]>)
      .map(([updater]) => updater);
    expect(calls.length).toBeGreaterThan(0);
    const last = calls[calls.length - 1](queued);
    expect(last.map((q) => q.id)).toEqual(['q2']);
  });

  it('sendNowQueued：目标条目挪到会话子序列首位并停当前轮', () => {
    const queued = [
      makeQueued('q1', '先排的'),
      makeQueued('x1', '别会话', 'conv_other'),
      makeQueued('q2', '要立即发的'),
    ];
    const setQueued = vi.fn();
    const { result } = renderHook((props: UseChatStreamArgs) => useChatStream(props), {
      initialProps: makeArgs({
        queuedPrompts: queued,
        setQueuedPrompts: setQueued,
        autoDrain: false,
        activeRun: { conversationId: 'conv_test', status: 'running', taskId: 't1' } as never,
      }),
    });
    let ok = false;
    act(() => { ok = result.current.sendNowQueued('q2'); });
    expect(ok).toBe(true);
    const updater = setQueued.mock.calls[0][0] as (c: QueuedPrompt[]) => QueuedPrompt[];
    const next = updater(queued);
    expect(next.map((q) => q.id)).toEqual(['q2', 'q1', 'x1']); // q2 优先于同名会话其余条目
  });
});

describe('BLOCK-178 autoDrain 暂停门', () => {
  it('autoDrain=false：跑完对账后不自动消费排队项；true 时消费', async () => {
    const COMPLETED_AT = '2026-01-01T00:00:00.000Z';
    const completedRun = { conversationId: 'conv_test', status: 'complete', completedAt: COMPLETED_AT } as never;
    // 暂停
    const paused = makeArgs({
      queuedPrompts: [makeQueued('q1', '暂停期间不发')],
      autoDrain: false,
      activeRun: completedRun,
      // 已对账态（reconciledRunRef=conversationId:completedAt）：排水门其余条件全绿，
      // 唯独 autoDrain=false 挡住——锁死暂停门这一契约。
      reconciledRunRef: { current: `conv_test:${COMPLETED_AT}` },
    });
    renderHook((props: UseChatStreamArgs) => useChatStream(props), { initialProps: paused });
    await act(async () => { await Promise.resolve(); });
    // 暂停门：对账全绿但 autoDrain=false——不启动新轮（startConversationRun 不被调）
    expect(startConversationRunMock).not.toHaveBeenCalled();

    // 恢复
    const resumed = makeArgs({
      queuedPrompts: [makeQueued('q1', '恢复后消费')],
      autoDrain: true,
      activeRun: completedRun,
      reconciledRunRef: { current: `conv_test:${COMPLETED_AT}` },
    });
    renderHook((props: UseChatStreamArgs) => useChatStream(props), { initialProps: resumed });
    await act(async () => { await Promise.resolve(); });
    // 恢复后排水消费排队项：真实 send 链路启动新轮（断言起点在 run store）
    expect(startConversationRunMock).toHaveBeenCalled();
  });
});

describe('BLOCK-178 SimpleChatMessageRow 用户消息编辑钮', () => {
  const userMsg: SimpleMessage = { id: 'm1', role: 'user', content: '原始提问', ts: '2026-01-01T00:00:00.000Z' };

  // 既有行测试（SimpleChatMessageRow.test.tsx）的 baseProps 形态复用——严格类型对表
  const rowBase = {
    m: userMsg,
    messageKey: 'user-1700000000000-0',
    isTopicShiftStart: false,
    topicShiftReason: null,
    segments: [],
    streaming: false,
    onCancelTools: vi.fn(),
    settledContext: null,
    resolveNonce: 0,
    extraRenderersFlag: false,
    conversationId: 'conv_test',
    projectId: 'p_test',
    copiedMessageKey: null,
    forkingAtIndex: null,
    forkAbsoluteIndex: 0,
    summaryRetryState: null,
    summaryRetryErrors: {},
    summaryRetryAttempts: {},
    summaryRetryCooldownUntil: 0,
    cooldownNow: () => 0,
    maxSummaryRetries: 3,
    formatError: null,
    getTechnicalDetails: vi.fn(() => ({})),
    onFileReferenceClick: vi.fn(),
    onCopyMessage: vi.fn(),
    onRegenerate: vi.fn(),
  } as unknown as React.ComponentProps<typeof SimpleChatMessageRow>;

  function renderRow(props: { onEditUserMessage?: (m: SimpleMessage) => void }) {
    return render(<SimpleChatMessageRow {...rowBase} {...props} />);
  }

  it('提供 onEditUserMessage 时渲染「编辑」钮，点击回调原消息', () => {
    const onEdit = vi.fn();
    renderRow({ onEditUserMessage: onEdit });
    const btn = screen.getByTestId('msg-edit-user');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onEdit).toHaveBeenCalledWith(userMsg);
  });

  it('未提供 onEditUserMessage（run 投影件/流式期）不渲染编辑钮', () => {
    renderRow({});
    expect(screen.queryByTestId('msg-edit-user')).toBeNull();
  });
});
