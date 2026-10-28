// BLOCK-257 — 宿主「更多工具」菜单 portal 回归。
// 历史缺陷：菜单留在 titlebar 容器内，被列级 header 的 overflow/层叠裁切；
// 终端打开后再次点「+」菜单不可见。根修=portal 到 document.body + fixed 定位。
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TitleBarRightZone, tabStripShouldCompact } from './TitleBarRightZone';

vi.mock('@/components/desktop/WorkspacePanelsContext', () => ({
  useWorkspacePanelsContext: () => mockPanels,
}));

const mockPanels = {
  rightOpen: true,
  titleBar: {
    tabs: [],
    activeTabId: null as string | null,
    reviewCount: 0,
    reviewStat: null as { added: number; removed: number } | null,
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onMoreAction: vi.fn(),
    toolMenuOpen: true,
    toolMenuItems: [
      { id: 'host:terminal', label: '终端', icon: 'terminal' as const, isOpen: true },
    ],
    onSelectToolItem: vi.fn(),
  },
};

afterEach(cleanup);

describe('TitleBarRightZone 工具菜单（BLOCK-257 宿主菜单复开缺陷回归）', () => {
  it('菜单 portal 到 document.body，不留在可能被裁切的列头容器内', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/project/p_b257_toolmenu']}>
        <TitleBarRightZone />
      </MemoryRouter>,
    );
    const menu = document.getElementById('titlebar-tool-menu');
    expect(menu).toBeTruthy();
    expect(menu?.parentElement).toBe(document.body);
    expect(container.querySelector('#titlebar-tool-menu')).toBeNull();
  });

  it('菜单用 fixed 定位且终端项在场（终端打开后复开同一入口）', () => {
    render(
      <MemoryRouter initialEntries={['/project/p_b257_toolmenu']}>
        <TitleBarRightZone />
      </MemoryRouter>,
    );
    const menu = screen.getByRole('menu');
    expect(menu.style.position).toBe('fixed');
    expect(screen.getByRole('menuitem', { name: /终端/ })).toBeTruthy();
    expect(screen.getByLabelText('关闭工具菜单')).toBeTruthy();
  });
});

describe('tabStripShouldCompact（UI-615 右栏顶部标签条自适应）', () => {
  it('单标签/布局未就绪（宽 0）不折叠', () => {
    expect(tabStripShouldCompact(['文件'], 80)).toBe(false);
    expect(tabStripShouldCompact(['文件', '浏览器', '分析'], 0)).toBe(false);
  });

  it('三标签窄栏折叠为图标，宽栏保持全标签', () => {
    expect(tabStripShouldCompact(['文件', '浏览器', '分析'], 190)).toBe(true);
    expect(tabStripShouldCompact(['文件', '浏览器', '分析'], 900)).toBe(false);
  });

  it('长标签/多标签按估算宽度更早折叠', () => {
    expect(tabStripShouldCompact(['分析结果对比', '浏览器', '审阅'], 300)).toBe(true);
    expect(tabStripShouldCompact(['文件', '浏览器'], 400)).toBe(false);
  });
});
