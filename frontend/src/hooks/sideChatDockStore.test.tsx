// ============================================================
// UI-448 — sideChatDockStore 契约。
//
// SideChatDock 的开态从组件私有 useState 升为模块级共享单例：
// 中栏 SimpleChat（ownsCopilotAsk 实例）的 composer 让位与
// CenterPanel 的内容让位类都读同一真相，悬浮面展开/收起时三者联动。
// ============================================================
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSideChatDockOpen,
  setSideChatDockOpen,
  useSideChatDockOpen,
} from './sideChatDockStore';

afterEach(() => {
  cleanup();
  setSideChatDockOpen(false);
});

function Probe(): React.ReactElement {
  const open = useSideChatDockOpen();
  return <div data-testid="dock-probe" data-open={open ? 'true' : 'false'} />;
}

describe('UI-448 sideChatDockStore', () => {
  it('缺省收起；set 直改全局态，hook 订阅方同步更新', () => {
    render(<Probe />);
    expect(screen.getByTestId('dock-probe').getAttribute('data-open')).toBe('false');
    act(() => {
      setSideChatDockOpen(true);
    });
    expect(screen.getByTestId('dock-probe').getAttribute('data-open')).toBe('true');
    expect(getSideChatDockOpen()).toBe(true);
  });

  it('支持函数式更新（把手 toggle 语义）', () => {
    act(() => {
      setSideChatDockOpen((v) => !v);
    });
    expect(getSideChatDockOpen()).toBe(true);
    act(() => {
      setSideChatDockOpen((v) => !v);
    });
    expect(getSideChatDockOpen()).toBe(false);
  });

  it('多个 hook 订阅方（悬浮面/中栏 composer/CenterPanel）共享同一真相', () => {
    render(
      <div>
        <Probe />
        <Probe />
      </div>
    );
    act(() => {
      setSideChatDockOpen(true);
    });
    for (const probe of screen.getAllByTestId('dock-probe')) {
      expect(probe.getAttribute('data-open')).toBe('true');
    }
  });
});
