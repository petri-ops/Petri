// UI-446 v4 — 审阅 tab 计数徽章（红绿先行：由 dot 升格为未审文件数计数）。
// 语义：当前会话有未看工作区改动 → 徽章显示未审文件数；打开审阅 tab 即 acknowledge 归零。
// 不复活 2026-09-09 被用户裁决移除的聊天区卡片（c0e92dd0）——徽章只服务右栏入口。
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TitleBarRightZone } from './TitleBarRightZone';
import type { TitleBarTab, TitleBarToolItem } from '@/hooks/useWorkspacePanels';

vi.mock('@/components/desktop/WorkspacePanelsContext', () => ({
  useWorkspacePanelsContext: () => mockPanels,
}));

const mockPanels = {
  rightOpen: true,
  titleBar: {
    tabs: [] as TitleBarTab[],
    activeTabId: 'files' as string | null,
    reviewCount: 0,
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onMoreAction: vi.fn(),
    toolMenuOpen: false,
    toolMenuItems: [] as TitleBarToolItem[],
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

describe('TitleBarRightZone 审阅 tab 计数徽章（UI-446 v4）', () => {
  it('tab.reviewCount>0 → 药丸渲染计数徽章', () => {
    mountWithTabs([
      { id: 'files', label: '文件', icon: 'folder', closable: true },
      { id: 'review', label: '审阅', icon: 'git-branch', closable: true, reviewCount: 3 },
    ]);
    expect(screen.getByTestId('review-tab-count').textContent).toBe('3');
  });

  it('tab.reviewCount 缺省/0 → 不渲染徽章', () => {
    mountWithTabs([
      { id: 'review', label: '审阅', icon: 'git-branch', closable: true, reviewCount: 0 },
    ]);
    expect(screen.queryByTestId('review-tab-count')).toBeNull();
  });

  it('审阅 tab 未打开 + titleBar.reviewCount>0 → 「+」按钮亮计数徽章', () => {
    mockPanels.titleBar.reviewCount = 2;
    try {
      mountWithTabs([{ id: 'files', label: '文件', icon: 'folder', closable: true }]);
      expect(screen.getByTestId('review-menu-count').textContent).toBe('2');
      expect(screen.queryByTestId('review-tab-count')).toBeNull();
    } finally {
      mockPanels.titleBar.reviewCount = 0;
    }
  });

  it('审阅 tab 未打开 + reviewCount=0 → 「+」按钮不得渲染「0」（用户实测抓真）', () => {
    mockPanels.titleBar.reviewCount = 0;
    try {
      mountWithTabs([{ id: 'files', label: '文件', icon: 'folder', closable: true }]);
      expect(screen.queryByTestId('review-menu-count')).toBeNull();
      expect(screen.queryByText(/^0$/)).toBeNull();
    } finally {
      mockPanels.titleBar.reviewCount = 0;
    }
  });

  it('审阅 tab 已打开 + 有未读 → 徽章在药丸，「+」按钮不亮', () => {
    mockPanels.titleBar.reviewCount = 2;
    try {
      mountWithTabs([
        { id: 'files', label: '文件', icon: 'folder', closable: true },
        { id: 'review', label: '审阅', icon: 'git-branch', closable: true, reviewCount: 2 },
      ]);
      expect(screen.getByTestId('review-tab-count')).toBeTruthy();
      expect(screen.queryByTestId('review-menu-count')).toBeNull();
    } finally {
      mockPanels.titleBar.reviewCount = 0;
    }
  });
});
