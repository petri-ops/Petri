/**
 * UI-417 — SideChatDock 组件测试：把手常驻/点击滑出/Esc 收起/呼吸灯按会话运行态/
 * sideChatOpen 事件展开/copilotAsk 归属不在悬挂面（不派发）。
 * UI-448 — 共享开态 store + 锁只读档 + compact。
 * UI-448 加映 v3 — 独立会话（不镜像中栏 activeConvId，每项目 localStorage 持久化）
 *   + slimComposer（composer 工具栏删减：只留只读徽标 + 发送键）。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/copilot/SimpleChat', () => ({
  SimpleChat: (props: {
    conversationId: string | null;
    lockedAccessMode?: string;
    compact?: boolean;
    slimComposer?: boolean;
  }) => {
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

const sideConvKey = 'gewu:side-chat-conv:p_1';
const propBag = () => globalThis as { __sideChatSimpleChatProps?: Array<Record<string, unknown>> };

describe('UI-417 SideChatDock', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setSideChatDockOpen(false);
  });

  afterEach(() => {
    cleanup();
  });

  it('把手常驻（收起态）、点击滑出 overlay；开态隐把手（加映 v4 贴右缘），Esc 收起后把手回归', async () => {
    render(<SideChatDock projectId="p_1" />);
    // 收起态：只有把手
    expect(screen.getByTestId('side-chat-handle')).toBeTruthy();
    expect(screen.queryByTestId('side-chat-surface')).toBeNull();

    fireEvent.click(screen.getByTestId('side-chat-handle'));
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    // 加映 v4 — 开态贴右缘：把手隐藏（关闭改由 ✕/Esc/外点承载）
    expect(screen.queryByTestId('side-chat-handle')).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('side-chat-surface')).toBeNull());
    expect(screen.getByTestId('side-chat-handle')).toBeTruthy();
  });

  it('sideChatOpen 事件展开悬挂面（右栏 chat tab 退役入口收编）', async () => {
    render(<SideChatDock projectId="p_1" />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('gewu:side-chat-open'));
    });
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
  });

  it('copilotAsk 归属不在悬挂面：不订阅 copilot 上下文，copilot-ask 派发不展开悬挂面', async () => {
    const { subscribeCopilotContext: sub } = await import('@/lib/copilotContext');
    render(<SideChatDock projectId="p_1" />);
    act(() => {
      window.dispatchEvent(new CustomEvent('gewu:copilot-ask', { detail: { prompt: '悬挂面不应响应' } }));
    });
    expect(screen.queryByTestId('side-chat-simplechat')).toBeNull();
    expect(sub).not.toHaveBeenCalled();
  });

  it('Esc 收起', () => {
    render(<SideChatDock projectId="p_1" />);
    fireEvent.click(screen.getByTestId('side-chat-handle'));
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('side-chat-surface')).toBeNull();
  });

  it('外点收起（面板内交互不触发）', () => {
    render(
      <div>
        <div data-testid="outside" />
        <SideChatDock projectId="p_1" />
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

  it('呼吸灯：侧聊会话运行中，收起态把手圆点变 running 态（加映 v4 起面板常驻会话内容）', () => {
    window.localStorage.setItem(sideConvKey, 'conv_running');
    render(<SideChatDock projectId="p_1" />);
    const dot = screen.getByTestId('side-chat-handle').querySelector('span');
    expect(dot?.className).toContain('handleDotRunning');

    window.localStorage.setItem(sideConvKey, 'conv_idle');
    cleanup();
    render(<SideChatDock projectId="p_1" />);
    const dotIdle = screen.getByTestId('side-chat-handle').querySelector('span');
    expect(dotIdle?.className).not.toContain('handleDotRunning');
  });
});

describe('UI-448 SideChatDock 共享开态（sideChatDockStore）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setSideChatDockOpen(false);
  });

  afterEach(() => {
    cleanup();
    setSideChatDockOpen(false);
  });

  it('外部 set 开态直接展开（中栏让位同源联动）；开态把手隐藏（加映 v4 贴右缘）', () => {
    render(<SideChatDock projectId="p_1" />);
    expect(screen.queryByTestId('side-chat-surface')).toBeNull();
    act(() => {
      setSideChatDockOpen(true);
    });
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    expect(screen.queryByTestId('side-chat-handle')).toBeNull();
  });

  it('开态跨挂载持久：store 已开时重新挂载即展开（同一会话单一输入面的真相源）', () => {
    setSideChatDockOpen(true);
    const { unmount } = render(<SideChatDock projectId="p_1" />);
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    unmount();
    render(<SideChatDock projectId="p_1" />);
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
  });
});

describe('UI-448 加映 v3 独立会话 + slimComposer', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setSideChatDockOpen(false);
    propBag().__sideChatSimpleChatProps = [];
  });

  afterEach(() => {
    cleanup();
    setSideChatDockOpen(false);
  });

  it('独立会话：SimpleChat 绑定 localStorage 持久化的侧聊会话，不接收中栏会话', () => {
    window.localStorage.setItem(sideConvKey, 'conv_side');
    render(<SideChatDock projectId="p_1" />);
    fireEvent.click(screen.getByTestId('side-chat-handle'));
    const props = propBag().__sideChatSimpleChatProps?.at(-1);
    expect(props?.conversationId).toBe('conv_side');
    expect(screen.getByTestId('side-chat-simplechat').textContent).toBe('conv_side');
  });

  it('无持久化会话时 conversationId 为 null（首发由 SimpleChat 建话并回写）', () => {
    render(<SideChatDock projectId="p_1" />);
    fireEvent.click(screen.getByTestId('side-chat-handle'));
    const props = propBag().__sideChatSimpleChatProps?.at(-1);
    expect(props?.conversationId).toBeNull();
  });

  it('slimComposer：composer 只留只读徽标 + 发送键（锁档 + compact 同传）', () => {
    render(<SideChatDock projectId="p_1" />);
    fireEvent.click(screen.getByTestId('side-chat-handle'));
    const props = propBag().__sideChatSimpleChatProps?.at(-1);
    expect(props?.slimComposer).toBe(true);
    expect(props?.lockedAccessMode).toBe('read');
    expect(props?.compact).toBe(true);
  });
});
