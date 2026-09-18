// ============================================================
// BLOCK-99 G4 —— useKnowledgeConsole hook 单测：
// 会话引导（复用/新建独立 conversation）+ 发送走 streamChat（toolSubset 透传）
// + D4 确认卡投影与确认/取消回灌。streamChat mock，不发真实网络。
// ============================================================
import { cleanup, renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useKnowledgeConsole } from './useKnowledgeConsole';
import { gewuEvents } from '@/lib/events';

const streamChatMock = vi.fn();

vi.mock('@/components/copilot/copilotClient', () => ({
  streamChat: (opts: unknown) => streamChatMock(opts),
}));

vi.mock('@/components/copilot/copilotConversationsClient', () => ({
  createConversation: vi.fn(async () => ({
    id: 'conv_console_new',
    title: '知识空间管理台',
    status: 'active',
    last_page: '/knowledge',
    message_count: 0,
    created_at: '',
    updated_at: '',
  })),
  getConversation: vi.fn(async (id: string) =>
    id === 'conv_console_existing'
      ? {
          id,
          title: '知识空间管理台',
          status: 'active',
          last_page: '/knowledge',
          message_count: 0,
          created_at: '',
          updated_at: '',
        }
      : null
  ),
  getConversationMessages: vi.fn(async (id: string) =>
    id === 'conv_console_existing'
      ? [
          { id: 'm1', role: 'user', content: '上一条', ts: '' },
          { id: 'm2', role: 'assistant', content: '上一答', ts: '' },
        ]
      : []
  ),
}));

function captureStream() {
  let captured: Record<string, unknown> = {};
  streamChatMock.mockImplementation(async (opts: Record<string, unknown>) => {
    captured = opts;
  });
  return () => captured;
}

afterEach(() => {
  cleanup();
  streamChatMock.mockReset();
  window.localStorage.clear();
});

