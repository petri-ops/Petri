// UI-446 — 审阅 tab 圆点渲染（BLOCK-123 G-01）：TitleBarTab.dot 在右栏 tab 药丸上的呈现。
// 红绿先行：本文件先于 dot 字段实现落盘。
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TitleBarRightZone } from './TitleBarRightZone';
import type { TitleBarTab } from '@/hooks/useWorkspacePanels';

vi.mock('@/components/desktop/WorkspacePanelsContext', () => ({
  useWorkspacePanelsContext: () => mockPanels,
}));

const mockPanels = {
  rightOpen: true,
  titleBar: {
    tabs: [] as TitleBarTab[],
    activeTabId: 'files' as string | null,
    reviewDot: false,
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onMoreAction: vi.fn(),
    toolMenuOpen: false,
    toolMenuItems: [],
    onSelectToolItem: vi.fn(),
  },
};

function mountWithTabs(tabs: TitleBarTab[]): void {
  mockPanels.titleBar.tabs = tabs;
  // 工作区路由（/project/:id）才渲染 tab pills 药丸条（parseWorkspaceRoute 判定）
  render(
    <MemoryRouter initialEntries={['/project/p_ui446']}>
      <TitleBarRightZone />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('TitleBarRightZone 审阅 tab 圆点（UI-446）', () => {
  it('tab.dot=true → 圆点渲染在场', () => {
    mountWithTabs([
      { id: 'files', label: '文件', icon: 'folder', closable: true },
      { id: 'review', label: '审阅', icon: 'git-branch', closable: true, dot: true },
    ]);
    expect(screen.getByTestId('review-tab-dot')).toBeTruthy();
  });

  it('tab.dot 缺省/false → 不渲染圆点', () => {
    mountWithTabs([
      { id: 'review', label: '审阅', icon: 'git-branch', closable: true, dot: false },
    ]);
    expect(screen.queryByTestId('review-tab-dot')).toBeNull();
  });

  // UI-446 v2（G-01 用户实测抓真：审阅 tab 未打开时圆点无处可挂）——
  // 圆点升格挂「+」工具菜单按钮：审阅 tab 未开 + reviewDot → 菜单钮亮圆点
  it('审阅 tab 未打开 + reviewDot → 「+」按钮亮引导圆点', () => {
    mockPanels.titleBar.reviewDot = true;
    try {
      mountWithTabs([{ id: 'files', label: '文件', icon: 'folder', closable: true }]);
      expect(screen.getByTestId('review-menu-dot')).toBeTruthy();
      expect(screen.queryByTestId('review-tab-dot')).toBeNull();
    } finally {
      mockPanels.titleBar.reviewDot = false;
    }
  });

  it('审阅 tab 已打开 → 圆点回药丸，「+」按钮不亮', () => {
    mockPanels.titleBar.reviewDot = true;
    try {
      mountWithTabs([
        { id: 'files', label: '文件', icon: 'folder', closable: true },
        { id: 'review', label: '审阅', icon: 'git-branch', closable: true, dot: true },
      ]);
      expect(screen.getByTestId('review-tab-dot')).toBeTruthy();
      expect(screen.queryByTestId('review-menu-dot')).toBeNull();
    } finally {
      mockPanels.titleBar.reviewDot = false;
    }
  });
});
