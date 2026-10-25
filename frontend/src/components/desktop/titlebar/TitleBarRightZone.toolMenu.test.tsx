// BLOCK-257 — 宿主「更多工具」菜单 portal 回归。
// 历史缺陷：菜单留在 titlebar 容器内，被列级 header 的 overflow/层叠裁切；
// 终端打开后再次点「+」菜单不可见。根修=portal 到 document.body + fixed 定位。
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TitleBarRightZone } from './TitleBarRightZone';

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
