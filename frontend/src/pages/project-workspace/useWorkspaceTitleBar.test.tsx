// BLOCK-250 — 标题栏注册 effect 的复位必须只在卸载；effect 重跑不得把标题打回默认。
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/copilot/conversationChangesStore', () => ({
  useConversationUnreviewedCount: () => 0,
  useConversationShortstat: () => null,
}));

import { useWorkspaceTitleBar } from './useWorkspaceTitleBar';

type TitleBarPatch = {
  title?: string;
  toolMenuItems?: Array<{ id: string; label: string; icon: string; isOpen?: boolean }>;
  onSelectToolItem?: ((id: string) => void) | null;
};
const updateTitleBar = vi.fn<(patch: TitleBarPatch) => void>();

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
    workspaceMode: 'chat',
    onSwitchWorkspaceMode: vi.fn(),
    bottomTerminalOpen: false,
    onToggleBottomTerminal: vi.fn(),
    sideChatOpen: false,
    onToggleSideChat: vi.fn(),
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

describe('useWorkspaceTitleBar host entries (BLOCK-253 E1)', () => {
  it('lists center modes/terminal/side-chat and dispatches via one menu', () => {
    const onSwitchWorkspaceMode = vi.fn();
    const onToggleBottomTerminal = vi.fn();
    const onToggleSideChat = vi.fn();
    renderHook((props) => useWorkspaceTitleBar(props), {
      initialProps: options({ onSwitchWorkspaceMode, onToggleBottomTerminal, onToggleSideChat }),
    });
    const patch = updateTitleBar.mock.calls.at(-1)?.[0];
    expect(patch).toBeTruthy();
    if (!patch) return;
    const ids = (patch.toolMenuItems || []).map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining([
      'host:mode:result', 'host:mode:code', 'host:mode:compare', 'host:mode:history',
      'host:terminal', 'host:side-chat',
    ]));
    expect(patch.onSelectToolItem).toBeTruthy();
    const onSelect = patch.onSelectToolItem;
    if (!onSelect) return;
    onSelect('host:terminal');
    expect(onToggleBottomTerminal).toHaveBeenCalledTimes(1);
    onSelect('host:side-chat');
    expect(onToggleSideChat).toHaveBeenCalledTimes(1);
    onSelect('host:mode:compare');
    expect(onSwitchWorkspaceMode).toHaveBeenCalledWith('compare');
  });
});
