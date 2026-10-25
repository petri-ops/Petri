// BLOCK-257 E9 — 终端双 pane 分屏 UI 契约。
// 分屏=同一组 tab 的两个可见 host（active + secondary），不新建第四种终端形态；
// 退出分屏只隐藏 secondary，会话仍归 useTerminalTabs（其 secondary 断言另测）。
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BottomTerminal } from './BottomTerminal';
import { useTerminalTabs } from '@/hooks/useTerminalTabs';

vi.mock('@/hooks/useTerminalTabs', () => ({ useTerminalTabs: vi.fn() }));
vi.mock('@/themes/ThemeProvider', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('@/lib/desktopBridge', () => ({ getBridge: () => ({ popOut: vi.fn() }) }));

const mockedHook = vi.mocked(useTerminalTabs);

const TABS = [
  { id: 'tab-1', seq: 1, exited: false, cwd: '/tmp/demo' },
  { id: 'tab-2', seq: 2, exited: false, cwd: '/tmp/demo' },
];

function mount(): void {
  render(
    <BottomTerminal
      open
      height={240}
      leftOffset={0}
      rightOffset={0}
      onResize={() => {}}
      onClose={() => {}}
    />,
  );
}

beforeEach(() => {
  mockedHook.mockReturnValue({
    tabs: TABS,
    activeId: 'tab-1',
    setActive: vi.fn(),
    openTab: vi.fn(() => 'tab-3'),
    closeTab: vi.fn(),
    registerHost: () => () => {},
    limitNotice: null,
    dismissLimitNotice: vi.fn(),
    clear: vi.fn(),
    activeRunning: false,
    runningBy: {},
  });
});

afterEach(() => {
  cleanup();
  mockedHook.mockReset();
});

describe('BottomTerminal 分屏（BLOCK-257 E9）', () => {
  it('默认单栏：只有 active host 可见', () => {
    mount();
    const body = document.querySelector('[data-split]');
    expect(body?.getAttribute('data-split')).toBe('false');
    expect(document.querySelector('[data-tab-body="tab-1"]')?.getAttribute('aria-hidden')).toBe('false');
    expect(document.querySelector('[data-tab-body="tab-2"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('点「分屏」→ 第二个 tab 同屏可见；再点取消 → 回到单栏', () => {
    mount();
    fireEvent.click(screen.getByTestId('terminal-split-toggle'));
    expect(document.querySelector('[data-split]')?.getAttribute('data-split')).toBe('true');
    expect(document.querySelector('[data-tab-body="tab-1"]')?.getAttribute('aria-hidden')).toBe('false');
    expect(document.querySelector('[data-tab-body="tab-2"]')?.getAttribute('aria-hidden')).toBe('false');
    expect(screen.getByTestId('terminal-split-toggle').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('terminal-split-toggle'));
    expect(document.querySelector('[data-split]')?.getAttribute('data-split')).toBe('false');
    expect(document.querySelector('[data-tab-body="tab-2"]')?.getAttribute('aria-hidden')).toBe('true');
  });
});
