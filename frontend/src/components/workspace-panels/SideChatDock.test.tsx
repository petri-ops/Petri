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

vi.mock('@/components/copilot/copilotConversationsClient', () => ({
  forkConversation: vi.fn((id: string, title?: string) =>
    Promise.resolve({ id: id === 'conv_main' ? 'conv_forked' : null, title: title ?? null })
  ),
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

  it('收起态无面板；store 开启即滑出 overlay（加映 v13：入口迁顶栏，组件不再自带把手）', async () => {
    const { rerender } = render(<SideChatDock projectId="p_1" sourceConversationId="conv_main" />);
    expect(screen.queryByTestId('side-chat-surface')).toBeNull();
    // 加映 v13 — 中栏浮动把手退役（入口在顶栏 SideChatToggleButton）
    expect(screen.queryByTestId('side-chat-handle')).toBeNull();

    act(() => setSideChatDockOpen(true));
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();

    act(() => setSideChatDockOpen(false));
    await waitFor(() => expect(screen.queryByTestId('side-chat-surface')).toBeNull());
    void rerender;
  });

  it('sideChatOpen 事件展开悬挂面（右栏 chat tab 退役入口收编）', async () => {
    render(<SideChatDock projectId="p_1" sourceConversationId="conv_main" />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('gewu:side-chat-open'));
    });
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
  });

  it('copilotAsk 归属不在悬挂面：不订阅 copilot 上下文，copilot-ask 派发不展开悬挂面', async () => {
    const { subscribeCopilotContext: sub } = await import('@/lib/copilotContext');
    render(<SideChatDock projectId="p_1" sourceConversationId="conv_main" />);
    act(() => {
      window.dispatchEvent(new CustomEvent('gewu:copilot-ask', { detail: { prompt: '悬挂面不应响应' } }));
    });
    expect(screen.queryByTestId('side-chat-simplechat')).toBeNull();
    expect(sub).not.toHaveBeenCalled();
  });

  it('Esc 不收起（加映 v5 常驻化：输入时 Esc 误触不折叠），由顶栏开关/✕ 折叠', () => {
    render(<SideChatDock projectId="p_1" sourceConversationId="conv_main" />);
    act(() => setSideChatDockOpen(true));
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    // 头部 ✕ 折叠
    fireEvent.click(screen.getByRole('button', { name: '收起会话面板' }));
    expect(screen.queryByTestId('side-chat-surface')).toBeNull();
  });

  it('外点不收起（加映 v5 常驻化：与摘要卡同款特性，仅顶栏开关/✕ 折叠）', () => {
    render(
      <div>
        <div data-testid="outside" />
        <SideChatDock projectId="p_1" sourceConversationId="conv_main" />
      </div>
    );
    act(() => setSideChatDockOpen(true));
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
  });

  // 加映 v13 — 运行呼吸迁至顶栏开关（SideChatToggleButton 契约承载）
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

  it('外部 set 开态直接展开（中栏让位同源联动；加映 v13 无把手变体）', () => {
    render(<SideChatDock projectId="p_1" sourceConversationId="conv_main" />);
    expect(screen.queryByTestId('side-chat-surface')).toBeNull();
    act(() => {
      setSideChatDockOpen(true);
    });
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    expect(screen.queryByTestId('side-chat-handle')).toBeNull();
  });

  it('开态跨挂载持久：store 已开时重新挂载即展开（同一会话单一输入面的真相源）', () => {
    setSideChatDockOpen(true);
    const { unmount } = render(<SideChatDock projectId="p_1" sourceConversationId="conv_main" />);
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    unmount();
    render(<SideChatDock projectId="p_1" sourceConversationId="conv_main" />);
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
    render(<SideChatDock projectId="p_1" sourceConversationId="conv_main" />);
    act(() => setSideChatDockOpen(true));
    const props = propBag().__sideChatSimpleChatProps?.at(-1);
    expect(props?.conversationId).toBe('conv_side');
    expect(screen.getByTestId('side-chat-simplechat').textContent).toBe('conv_side');
  });

  it('无持久化会话时 conversationId 为 null（首发由 SimpleChat 建话并回写）', () => {
    render(<SideChatDock projectId="p_1" sourceConversationId="conv_main" />);
    act(() => setSideChatDockOpen(true));
    const props = propBag().__sideChatSimpleChatProps?.at(-1);
    expect(props?.conversationId).toBeNull();
  });

  it('slimComposer：composer 只留只读徽标 + 发送键（锁档 + compact 同传）', () => {
    render(<SideChatDock projectId="p_1" sourceConversationId="conv_main" />);
    act(() => setSideChatDockOpen(true));
    const props = propBag().__sideChatSimpleChatProps?.at(-1);
    expect(props?.slimComposer).toBe(true);
    expect(props?.lockedAccessMode).toBe('read');
    expect(props?.compact).toBe(true);
  });
});


describe('UI-448 加映 v12 继承主会话记录（fork）+ 钉住变体', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setSideChatDockOpen(false);
    propBag().__sideChatSimpleChatProps = [];
  });

  afterEach(() => {
    cleanup();
    setSideChatDockOpen(false);
  });

  it('首次展开自动 fork 主会话（继承记录）并持久化分叉 id', async () => {
    const { forkConversation } = await import('@/components/copilot/copilotConversationsClient');
    render(<SideChatDock projectId="p_1" sourceConversationId="conv_main" />);
    act(() => setSideChatDockOpen(true));
    await waitFor(() => expect(screen.getByTestId('side-chat-simplechat').textContent).toBe('conv_forked'));
    expect(forkConversation).toHaveBeenCalledWith('conv_main', expect.any(String));
    expect(window.localStorage.getItem(sideConvKey)).toBe('conv_forked');
  });

  it('已有侧聊会话时不重复 fork', async () => {
    const { forkConversation } = await import('@/components/copilot/copilotConversationsClient');
    window.localStorage.setItem(sideConvKey, 'conv_existing');
    render(<SideChatDock projectId="p_1" sourceConversationId="conv_main" />);
    act(() => setSideChatDockOpen(true));
    await waitFor(() => expect(screen.getByTestId('side-chat-simplechat').textContent).toBe('conv_existing'));
    expect(forkConversation).not.toHaveBeenCalled();
  });

  it('主会话为空时不 fork，保持空态（首发送由 SimpleChat 建话）', async () => {
    const { forkConversation } = await import('@/components/copilot/copilotConversationsClient');
    render(<SideChatDock projectId="p_1" sourceConversationId={null} />);
    act(() => setSideChatDockOpen(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(forkConversation).not.toHaveBeenCalled();
    expect(propBag().__sideChatSimpleChatProps?.at(-1)?.conversationId).toBeNull();
  });

  it('docked 变体：渲染独立列区面板（无悬浮把手/无 absolute 根）', () => {
    render(
      <SideChatDock projectId="p_1" sourceConversationId="conv_main" variant="docked" />
    );
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    expect(document.querySelector("[data-testid='side-chat-dock']")).toBeNull();
  });
});
