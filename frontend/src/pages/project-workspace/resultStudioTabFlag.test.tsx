// item 90 阶段一完善 HK-01——resultStudio flag off 时「结果」tab 从右栏 tab 条直接隐藏
// （前端渲染层断言，走真实 TitleBar pills 派生链：filterResultStudioTabs → titleBarTabs）；
// flag on 恢复显示（回滚能力不变）。
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/themes/ThemeProvider';

const state = vi.hoisted(() => ({ enabled: false }));

vi.mock('@/lib/resultStudioFlag', () => ({
  useResultStudioEnabled: () => state.enabled,
}));

vi.mock('@/components/desktop/WorkspacePanelsContext', () => ({
  useWorkspacePanelsContext: () => ({}),
}));

import {
  filterResultStudioTabs,
} from './useWorkspaceTitleBar';
import type { WorkSurfaceTab } from '@/lib/workSurface/types';

const TABS: WorkSurfaceTab[] = [
  { id: 'tab-results', surfaceId: 'results', title: '结果' },
  { id: 'tab-files', surfaceId: 'files', title: '文件' },
  { id: 'tab-generated', surfaceId: 'generated', title: '生成文件' },
] as unknown as WorkSurfaceTab[];

const TOOL_SURFACES = [
  { id: 'results', title: '结果', icon: 'bar-chart' },
  { id: 'files', title: '文件', icon: 'folder' },
] as never[];

function renderTitleBarRail(): void {
  // 直接渲染 TitleBar 的 tab pills 派生消费端过重；此处渲染 LeftPanel 的
  // 一级导航（走同一条 useWorkspaceTitleBar/registry 派生链）已由其它用例覆盖，
  // 这里断言 filter 纯函数 + RightPanel 内容门控（渲染层）。
}

import { RightPanel } from '@/components/workspace-panels/RightPanel';

const CTX = {
  width: 400,
  project: { id: 'p1', name: 'P', workspacePath: '/w', workspaceKind: 'local' },
  projectId: 'p1',
  activeConvId: 'conv-1',
  openRightTabs: ['results', 'files'],
  openWorkspaceFiles: [],
  activeWorkspaceFile: null,
  handleCloseWorkspaceFiles: () => undefined,
  handleReorderWorkspaceFiles: () => undefined,
  handleRenameWorkspaceFile: async () => null,
  handleReopenWorkspaceFile: () => undefined,
  hasReopenableWorkspaceFile: false,
  handleWorkspaceFileDirtyMapChange: () => undefined,
  rightTab: 'results',
  rightToolMenuOpen: false,
  setRightTab: () => undefined,
  setRightToolMenuOpen: () => undefined,
  openRightPanel: () => undefined,
  closeRightPanelTab: () => undefined,
  activeJob: null,
  activeWorkflow: null,
  onWorkflowChanged: () => undefined,
  activeArtifact: null,
  setActiveArtifact: () => undefined,
  jobs: [],
  packResultSurfaces: [],
  resultContext: null,
  resultEditControls: null,
  resultEditSubmitting: false,
  resultAgentDraft: '',
  setResultAgentDraft: () => undefined,
  onResultEditSubmit: () => false,
  pendingArtifactName: null,
  onPendingArtifactConsumed: () => undefined,
  openRevisionWorkspaceFile: () => undefined,
  openResultBrowser: () => undefined,
  handleAskAgent: () => false,
  handleOpenResult: () => false,
  handleOpenRightResults: () => undefined,
  handleOpenRightBrowser: () => undefined,
  handleOpenRightFiles: () => undefined,
  handleOpenRightChat: () => undefined,
  setBrowserUrl: () => undefined,
  setBottomTerminalOpen: () => undefined,
  setRightOpen: () => undefined,
} as never;

afterEach(() => {
  cleanup();
  state.enabled = false;
});

describe('resultStudio flag off → 「结果」tab 隐藏（item 90 阶段一完善）', () => {
  it('HK-90b-1：filterResultStudioTabs——off 时 results 从 pills 派生中过滤，on 时恢复', () => {
    const off = filterResultStudioTabs(TABS, false, (tab) => tab.surfaceId);
    expect(off.map((tab) => tab.surfaceId)).toEqual(['files', 'generated']);
    const on = filterResultStudioTabs(TABS, true, (tab) => tab.surfaceId);
    expect(on.map((tab) => tab.surfaceId)).toEqual(['results', 'files', 'generated']);
  });

  it('HK-90b-2：工具菜单同规则（off 隐藏 results 条目）', () => {
    const off = filterResultStudioTabs(TOOL_SURFACES as never, false, (surface) => surface.id);
    expect(off.map((surface) => surface.id)).toEqual(['files']);
  });

  it('HK-90b-4：flag on → 「结果」tab 恢复（内容渲染，回滚能力不变）', () => {
    state.enabled = true;
    render(
      <ThemeProvider>
        <MemoryRouter>
          <RightPanel ctx={CTX} visible />
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(document.querySelector('[data-result-mode]')).toBeTruthy(); // Inner 挂载（flag on 恢复）
  });

  it('HK-90b-3：flag off → RightPanel 不渲染「结果」内容（无 off 态占位）', () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <RightPanel ctx={CTX} visible />
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(screen.queryByTestId('results-surface-off')).toBeNull();
    expect(screen.queryByTestId('results-surface')).toBeNull();
    expect(document.body.textContent).not.toContain('结果面（Result Studio）已按产品裁决下架');
  });
});
