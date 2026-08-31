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
      path: '',
      error: '',
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onPathChange: vi.fn(),
      onConfirm: vi.fn(),
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
        path: '/tmp/biof3-manual-ws',
        onPathChange,
        onConfirm,
      },
    } as unknown as LeftPanelContext;
    renderLeftPanel(ctx);

    const input = screen.getByLabelText('项目工作目录完整路径') as HTMLInputElement;
    expect(input.value).toBe('/tmp/biof3-manual-ws');
    fireEvent.change(input, { target: { value: '/tmp/edited-ws' } });
    expect(onPathChange).toHaveBeenCalledWith('/tmp/edited-ws');

    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
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
