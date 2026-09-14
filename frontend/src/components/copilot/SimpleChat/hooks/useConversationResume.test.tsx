// BLOCK-87 L2 — useConversationResume 多端消息镜像轮询测试。
// 验证：无活跃 run 时每 5s 对账拉取，他端新消息出现在拉取结果；
// 活跃 run 时跳过轮询（本地流式快照优先）。
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useConversationResume } from './useConversationResume';

const mocks = vi.hoisted(() => ({
  getConversationMessages: vi.fn(),
  clearConversationRun: vi.fn(),
  resumeConversationRun: vi.fn(),
  shouldClearReconciledConversationRun: vi.fn(() => false),
  findResumableAgentTask: vi.fn(() => null),
}));

vi.mock('../../copilotConversationsClient', () => ({
  getConversationMessages: mocks.getConversationMessages,
}));
vi.mock('../../conversationRunStore', () => ({
  clearConversationRun: mocks.clearConversationRun,
  resumeConversationRun: mocks.resumeConversationRun,
  shouldClearReconciledConversationRun: mocks.shouldClearReconciledConversationRun,
  useConversationRun: vi.fn(),
}));
vi.mock('../../copilotClient', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  findResumableAgentTask: mocks.findResumableAgentTask,
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
    mocks.getConversationMessages.mockResolvedValue([
      { role: 'user', content: '旧消息' },
    ]);
    render(<Harness conversationId="conv_1" activeRun={null} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100); // 挂载初始加载
    });
    const initialCalls = mocks.getConversationMessages.mock.calls.length;
    expect(initialCalls).toBeGreaterThanOrEqual(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000); // 跨两个轮询周期
    });
    expect(mocks.getConversationMessages.mock.calls.length).toBeGreaterThan(initialCalls);
    expect(mocks.getConversationMessages.mock.calls[0][0]).toBe('conv_1');
  });

  it('活跃 run：跳过轮询（本地流式快照优先，不与手机对账冲突）', async () => {
    vi.useFakeTimers();
    mocks.getConversationMessages.mockResolvedValue([{ role: 'user', content: 'x' }]);
    render(<Harness conversationId="conv_2" activeRun={{ status: 'running' }} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });
    // 仅挂载时的初始加载，无轮询增量
    expect(mocks.getConversationMessages.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
