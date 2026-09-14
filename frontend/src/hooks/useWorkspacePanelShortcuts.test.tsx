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

describe('useWorkspacePanelShortcuts (UI-359)', () => {
  it('toggles the right panel with Ctrl/Cmd+Shift+B', () => {
    renderHarness();
    expect(screen.getByTestId('right').textContent).toBe('open');

    fireEvent.keyDown(window, { key: 'B', shiftKey: true, ctrlKey: true });
    expect(screen.getByTestId('right').textContent).toBe('closed');

    // Shift 按下时部分键盘布局上报小写 b，两种都要命中。
    fireEvent.keyDown(window, { key: 'b', shiftKey: true, metaKey: true });
    expect(screen.getByTestId('right').textContent).toBe('open');
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
