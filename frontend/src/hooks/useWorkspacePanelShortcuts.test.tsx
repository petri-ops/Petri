import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WorkspacePanelsProvider,
  useWorkspacePanelsContext,
} from '@/components/desktop/WorkspacePanelsContext';
import { useWorkspacePanelShortcuts } from './useWorkspacePanelShortcuts';

function Harness(): React.ReactElement {
  useWorkspacePanelShortcuts();
  const { rightOpen, bottomTerminalOpen } = useWorkspacePanelsContext();
  return (
    <div>
      <span data-testid="right">{rightOpen ? 'open' : 'closed'}</span>
      <span data-testid="terminal">{bottomTerminalOpen ? 'open' : 'closed'}</span>
    </div>
  );
}

function renderHarness() {
  return render(
    <WorkspacePanelsProvider>
      <Harness />
    </WorkspacePanelsProvider>,
  );
}

afterEach(cleanup);

/**
 * `Mod` 按平台映射（macOS=Cmd、其余=Ctrl），这是键位可跨平台移植的前提，也因此
 * **metaKey 事件只在 macOS 形态下该命中**。UI-359 原测在本机（win32）直接灌 metaKey
 * 是靠旧实现"`ctrlKey||metaKey` 一视同仁"过的；BLOCK-200 P1 起按平台如实分档，
 * 故这里显式构造 mac 形态，断言比原来更强（Win 上按 Cmd 不该触发）。
 */
function withMacPlatform(run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(window.navigator, 'platform');
  Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true });
  try {
    run();
  } finally {
    if (descriptor) Object.defineProperty(window.navigator, 'platform', descriptor);
    else delete (window.navigator as unknown as { platform?: string }).platform;
  }
}

describe('useWorkspacePanelShortcuts (UI-359)', () => {
  it('toggles the right panel with Ctrl/Cmd+Shift+B', () => {
    renderHarness();
    expect(screen.getByTestId('right').textContent).toBe('open');

    fireEvent.keyDown(window, { key: 'B', shiftKey: true, ctrlKey: true });
    expect(screen.getByTestId('right').textContent).toBe('closed');

    // Shift 按下时部分键盘布局上报小写 b，两种都要命中。
    fireEvent.keyDown(window, { key: 'b', shiftKey: true, ctrlKey: true });
    expect(screen.getByTestId('right').textContent).toBe('open');

    withMacPlatform(() => {
      fireEvent.keyDown(window, { key: 'B', shiftKey: true, metaKey: true });
      expect(screen.getByTestId('right').textContent).toBe('closed');
    });
  });

  it('toggles the bottom terminal with Ctrl/Cmd+` and ignores held-key repeats', () => {
    renderHarness();
    expect(screen.getByTestId('terminal').textContent).toBe('closed');

    fireEvent.keyDown(window, { key: '`', ctrlKey: true });
    expect(screen.getByTestId('terminal').textContent).toBe('open');

    fireEvent.keyDown(window, { key: '`', ctrlKey: true, repeat: true });
    expect(screen.getByTestId('terminal').textContent).toBe('open');
  });

  it('ignores unmodified keys and near-miss chords', () => {
    renderHarness();
    const before = {
      right: screen.getByTestId('right').textContent,
      terminal: screen.getByTestId('terminal').textContent,
    };

    fireEvent.keyDown(window, { key: 'B', shiftKey: true });
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    fireEvent.keyDown(window, { key: '`', altKey: true });
    fireEvent.keyDown(window, { key: 'Escape', ctrlKey: true, shiftKey: true });

    expect(screen.getByTestId('right').textContent).toBe(before.right);
    expect(screen.getByTestId('terminal').textContent).toBe(before.terminal);
  });
});
