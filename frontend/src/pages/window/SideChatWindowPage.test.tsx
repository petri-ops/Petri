/**
 * UI-627（BLOCK-321）— SideChatWindowPage 组件测试：侧聊原生独立窗页面。
 *
 * 契约：初始状态从 URL query 读（主进程白名单拼入；localStorage 跨窗竞态
 * 通道已退役）→ 极简窗 chrome（窄拖动条 + 右上角 ✕，无标题头）→ ✕ 经桌面桥
 * window.close 关闭自身 → 会话切换写 per-project 记忆（本页自己读写，同进程）。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/copilot/SimpleChat', () => ({
  SimpleChat: (props: { projectId: string; conversationId: string | null }) => {
    const bag = globalThis as { __sideChatWindowChatProps?: Array<Record<string, unknown>> };
    bag.__sideChatWindowChatProps ??= [];
    bag.__sideChatWindowChatProps.push(props);
    return <div data-testid="side-chat-window-simplechat">{props.conversationId}</div>;
  },
}));

vi.mock('@/components/copilot/copilotConversationsClient', () => ({
  forkConversation: vi.fn(() => Promise.resolve(null)),
}));

import { SideChatWindowPage } from './SideChatWindowPage';

const chatProps = () =>
  (globalThis as { __sideChatWindowChatProps?: Array<Record<string, unknown>> })
    .__sideChatWindowChatProps?.at(-1);

/** SPA 内部路由注入 URL query（happy-dom 的 location.search 可写）。 */
function gotoUrl(search: string): void {
  window.history.replaceState({}, '', `/window/side-chat${search}`);
}

beforeEach(() => {
  window.localStorage.clear();
  (globalThis as { __sideChatWindowChatProps?: unknown }).__sideChatWindowChatProps = [];
  delete (window as { petri?: unknown }).petri;
  gotoUrl('');
});

afterEach(cleanup);

describe('UI-627 SideChatWindowPage（侧聊独立窗）', () => {
  it('URL query 带 projectId+convId：直接绑定传给 SimpleChat（主窗 fork 后经白名单 query 送达）', () => {
    gotoUrl('?projectId=p_1&convId=conv_side');
    render(<SideChatWindowPage />);
    expect(chatProps()?.projectId).toBe('p_1');
    expect(chatProps()?.conversationId).toBe('conv_side');
  });

  it('query 无 convId：回落 per-project 记忆（本页同进程读写，无跨窗竞态）', () => {
    window.localStorage.setItem('petri:side-chat-conv:p_1', 'conv_mem');
    gotoUrl('?projectId=p_1');
    render(<SideChatWindowPage />);
    expect(chatProps()?.conversationId).toBe('conv_mem');
  });

  it('query 与记忆都无：空态首发送建话（conversationId=null）', () => {
    gotoUrl('?projectId=p_1');
    render(<SideChatWindowPage />);
    expect(chatProps()?.conversationId).toBeNull();
  });

  it('无 projectId（异常直开）：不渲染 SimpleChat（防误写脏数据），诚实空态引导', () => {
    render(<SideChatWindowPage />);
    expect(screen.queryByTestId('side-chat-window-simplechat')).toBeNull();
    expect(screen.getByText(/未取得项目上下文/)).toBeTruthy();
  });

  it('极简 chrome：无旧「会话」标题头（52px 宽头退役）；窄拖动条 + 右上角 ✕ 在场', () => {
    gotoUrl('?projectId=p_1');
    render(<SideChatWindowPage />);
    expect(screen.queryByText('会话')).toBeNull();
    expect(screen.getByTestId('side-chat-window-drag-strip')).toBeTruthy();
    expect(screen.getByRole('button', { name: '关闭侧边聊天' })).toBeTruthy();
  });

  it('✕ 经桌面桥 window.close 关闭自身（真关闭，closeBehavior=close）', () => {
    gotoUrl('?projectId=p_1');
    const close = vi.fn();
    (window as { petri?: unknown }).petri = { window: { close } };
    render(<SideChatWindowPage />);
    fireEvent.click(screen.getByRole('button', { name: '关闭侧边聊天' }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('会话切换经 onConversationChange 写 per-project 记忆', () => {
    gotoUrl('?projectId=p_1');
    render(<SideChatWindowPage />);
    const onConversationChange = chatProps()?.onConversationChange as (id: string | null) => void;
    onConversationChange('conv_new');
    expect(window.localStorage.getItem('petri:side-chat-conv:p_1')).toBe('conv_new');
    onConversationChange(null);
    expect(window.localStorage.getItem('petri:side-chat-conv:p_1')).toBeNull();
  });
});
