/**
 * UI-417 — SideChatDock 组件测试。
 * UI-448 — 只读锁/compact/slimComposer/独立会话（fork 继承主会话记录）。
 * UI-448 加映 v15 — 开态由壳状态（useWorkspacePanels.sideChatOpen）以 props 传入，
 *   组件不再自带把手/内部开态：收起经 onOpenChange(false) 回写壳状态。
 */
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  subscribeCopilotContext: vi.fn(() => () => {}),
}));

import { SideChatDock } from './SideChatDock';

const sideConvKey = 'petri:side-chat-conv:p_1';
const propBag = () => globalThis as { __sideChatSimpleChatProps?: Array<Record<string, unknown>> };

/** 开态受测控的 Harness：rerender open 即可模拟壳状态切换。 */
function DockHarness({
  projectId,
  sourceConversationId = null,
  open = false,
  variant,
}: {
  projectId: string;
  sourceConversationId?: string | null;
  open?: boolean;
  variant?: 'float' | 'docked';
}): React.ReactElement {
  const [on, setOn] = useState(open);
  return (
    <SideChatDock
      projectId={projectId}
      sourceConversationId={sourceConversationId}
      variant={variant}
      open={open || on}
      onOpenChange={setOn}
    />
  );
}

beforeEach(() => {
  window.localStorage.clear();
  propBag().__sideChatSimpleChatProps = [];
});

afterEach(() => {
  cleanup();
});

