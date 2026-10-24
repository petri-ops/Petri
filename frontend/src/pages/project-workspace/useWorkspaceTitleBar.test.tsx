// BLOCK-250 — 标题栏注册 effect 的复位必须只在卸载；effect 重跑不得把标题打回默认。
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/copilot/conversationChangesStore', () => ({
  useConversationUnreviewedCount: () => 0,
  useConversationShortstat: () => null,
}));

import { useWorkspaceTitleBar } from './useWorkspaceTitleBar';

const updateTitleBar = vi.fn<(patch: { title?: string }) => void>();

function options(overrides: Record<string, unknown> = {}) {
  return {
    updateTitleBar,
    projectName: 'P',
    projectId: 'p1',
    titleBarTitle: '标题',
    rightTab: 'home',
    rightToolMenuOpen: false,
    tabs: [],
    surfaces: [],
    activeJobId: null,
    conversationJobs: [],
    browserCanGoBack: false,
    browserCanGoForward: false,
    conversations: [],
    activeConvId: null,
    handleSwitchConversation: null,
    handleOpenRightResults: vi.fn(),
    handleSelectTitleBarResult: vi.fn(),
    openRightPanel: vi.fn(),
    closeRightPanelTab: vi.fn(),
    closeOtherTabs: vi.fn(),
    closeTabsToRight: vi.fn(),
    closeAllTabs: vi.fn(),
    setRightOpen: vi.fn(),
    setRightTab: vi.fn(),
    setRightToolMenuOpen: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  updateTitleBar.mockReset();
});

describe('useWorkspaceTitleBar (BLOCK-250 loop regression)', () => {
  it('effect 重跑不重置标题栏；复位只在卸载发生', () => {
    const { rerender, unmount } = renderHook((props) => useWorkspaceTitleBar(props), {
      initialProps: options(),
    });
    expect(updateTitleBar).toHaveBeenCalledWith(expect.objectContaining({ title: '标题' }));

    updateTitleBar.mockClear();
    rerender(options({ rightToolMenuOpen: true }));
    const resetOnRerun = updateTitleBar.mock.calls.filter(([patch]) => patch && patch.title === 'Petri');
    expect(resetOnRerun).toHaveLength(0);

    unmount();
    expect(updateTitleBar.mock.calls.some(([patch]) => patch && patch.title === 'Petri')).toBe(true);
  });
});
