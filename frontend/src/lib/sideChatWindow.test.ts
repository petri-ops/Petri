/**
 * UI-627（BLOCK-321）— openSideChatWindow helper 测试。
 *
 * 契约：非 Electron 拒开（false）；首开无记忆且有主会话 → fork 继承并写
 * per-project 记忆；有记忆直接复用不重复 fork；fork 失败降级空态开窗；
 * popOut query 只带 projectId(+convId)（主进程白名单二次过滤）。
 *
 * desktopBridge 不 mock：真实 getBridge 读 window.petri，布置即桌面态。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/copilot/copilotConversationsClient', () => ({
  forkConversation: vi.fn(),
}));

import { openSideChatWindow, sideChatConvKey } from './sideChatWindow';
import { forkConversation } from '@/components/copilot/copilotConversationsClient';

const mockedFork = vi.mocked(forkConversation);
/** 弹出窗 popOut spy（经 window.petri 布置，真实 getBridge 读到）。 */
const mockPopOut = vi.fn(() => Promise.resolve({ ok: true, action: 'created' as const }));

function setDesktop(on: boolean): void {
  if (on) {
    (window as unknown as { petri: unknown }).petri = {
      windowManager: { popOut: mockPopOut },
    };
  } else {
    delete (window as unknown as { petri?: unknown }).petri;
  }
}

beforeEach(() => {
  window.localStorage.clear();
  mockPopOut.mockClear();
  mockedFork.mockReset();
  mockedFork.mockResolvedValue({
    id: 'conv_forked',
    title: '侧边聊天',
    status: 'active',
    last_page: null,
    message_count: 0,
    created_at: '',
    updated_at: '',
  });
  setDesktop(true);
});

describe('UI-627 openSideChatWindow helper', () => {
  it('非 Electron（无 window.petri）或空 projectId：拒绝开窗', async () => {
    setDesktop(false);
    await expect(openSideChatWindow({ projectId: 'p_1', sourceConversationId: null })).resolves.toBe(false);
    await expect(openSideChatWindow({ projectId: '', sourceConversationId: null })).resolves.toBe(false);
    expect(mockPopOut).not.toHaveBeenCalled();
  });

  it('首开无记忆且有主会话：fork 继承 → 写记忆 → query 带 convId', async () => {
    await openSideChatWindow({ projectId: 'p_1', sourceConversationId: 'conv_main' });
    expect(mockedFork).toHaveBeenCalledWith('conv_main', '侧边聊天');
    expect(window.localStorage.getItem(sideChatConvKey('p_1'))).toBe('conv_forked');
    expect(mockPopOut).toHaveBeenCalledWith('side-chat', undefined, { projectId: 'p_1', convId: 'conv_forked' });
  });

  it('已有 per-project 记忆：直接复用，不重复 fork', async () => {
    window.localStorage.setItem(sideChatConvKey('p_1'), 'conv_side');
    await openSideChatWindow({ projectId: 'p_1', sourceConversationId: 'conv_main' });
    expect(mockedFork).not.toHaveBeenCalled();
    expect(mockPopOut).toHaveBeenCalledWith('side-chat', undefined, { projectId: 'p_1', convId: 'conv_side' });
  });

  it('主会话为空（source=null）：不 fork，query 只带 projectId', async () => {
    await openSideChatWindow({ projectId: 'p_1', sourceConversationId: null });
    expect(mockedFork).not.toHaveBeenCalled();
    expect(mockPopOut).toHaveBeenCalledWith('side-chat', undefined, { projectId: 'p_1' });
  });

  it('fork 失败：降级空态开窗（首发送建话），不阻塞入口', async () => {
    mockedFork.mockRejectedValueOnce(new Error('network'));
    await openSideChatWindow({ projectId: 'p_1', sourceConversationId: 'conv_main' });
    expect(mockPopOut).toHaveBeenCalledWith('side-chat', undefined, { projectId: 'p_1' });
  });
});
