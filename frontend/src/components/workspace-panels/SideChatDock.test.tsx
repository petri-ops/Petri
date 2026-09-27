/**
 * UI-417 — SideChatDock 组件测试：把手常驻/点击滑出/Esc 收起/呼吸灯按会话运行态/
 * sideChatOpen 事件展开/copilotAsk 归属不在悬挂面（不派发）。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/copilot/SimpleChat', () => ({
  SimpleChat: (props: { conversationId: string | null; lockedAccessMode?: string; compact?: boolean }) => {
    const bag = globalThis as { __sideChatSimpleChatProps?: Array<Record<string, unknown>> };
    bag.__sideChatSimpleChatProps ??= [];
    bag.__sideChatSimpleChatProps.push(props);
    return <div data-testid="side-chat-simplechat">{props.conversationId}</div>;
  },
}));

vi.mock('@/components/copilot/conversationRunStore', () => ({
  isConversationRunning: (id: string | null | undefined) => id === 'conv_running',
}));

vi.mock('@/lib/copilotContext', () => ({
  // copilotAsk 由中央 ownsCopilotAsk 承接；若悬挂面错误订阅此事件则本 mock 会命中
  subscribeCopilotContext: vi.fn(() => () => {}),
}));

import { SideChatDock } from './SideChatDock';
import { setSideChatDockOpen } from '@/hooks/sideChatDockStore';

describe('UI-417 SideChatDock', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setSideChatDockOpen(false);
  });

  afterEach(() => {
    cleanup();
  });

  it('把手常驻、点击滑出 overlay 并复用同一 conversationId，再点收起', async () => {
    const { rerender } = render(
      <SideChatDock projectId="p_1" conversationId="conv_1" onConversationChange={vi.fn()} />
    );
    // 收起态：只有把手
    expect(screen.getByTestId('side-chat-handle')).toBeTruthy();
    expect(screen.queryByTestId('side-chat-surface')).toBeNull();

    fireEvent.click(screen.getByTestId('side-chat-handle'));
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    expect(screen.getByTestId('side-chat-simplechat').textContent).toBe('conv_1');

    // 再点收起
    fireEvent.click(screen.getByTestId('side-chat-handle'));
    await waitFor(() => expect(screen.queryByTestId('side-chat-surface')).toBeNull());
    void rerender;
  });

  it('sideChatOpen 事件展开悬挂面（右栏 chat tab 退役入口收编）', async () => {
    render(<SideChatDock projectId="p_1" conversationId="conv_1" onConversationChange={vi.fn()} />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('gewu:side-chat-open'));
    });
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
  });

  it('copilotAsk 归属不在悬挂面：不订阅 copilot 上下文，copilot-ask 派发不展开悬挂面', async () => {
    const { subscribeCopilotContext: sub } = await import('@/lib/copilotContext');
    render(<SideChatDock projectId="p_1" conversationId="conv_1" onConversationChange={vi.fn()} />);
    act(() => {
      window.dispatchEvent(new CustomEvent('gewu:copilot-ask', { detail: { prompt: '悬挂面不应响应' } }));
    });
    expect(screen.queryByTestId('side-chat-simplechat')).toBeNull();
    expect(sub).not.toHaveBeenCalled();
  });

  it('Esc 收起', () => {
    render(<SideChatDock projectId="p_1" conversationId="conv_1" onConversationChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId('side-chat-handle'));
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('side-chat-surface')).toBeNull();
  });

  it('外点收起（面板内交互不触发）', () => {
    render(
      <div>
        <div data-testid="outside" />
        <SideChatDock projectId="p_1" conversationId="conv_1" onConversationChange={vi.fn()} />
      </div>
    );
    fireEvent.click(screen.getByTestId('side-chat-handle'));
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByTestId('side-chat-surface')).toBeNull();
    // 面板内 mousedown 不收起
    fireEvent.click(screen.getByTestId('side-chat-handle'));
    fireEvent.mouseDown(screen.getByTestId('side-chat-surface'));
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
  });

  it('呼吸灯：会话运行中把手圆点变 running 态', () => {
    const { rerender } = render(
      <SideChatDock projectId="p_1" conversationId="conv_running" onConversationChange={vi.fn()} />
    );
    fireEvent.click(screen.getByTestId('side-chat-handle'));
    const dot = screen.getByTestId('side-chat-handle').querySelector('span');
    expect(dot?.className).toContain('handleDotRunning');

    rerender(
      <SideChatDock projectId="p_1" conversationId="conv_idle" onConversationChange={vi.fn()} />
    );
    const dotIdle = screen.getByTestId('side-chat-handle').querySelector('span');
    expect(dotIdle?.className).not.toContain('handleDotRunning');
  });

  it('无会话时展开显示诚实空态（不渲染 SimpleChat）', () => {
    render(<SideChatDock projectId="p_1" conversationId={null} onConversationChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId('side-chat-handle'));
    expect(screen.queryByTestId('side-chat-simplechat')).toBeNull();
    expect(screen.getByTestId('side-chat-surface').textContent).toContain('还没有会话');
  });
});

describe('UI-448 SideChatDock 共享开态（sideChatDockStore）', () => {
  beforeEach(() => {
    setSideChatDockOpen(false);
  });

  afterEach(() => {
    cleanup();
    setSideChatDockOpen(false);
  });

  it('外部 set 开态直接展开（中栏让位同源联动），把手呈激活态', () => {
    render(<SideChatDock projectId="p_1" conversationId="conv_1" onConversationChange={vi.fn()} />);
    expect(screen.queryByTestId('side-chat-surface')).toBeNull();
    act(() => {
      setSideChatDockOpen(true);
    });
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    expect(screen.getByTestId('side-chat-handle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('side-chat-handle').className).toContain('handleActive');
  });

  it('开态跨挂载持久：store 已开时重新挂载即展开（同一会话单一输入面的真相源）', () => {
    setSideChatDockOpen(true);
    const { unmount } = render(
      <SideChatDock projectId="p_1" conversationId="conv_1" onConversationChange={vi.fn()} />
    );
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    unmount();
    render(<SideChatDock projectId="p_1" conversationId="conv_1" onConversationChange={vi.fn()} />);
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
  });

  it('悬挂面锁只读档：SimpleChat 收到 lockedAccessMode="read" 与 compact（仅聊天不可改文件）', () => {
    (globalThis as { __sideChatSimpleChatProps?: unknown[] }).__sideChatSimpleChatProps = [];
    render(<SideChatDock projectId="p_1" conversationId="conv_1" onConversationChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId('side-chat-handle'));
    const props = (globalThis as { __sideChatSimpleChatProps?: Array<Record<string, unknown>> })
      .__sideChatSimpleChatProps?.at(-1);
    expect(props?.lockedAccessMode).toBe('read');
    expect(props?.compact).toBe(true);
  });
});