describe('UI-448 SideChatDock 开合（壳状态 props）', () => {
  it('open=false 无面板；open=true 滑出 overlay（右缘 0，摘要卡同槽位）', () => {
    const view = render(<DockHarness projectId="p_1" sourceConversationId="conv_main" />);
    expect(screen.queryByTestId('side-chat-surface')).toBeNull();
    // 中栏浮动把手退役（加映 v13：入口在顶栏 SideChatToggleButton）
    expect(screen.queryByTestId('side-chat-handle')).toBeNull();

    view.rerender(
      <DockHarness projectId="p_1" sourceConversationId="conv_main" open />
    );
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();

    view.rerender(<DockHarness projectId="p_1" sourceConversationId="conv_main" />);
    expect(screen.queryByTestId('side-chat-surface')).toBeNull();
  });

  it('头部 ✕ 触发 onOpenChange(false)（壳状态收起）', () => {
    const onOpenChange = vi.fn();
    render(
      <SideChatDock
        projectId="p_1"
        sourceConversationId="conv_main"
        open
        onOpenChange={onOpenChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '收起会话面板' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Esc 不收起（加映 v5 常驻化：输入时 Esc 误触不折叠），由顶栏开关/✕ 折叠', () => {
    render(
      <SideChatDock
        projectId="p_1"
        sourceConversationId="conv_main"
        open
        onOpenChange={vi.fn()}
      />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
  });

  it('外点不收起（加映 v5 常驻化：与摘要卡同款特性）', () => {
    render(
      <div>
        <div data-testid="outside" />
        <SideChatDock
          projectId="p_1"
          sourceConversationId="conv_main"
          open
          onOpenChange={vi.fn()}
        />
      </div>
    );
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
  });

  it('sideChatOpen 事件上报 onOpenChange(true)（右栏 tab 退役入口收编，壳状态归位）', async () => {
    const onOpenChange = vi.fn();
    render(
      <SideChatDock
        projectId="p_1"
        sourceConversationId="conv_main"
        open={false}
        onOpenChange={onOpenChange}
      />
    );
    act(() => {
      window.dispatchEvent(new CustomEvent('petri:side-chat-open'));
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('copilotAsk 归属不在悬挂面：不订阅 copilot 上下文', async () => {
    const { subscribeCopilotContext: sub } = await import('@/lib/copilotContext');
    render(
      <SideChatDock
        projectId="p_1"
        sourceConversationId="conv_main"
        open
        onOpenChange={vi.fn()}
      />
    );
    act(() => {
      window.dispatchEvent(new CustomEvent('petri:copilot-ask', { detail: { prompt: '悬挂面不应响应' } }));
    });
    expect(sub).not.toHaveBeenCalled();
  });
});

describe('UI-448 加映 v3/v12 独立会话（fork 继承）+ 传参', () => {
  beforeEach(() => {
    window.localStorage.clear();
    propBag().__sideChatSimpleChatProps = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('已有侧聊会话：绑定持久化 id，不重复 fork', async () => {
    const { forkConversation } = await import('@/components/copilot/copilotConversationsClient');
    window.localStorage.setItem(sideConvKey, 'conv_side');
    render(
      <DockHarness projectId="p_1" sourceConversationId="conv_main" open />
    );
    expect(screen.getByTestId('side-chat-simplechat').textContent).toBe('conv_side');
    expect(forkConversation).not.toHaveBeenCalled();
  });

  it('主会话为空：不 fork，侧聊保持空态（首发送由 SimpleChat 建话）', async () => {
    const { forkConversation } = await import('@/components/copilot/copilotConversationsClient');
    render(
      <DockHarness projectId="p_1" sourceConversationId={null} open />
    );
    expect(forkConversation).not.toHaveBeenCalled();
    expect(propBag().__sideChatSimpleChatProps?.at(-1)?.conversationId).toBeNull();
  });

  it('slimComposer + lockedAccessMode=read + compact 同传（传参契约）', () => {
    render(
      <SideChatDock
        projectId="p_1"
        sourceConversationId="conv_main"
        open
        onOpenChange={vi.fn()}
      />
    );
    const props = propBag().__sideChatSimpleChatProps?.at(-1);
    expect(props?.slimComposer).toBe(true);
    expect(props?.lockedAccessMode).toBe('read');
    expect(props?.compact).toBe(true);
  });
});

describe('UI-448 加映 v12 docked 变体（宽窗独立列区）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    propBag().__sideChatSimpleChatProps = [];
  });

  afterEach(cleanup);

  it('docked 变体渲染独立列区面板（无 dockRoot 悬浮根）', () => {
    render(
      <SideChatDock
        projectId="p_1"
        sourceConversationId="conv_main"
        variant="docked"
        open
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByTestId('side-chat-surface')).toBeTruthy();
    expect(document.querySelector("[data-testid='side-chat-dock']")).toBeNull();
  });
});

describe('UI-448 加映 v21 悬浮面与摘要浮卡同尺寸语言', () => {
  beforeEach(() => {
    window.localStorage.clear();
    propBag().__sideChatSimpleChatProps = [];
  });

  afterEach(cleanup);

  it('width 透传为悬浮面内联宽度（与摘要浮卡 summaryOpenWidth 同源同值）', () => {
    render(
      <SideChatDock
        projectId="p_1"
        sourceConversationId="conv_main"
        open
        onOpenChange={vi.fn()}
        width={288}
      />
    );
    const surface = screen.getByTestId('side-chat-surface');
    expect(surface.style.width).toBe('288px');
  });

  it('width 缺省时回落 CSS 300px（不写内联样式）', () => {
    render(
      <SideChatDock
        projectId="p_1"
        sourceConversationId="conv_main"
        open
        onOpenChange={vi.fn()}
      />
    );
    const surface = screen.getByTestId('side-chat-surface');
    expect(surface.style.width).toBe('');
  });
});

describe('UI-448 加映 v25 浮卡拖宽', () => {
  beforeEach(() => {
    window.localStorage.clear();
    propBag().__sideChatSimpleChatProps = [];
  });

  afterEach(cleanup);

  // 事件派发同步，act 同步形态即可（v29 清偿：require-await）
  const drag = (surface: HTMLElement, fromX: number, toX: number) => {
    const handle = surface.querySelector('[data-testid="float-card-resize-handle"]');
    expect(handle).toBeTruthy();
    if (!handle) return; // TS 窄化（querySelector 含 null；toBeTruthy 已保证失败面可读）
    fireEvent.pointerDown(handle, { clientX: fromX, button: 0 });
    act(() => {
      window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: toX }));
    });
    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
  };

  it('左缘把手向左拖变宽并持久化偏好', () => {
    render(
      <SideChatDock
        projectId="p_1"
        sourceConversationId="conv_main"
        open
        onOpenChange={vi.fn()}
        width={288}
      />
    );
    const surface = screen.getByTestId('side-chat-surface');
    drag(surface, 300, 248); // 向左拖 52px
    expect(surface.style.width).toBe('340px');
    expect(window.localStorage.getItem('petri:side-chat-float-width')).toBe('340');

    // 重挂载后偏好仍生效（优先于 width prop）
    cleanup();
    render(
      <SideChatDock
        projectId="p_1"
        sourceConversationId="conv_main"
        open
        onOpenChange={vi.fn()}
        width={288}
      />
    );
    expect(screen.getByTestId('side-chat-surface').style.width).toBe('340px');
  });

  it('拖宽被钳制在 [240, min(720, 视口-48)]', () => {
    render(
      <SideChatDock
        projectId="p_1"
        sourceConversationId="conv_main"
        open
        onOpenChange={vi.fn()}
        width={288}
      />
    );
    const surface = screen.getByTestId('side-chat-surface');
    drag(surface, 300, -2000); // 拖穿屏幕
    const capped = Math.min(720, Math.max(240, window.innerWidth - 48));
    expect(surface.style.width).toBe(`${capped}px`);
  });
});
