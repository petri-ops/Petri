import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeftPanel, type LeftPanelContext } from './LeftPanel';
import type { Project } from '@/lib/project-types';
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
    project: {
      id: 'project-1',
      name: 'Project One',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
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
      open: false, // UI-304 简化版 — 不再需要面板
      error: '',
      onOpen: vi.fn(),
      onPickExternal: vi.fn(),
    },
    createConversationForProject: vi.fn(),
    renameProject: vi.fn(async () => true),
    renameConversation: vi.fn(async () => true),
    archiveProject: vi.fn(async () => true),
    archiveConversation: vi.fn(async () => true),
    forkConversation: vi.fn(async () => null),
    workspaceMode,
    sshConnectProject: vi.fn(),
    sshConnectHost: vi.fn(async () => ({ ok: true, home: '/root' })),
    sshListDirs: vi.fn(async () => ({ ok: true, path: '/root', dirs: [{ name: 'gewu-block67-demo', path: '/root/gewu-block67-demo' }] })),
    sshRegisterHost: vi.fn(async () => ({ ok: true, alias: 'gewu-1-2-3-4' })),
    sshCreateAt: vi.fn(async () => ({ ok: true })),
    handleShowSearch: vi.fn(),
    handleShowScheduled: vi.fn(),
    handleShowPlugins: vi.fn(),
    handleShowSettings: vi.fn(),
    handleNavigateToSkills: vi.fn(),
    handleNavigateToKnowledge: vi.fn(),
    handleNavigateToBackend: vi.fn(),
    switchToProject: vi.fn(),
    handleSwitchConversation: vi.fn(),
    toggleProjectExpand: vi.fn(),
    handleOpenWorkspacePath: vi.fn(),
    showConversations: true,
  };
}

describe('BLOCK-14 LeftPanel QuickActions a11y', () => {
  it('marks search quick-action with aria-current="page" when workspaceMode is search', () => {
    const ctx = buildCtx('search');
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>
    );
    const searchBtn = screen.getByRole('button', { name: /搜索/ });
    expect(searchBtn.getAttribute('aria-current')).toBe('page');
  });

  it('calls onOpen when the + button is clicked (UI-304 简化版 - 直接触发原生面板)', () => {
    const ctx = buildCtx('chat');
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>
    );
    const plusBtn = screen.getByRole('button', { name: /新建项目/ });
    fireEvent.click(plusBtn);
    expect(ctx.createPanel.onOpen).toHaveBeenCalled();
  });

  it('displays error message when createPanel.error is set', () => {
    const ctx = buildCtx('chat');
    ctx.createPanel.error = '路径无效';
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>
    );
    // UI-304 简化版 — 错误会显示在面板中
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('路径无效');
  });

  it('renders project tree rows for visibleProjects (ProjectNode 回归)', () => {
    const ctx = buildCtx('chat');
    ctx.visibleProjects = [ctx.project];
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>
    );
    expect(screen.getByText('Project One').textContent).toBe('Project One');
    expect(screen.getByRole('button', { name: /创建新对话/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /移入回收站/ })).toBeTruthy();
  });
});

// BLOCK-67 加映（UI-325）— ssh 项目树标识 + 「远程连接」入口
describe('BLOCK-67 左栏 ssh 项目标识与远程连接', () => {
  it('ssh 项目树行有 远程连接 按钮，点击触发 sshConnectProject', () => {
    const ctx = buildCtx('chat');
    ctx.visibleProjects = [{
      ...ctx.project,
      workspaceKind: 'ssh',
      sshHost: 'aliyun',
      remotePath: '/root/gewu-block67-demo',
    } as typeof ctx.project];
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    const connectBtn = screen.getByRole('button', { name: /远程连接 · aliyun/ });
    fireEvent.click(connectBtn);
    expect(ctx.sshConnectProject).toHaveBeenCalledTimes(1);
    const calledWith = (ctx.sshConnectProject as unknown as { mock: { calls: Array<[Project]> } }).mock.calls[0][0];
    expect(calledWith.sshHost).toBe('aliyun');
  });

  it('local 项目树行没有 远程连接 按钮', () => {
    const ctx = buildCtx('chat');
    ctx.visibleProjects = [ctx.project];
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /远程连接/ })).toBeNull();
  });
});

describe('UI-327 左栏 globe 行内创建向导', () => {
  it('别名模式：连接 → sshConnectHost；进入选路径步 → 目录浏览渲染', async () => {
    const ctx = buildCtx('chat');
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '新建 SSH 远程项目' }));
    const panel = screen.getByTestId('left-ssh-create-panel');
    const setVal = (label: string, v: string) => {
      const input = panel.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setVal('SSH 主机别名', 'aliyun');
    fireEvent.click(screen.getByText('连接'));
    await waitFor(() => expect(ctx.sshConnectHost).toHaveBeenCalledWith('aliyun'));
    await waitFor(() => expect(ctx.sshListDirs).toHaveBeenCalledWith('aliyun', '/root'));
    await waitFor(() => expect(screen.getByTestId('ssh-connected-chip').textContent).toBe('aliyun'));
    expect(screen.getByTestId('ssh-selected-path').textContent).toBe('/root');
    expect(screen.getByText('gewu-block67-demo/')).toBeTruthy();
  });

  it('IP+密码模式：出现密码字段（type=password）与 IP/端口/用户名', () => {
    const ctx = buildCtx('chat');
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '新建 SSH 远程项目' }));
    fireEvent.click(screen.getByRole('tab', { name: 'IP + 密码' }));
    const panel = screen.getByTestId('left-ssh-create-panel');
    expect((panel.querySelector('input[aria-label^="SSH 密码"]') as HTMLInputElement).type).toBe('password');
    expect(panel.querySelector('input[aria-label="主机 IP 或域名"]')).toBeTruthy();
    expect(panel.querySelector('input[aria-label="SSH 端口"]')).toBeTruthy();
    expect(panel.querySelector('input[aria-label="SSH 用户名"]')).toBeTruthy();
  });

  it('选路径步：点击「在此目录创建项目」触发 sshCreateAt', async () => {
    const ctx = buildCtx('chat');
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '新建 SSH 远程项目' }));
    const panel = screen.getByTestId('left-ssh-create-panel');
    const setVal = (label: string, v: string) => {
      const input = panel.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setVal('SSH 主机别名', 'aliyun');
    fireEvent.click(screen.getByText('连接'));
    await waitFor(() => expect(screen.getByText('在此目录创建项目')).toBeTruthy());
    fireEvent.click(screen.getByText('在此目录创建项目'));
    await waitFor(() => expect(ctx.sshCreateAt).toHaveBeenCalledWith({ alias: 'aliyun', remotePath: '/root' }));
  });
});