describe('BLOCK-99 G4 useKnowledgeConsole', () => {
  it('无记忆会话 → 新建独立 conversation 并就绪（空历史）', async () => {
    captureStream();
    const { result } = renderHook(() => useKnowledgeConsole());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.conversationId).toBe('conv_console_new');
    expect(result.current.entries).toEqual([]);
  });

  it('记忆会话存在 → 复用并加载历史；不存在 → 重建', async () => {
    captureStream();
    window.localStorage.setItem('gewu_knowledge_console_conv', 'conv_console_existing');
    const first = renderHook(() => useKnowledgeConsole());
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    expect(first.result.current.conversationId).toBe('conv_console_existing');
    expect(first.result.current.entries).toHaveLength(2);
    expect(first.result.current.entries[0]).toMatchObject({ role: 'user', content: '上一条' });

    window.localStorage.setItem('gewu_knowledge_console_conv', 'conv_console_gone');
    const second = renderHook(() => useKnowledgeConsole());
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current.conversationId).toBe('conv_console_new');
  });

  it('发送：user 条目即时入列；streamChat 收到 toolSubset=knowledge-console 与 conversationId；delta 聚合', async () => {
    const getCaptured = captureStream();
    const { result } = renderHook(() => useKnowledgeConsole());
    await waitFor(() => expect(result.current.ready).toBe(true));

    streamChatMock.mockImplementation(async (opts: Record<string, unknown>) => {
      Object.assign(getCaptured(), opts);
      const onDelta = opts.onDelta as (d: string) => void;
      onDelta('第一段');
      onDelta('第二段');
    });

    await act(async () => {
      await result.current.send('列出所有空间');
    });

    expect(result.current.streaming).toBe(false);
    expect((getCaptured() as { context?: { toolSubset?: string } }).context?.toolSubset).toBe('knowledge-console');
    expect((getCaptured() as { conversationId?: string }).conversationId).toBe('conv_console_new');
    const roles = result.current.entries.map((e) => (e.kind === 'message' ? e.role : 'tool'));
    expect(roles[0]).toBe('user');
    const assistant = result.current.entries.find((e) => e.kind === 'message' && e.role === 'assistant');
    expect(assistant && assistant.kind === 'message' && assistant.content).toBe('第一段第二段');
  });

  it('D4 确认门：tool_result confirmationRequired 投影确认卡；确认后回灌 token 消息；取消同理', async () => {
    const getCaptured = captureStream();
    const { result } = renderHook(() => useKnowledgeConsole());
    await waitFor(() => expect(result.current.ready).toBe(true));

    const dispatched: string[] = [];
    window.addEventListener(gewuEvents.knowledgeConsoleSync, () => dispatched.push('sync'));

    streamChatMock.mockImplementation(async (opts: Record<string, unknown>) => {
      Object.assign(getCaptured(), opts);
      const onToolCall = opts.onToolCall as (e: unknown) => void;
      const onToolResult = opts.onToolResult as (e: unknown) => void;
      onToolCall({
        name: 'knowledge_space_delete',
        args: { spaceId: 'ks_b' },
        callId: 'call_1',
      });
      onToolResult({
        name: 'knowledge_space_delete',
        summary: 'ok',
        toolResult: {
          callId: 'call_1',
          status: 'success',
          data: {
            confirmationRequired: true,
            action: 'knowledge_space_delete',
            impact: { spaceName: 'B 空间', documents: 3, chunks: 12 },
            confirmToken: 'kc_token_1',
            message: '等待确认',
          },
        },
      });
    });

    await act(async () => {
      await result.current.send('删除 B 空间');
    });

    const toolEntry = result.current.entries.find(
      (e) => e.kind === 'tool'
    ) as Extract<(typeof result.current.entries)[number], { kind: 'tool' }>;
    expect(toolEntry.confirmation).toMatchObject({
      action: 'knowledge_space_delete',
      targetId: 'ks_b',
      confirmToken: 'kc_token_1',
      resolved: 'pending',
    });
    expect(toolEntry.confirmation?.impactText).toContain('3 篇文档');
    // 未确认不执行：无同步广播、无额外消息
    expect(dispatched).toHaveLength(0);

    await act(async () => {
      result.current.confirmDestructive(toolEntry.id);
    });
    const messages = result.current.entries.filter((e) => e.kind === 'message' && e.role === 'user');
    const lastUser = messages[messages.length - 1];
    expect(lastUser && lastUser.kind === 'message' && lastUser.content).toContain('confirmToken=kc_token_1');
    expect(lastUser && lastUser.kind === 'message' && lastUser.content).toContain('id=ks_b');

    // 已确认的条目取消为无操作（pending 守卫，幂等）
    await act(async () => {
      result.current.cancelDestructive(toolEntry.id);
    });
    const updated = result.current.entries.find((e) => e.id === toolEntry.id) as Extract<
      (typeof result.current.entries)[number],
      { kind: 'tool' }
    >;
    expect(updated.confirmation?.resolved).toBe('confirmed');
  });

  it('D4 确认门：pending 条目取消 → resolved=cancelled，不回灌确认', async () => {
    const getCaptured = captureStream();
    const { result } = renderHook(() => useKnowledgeConsole());
    await waitFor(() => expect(result.current.ready).toBe(true));

    const dispatched: string[] = [];
    window.addEventListener(gewuEvents.knowledgeConsoleSync, () => dispatched.push('sync'));

    streamChatMock.mockImplementation(async (opts: Record<string, unknown>) => {
      Object.assign(getCaptured(), opts);
      const onToolCall = opts.onToolCall as (e: unknown) => void;
      const onToolResult = opts.onToolResult as (e: unknown) => void;
      onToolCall({ name: 'knowledge_space_clear', args: { spaceId: 'ks_b' }, callId: 'call_9' });
      onToolResult({
        name: 'knowledge_space_clear',
        summary: 'ok',
        toolResult: {
          callId: 'call_9',
          status: 'success',
          data: {
            confirmationRequired: true,
            action: 'knowledge_space_clear',
            impact: { spaceName: 'B 空间', documents: 1, chunks: 2 },
            confirmToken: 'kc_token_9',
          },
        },
      });
    });

    await act(async () => {
      await result.current.send('清空 B 空间');
    });
    const toolEntry = result.current.entries.find((e) => e.kind === 'tool') as Extract<
      (typeof result.current.entries)[number],
      { kind: 'tool' }
    >;

    const userCountBefore = result.current.entries.filter(
      (e) => e.kind === 'message' && e.role === 'user'
    ).length;

    await act(async () => {
      result.current.cancelDestructive(toolEntry.id);
    });
    const updated = result.current.entries.find((e) => e.id === toolEntry.id) as Extract<
      (typeof result.current.entries)[number],
      { kind: 'tool' }
    >;
    expect(updated.confirmation?.resolved).toBe('cancelled');
    // 取消也回灌一条用户消息（告知模型不要执行），但不带确认语义
    const messages = result.current.entries.filter(
      (e) => e.kind === 'message' && e.role === 'user'
    );
    expect(messages.length).toBe(userCountBefore + 1);
    expect(
      messages[messages.length - 1] &&
        messages[messages.length - 1].kind === 'message' &&
        messages[messages.length - 1].content
    ).toContain('取消');
    expect(dispatched).toHaveLength(0);
  });

  it('非破坏变更成功 → 广播面板同步；确认回执不广播', async () => {
    const getCaptured = captureStream();
    const { result } = renderHook(() => useKnowledgeConsole());
    await waitFor(() => expect(result.current.ready).toBe(true));

    const dispatched: string[] = [];
    window.addEventListener(gewuEvents.knowledgeConsoleSync, () => dispatched.push('sync'));

    streamChatMock.mockImplementation(async (opts: Record<string, unknown>) => {
      Object.assign(getCaptured(), opts);
      const onToolCall = opts.onToolCall as (e: unknown) => void;
      const onToolResult = opts.onToolResult as (e: unknown) => void;
      onToolCall({ name: 'knowledge_space_create', args: { name: '新空间' }, callId: 'c1' });
      onToolResult({
        name: 'knowledge_space_create',
        summary: 'ok',
        toolResult: { callId: 'c1', status: 'success', data: { space: { id: 'ks_new' } } },
      });
    });

    await act(async () => {
      await result.current.send('建一个空间');
    });
    expect(dispatched).toHaveLength(1);
  });
});
