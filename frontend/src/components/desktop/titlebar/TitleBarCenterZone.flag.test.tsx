// item 90 阶段一完善 HK-01——标题栏「结果 N」pill flag off 隐藏 / flag on 恢复。
// pill 数据源=conversationJobs（产物统计），但点击行为是打开结果面（RS 入口）——
// flag off 时入口一并隐藏（保留但换数据源属 owner 裁决项，见交付报告）。
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({ enabled: false }));

vi.mock('@/lib/resultStudioFlag', () => ({
  useResultStudioEnabled: () => state.enabled,
}));

vi.mock('../WorkspacePanelsContext', () => ({
  useWorkspacePanelsContext: () => ({
    titleBar: {
      tabs: [],
      activeTabId: null,
      onSelectTab: () => undefined,
      onCloseTab: () => undefined,
      onCloseOtherTabs: () => undefined,
      onCloseTabsToRight: () => undefined,
      onCloseAllTabs: () => undefined,
      resultItems: [
        { id: 'job-1', label: '演示分析', status: '完成 · 11/27 12:00' },
        { id: 'job-2', label: '演示分析 2', status: '运行中 · 11/27 12:05' },
      ],
    },
  }),
}));

vi.mock('@/components/branch/BranchTabsWrapper', () => ({
  BranchTabsWrapper: () => <div data-testid="branch-tabs-stub" />,
}));

vi.mock('@/components/desktop/titlebar/NotificationCenterBell', () => ({
  NotificationCenterBell: () => <div data-testid="bell-stub" />,
}));

vi.mock('@/components/desktop/titlebar/UpdatePill', () => ({
  UpdatePill: () => <div data-testid="update-pill-stub" />,
}));

import { TitleBarCenterZone } from './TitleBarCenterZone';

function renderZone(): void {
  render(
    <MemoryRouter initialEntries={['/project/demo_proj_workbench']}>
      <TitleBarCenterZone />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  state.enabled = false;
});

describe('标题栏「结果 N」pill flag 门控（item 90 阶段一完善）', () => {
  it('HK-90c-1：flag off → pill 不可见（无「结果 N」按钮/菜单）', () => {
    renderZone();
    expect(screen.queryByText(/结果 \d+/)).toBeNull();
    expect(screen.queryByTestId('resultPicker')).toBeNull();
    expect(document.querySelector('[class*=resultPicker]')).toBeNull();
  });

  it('HK-90c-2：flag on → pill 恢复（「结果 2」按钮 + 下拉触发器）', () => {
    state.enabled = true;
    renderZone();
    expect(screen.getByText(/结果 \d+/)).toBeTruthy();
    expect(document.querySelector('[class*=resultPicker]')).not.toBeNull();
  });
});
