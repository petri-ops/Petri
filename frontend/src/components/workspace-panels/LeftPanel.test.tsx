import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeftPanel, type LeftPanelContext } from './LeftPanel';
import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';

vi.mock('@/components/copilot/conversationRunStore', () => ({
  useConversationRun: () => null,
}));

vi.mock('@/components/icons/Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

afterEach(cleanup);

function buildCtx(workspaceMode: WorkspaceMode): LeftPanelContext {
  return {
    width: 280,
    project: { id: 'project-1', name: 'Project One' },
    workspacePath: '/tmp/project-one',
    compactWorkspacePath: '/tmp/project-one',
    visibleProjects: [],
    projectConversations: {},
    projectId: 'project-1',
    conversations: [],
    activeConvId: null,
    expandedProjects: new Set<string>(),
    creatingProject: false,
    creatingConversation: false,
    createPanel: {
      open: false,
      mode: 'manual',
      path: '',
      error: '',
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onPathChange: vi.fn(),
      onConfirm: vi.fn(),
      onRepick: vi.fn(),
      onSwitchManual: vi.fn(),
      onPickExternal: vi.fn(),
    },
    createConversationForProject: vi.fn(),
    renameProject: vi.fn(async () => true),
    renameConversation: vi.fn(async () => true),
    archiveProject: vi.fn(async () => true),
    archiveConversation: vi.fn(async () => true),
    forkConversation: vi.fn(async () => null),
    workspaceMode,
    handleShowSearch: vi.fn(),
    handleShowScheduled: vi.fn(),
    handleShowPlugins: vi.fn(),
    handleShowSettings: vi.fn(),
    handleNavigateToSkills: vi.fn(),
    switchToProject: vi.fn(),
    handleSwitchConversation: vi.fn(),
    toggleProjectExpand: vi.fn(),
    handleOpenWorkspacePath: vi.fn(),
    workspaceEdit: {
      open: false,
      path: '',
      error: '',
      saving: false,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onPathChange: vi.fn(),
      onSave: vi.fn(),
    },
  } as unknown as LeftPanelContext;
}

// LeftPanel 使用 react-router Link（工作台入口），测试统一包 Router
function renderLeftPanel(ctx: LeftPanelContext) {
  return render(
    <MemoryRouter>
      <LeftPanel ctx={ctx} />
    </MemoryRouter>
  );
}

describe('BLOCK-14 LeftPanel QuickActions a11y', () => {
  it('marks search quick-action with aria-current="page" when workspaceMode is search', () => {
    renderLeftPanel(buildCtx('search'));
    const searchBtn = screen.getByRole('button', { name: '搜索' });
    expect(searchBtn.getAttribute('aria-current')).toBe('page');
  });

  // UI-257 — 内联创建面板：路径可粘贴/可编辑，确认回调携带面板输入
  it('renders the inline create panel and fires onConfirm from manual path input', () => {
    const onConfirm = vi.fn();
    const onPathChange = vi.fn();
    const base = buildCtx('chat');
    const ctx = {
      ...base,
      createPanel: {
        ...base.createPanel,
        open: true,
        path: '/tmp/gewu-manual-ws',
        onPathChange,
        onConfirm,
      },
    } as unknown as LeftPanelContext;
    renderLeftPanel(ctx);

    const input = screen.getByLabelText('项目工作目录完整路径') as HTMLInputElement;
    expect(input.value).toBe('/tmp/gewu-manual-ws');
    fireEvent.change(input, { target: { value: '/tmp/edited-ws' } });
    expect(onPathChange).toHaveBeenCalledWith('/tmp/edited-ws');

    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // UI-304 — 创建面板双模式：confirm（系统面板选完目录的确认态）
  it('renders the confirm-mode panel with full path and project name, fires onConfirm/onRepick', () => {
    const onConfirm = vi.fn();
    const onRepick = vi.fn();
    const onSwitchManual = vi.fn();
    const base = buildCtx('chat');
    const ctx = {
      ...base,
      createPanel: {
        ...base.createPanel,
        open: true,
        mode: 'confirm' as const,
        path: '/tmp/gewu-picked-ws',
        onConfirm,
        onRepick,
        onSwitchManual,
      },
    } as unknown as LeftPanelContext;
    renderLeftPanel(ctx);

    expect(screen.getByText('将在以下目录创建项目：')).toBeTruthy();
    expect(screen.getByText('/tmp/gewu-picked-ws')).toBeTruthy();
    expect(screen.getByText('gewu-picked-ws')).toBeTruthy(); // 项目名取自目录名
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '重新选择…' }));
    expect(onRepick).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '手动输入路径' }));
    expect(onSwitchManual).toHaveBeenCalledTimes(1);
    // 确认态不渲染手输输入框
    expect(screen.queryByLabelText('项目工作目录完整路径')).toBeNull();
  });

  it('marks plugins quick-action with aria-current="page" when workspaceMode is plugins', () => {
    renderLeftPanel(buildCtx('plugins'));
    const pluginsBtn = screen.getByRole('button', { name: '插件' });
    expect(pluginsBtn.getAttribute('aria-current')).toBe('page');
  });

  it('marks footer settings button with aria-current="page" when workspaceMode is settings', () => {
    renderLeftPanel(buildCtx('settings'));
    const settingsBtn = screen.getAllByRole('button', { name: '设置' });
    expect(settingsBtn[0].getAttribute('aria-current')).toBe('page');
  });

  it('does not set aria-current="page" on inactive quick-action buttons', () => {
    renderLeftPanel(buildCtx('result'));
    const searchBtn = screen.getByRole('button', { name: '搜索' });
    const pluginsBtn = screen.getByRole('button', { name: '插件' });
    const skillsBtn = screen.getByRole('button', { name: 'Skills' });
    expect(searchBtn.getAttribute('aria-current')).toBeNull();
    expect(pluginsBtn.getAttribute('aria-current')).toBeNull();
    expect(skillsBtn.getAttribute('aria-current')).toBeNull();
  });

  it('preserves the natural Tab order from JSX (no tabindex on quick-action buttons)', () => {
    renderLeftPanel(buildCtx('result'));
    const searchBtn = screen.getByRole('button', { name: '搜索' });
    const pluginsBtn = screen.getByRole('button', { name: '插件' });
    const skillsBtn = screen.getByRole('button', { name: 'Skills' });
    expect(searchBtn.getAttribute('tabindex')).toBeNull();
    expect(pluginsBtn.getAttribute('tabindex')).toBeNull();
    expect(skillsBtn.getAttribute('tabindex')).toBeNull();
  });

  it('exposes all 4 quick-entry buttons by accessible name (3 QuickActions + 1 footer Settings)', () => {
    renderLeftPanel(buildCtx('result'));
    expect(screen.getByRole('button', { name: '搜索' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '插件' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skills' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '设置' })).toHaveLength(1);
  });
});

// ============================================================================
// UI-304 加映 — browse 模式：+ 直接打开应用内 FolderPicker（不经系统面板，
// Electron 30 在 macOS 26 上「打开」按钮置灰），选定后直达确认态回调。
// ============================================================================
describe('UI-304 browse-mode create panel (left panel)', () => {
  const originalDesktop = (window as { biof3Desktop?: unknown }).biof3Desktop;

  afterEach(() => {
    Object.defineProperty(window, 'biof3Desktop', {
      configurable: true,
      value: originalDesktop,
    });
  });

  function mockListDirectory(data: unknown) {
    Object.defineProperty(window, 'biof3Desktop', {
      configurable: true,
      value: {
        files: {
          listDirectory: vi.fn(async () => ({ ok: true, data })),
        },
      },
    });
  }

  it('renders the in-app FolderPicker and routes 选择此文件夹 through onPickExternal', async () => {
    mockListDirectory({ path: '/tmp/gewu-ws', parent: null, home: '/tmp/gewu-ws', dirs: [] });
    const onPickExternal = vi.fn();
    const onSwitchManual = vi.fn();
    const base = buildCtx('chat');
    const ctx = {
      ...base,
      createPanel: {
        ...base.createPanel,
        open: true,
        mode: 'browse' as const,
        onPickExternal,
        onSwitchManual,
      },
    } as unknown as LeftPanelContext;
    renderLeftPanel(ctx);

    // 应用内选择器渲染（非系统面板）
    expect(await screen.findByTestId('folder-picker')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /选择此文件夹/ }));
    await vi.waitFor(() => {
      expect(onPickExternal).toHaveBeenCalledWith('/tmp/gewu-ws');
    });
    fireEvent.click(screen.getByRole('button', { name: '粘贴路径' }));
    expect(onSwitchManual).toHaveBeenCalledTimes(1);
  });
});
// ============================================================================
// BLOCK-53 P1 / UI-282 — 拖拽目录直达创建：drop 到左栏 → validateDirectory
// 校验 → 打开既有内联创建面板（ctx.createPanel）并回填路径（不绕过确认链）。
// ============================================================================
describe('BLOCK-53 P1 drag-to-create (left panel)', () => {
  const originalDesktop = (window as { biof3Desktop?: unknown }).biof3Desktop;

  afterEach(() => {
    Object.defineProperty(window, 'biof3Desktop', {
      configurable: true,
      value: originalDesktop,
    });
  });

  function mockDesktop(validate: (path: string) => unknown) {
    Object.defineProperty(window, 'biof3Desktop', {
      configurable: true,
      value: {
        files: {
          validateDirectory: vi.fn(validate),
          pathForFile: vi.fn(() => '/tmp/dropped-ws'),
        },
      },
    });
  }

  it('drop a directory → opens the create panel with the validated path', async () => {
    mockDesktop(() => ({ ok: true, data: { path: '/tmp/dropped-ws' } }));
    const base = buildCtx('chat');
    const ctx = {
      ...base,
      createPanel: { ...base.createPanel, open: false },
    } as unknown as LeftPanelContext;
    const { container } = renderLeftPanel(ctx);

    const wrap = container.querySelector('[class*="leftPanelWrap"]') as HTMLElement;
    expect(wrap).not.toBeNull();
    fireEvent.drop(wrap, { dataTransfer: { files: [{ name: 'dropped-ws' }] } });

    await vi.waitFor(() => {
      // UI-304 — 拖拽经 onPickExternal 直达确认态，不绕过确认环节
      expect(ctx.createPanel.onPickExternal).toHaveBeenCalledWith('/tmp/dropped-ws');
      expect(ctx.createPanel.onOpen).not.toHaveBeenCalled();
    });
  });

  it('drop a non-directory file → shows the validation error, panel stays closed', async () => {
    mockDesktop(() => ({ ok: false, error: '该路径不是文件夹' }));
    const base = buildCtx('chat');
    const ctx = {
      ...base,
      createPanel: { ...base.createPanel, open: false },
    } as unknown as LeftPanelContext;
    const { container } = renderLeftPanel(ctx);

    const wrap = container.querySelector('[class*="leftPanelWrap"]') as HTMLElement;
    fireEvent.drop(wrap, { dataTransfer: { files: [{ name: 'note.txt' }] } });

    expect(await screen.findByText('该路径不是文件夹')).toBeTruthy();
    expect(ctx.createPanel.onPickExternal).not.toHaveBeenCalled();
    expect(ctx.createPanel.onOpen).not.toHaveBeenCalled();
    expect(ctx.createPanel.onPathChange).not.toHaveBeenCalled();
  });
});
