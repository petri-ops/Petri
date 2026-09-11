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

function buildCtx(workspaceMode: WorkspaceMode): LeftPanelContext & { project: Project } {
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
    handleNavigateToHome: vi.fn(),
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

// UI-331 — 左栏会话行短式相对时间
describe('UI-331 左栏会话行相对时间', () => {
  it('会话行右侧显示短式相对时间（刚刚 / 7小时）', () => {
    const ctx = buildCtx('chat');
    const now = Date.now();
    ctx.visibleProjects = ctx.project ? [ctx.project] : [];
    ctx.expandedProjects = new Set(['project-1']);
    ctx.conversations = [
      { id: 'conv_now', title: '刚刚的会话', status: 'active', last_page: null, message_count: 1, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() },
      { id: 'conv_old', title: '七小时前的会话', status: 'active', last_page: null, message_count: 2, created_at: new Date(now).toISOString(), updated_at: new Date(now - 7 * 3600 * 1000).toISOString() },
    ] as LeftPanelContext['conversations'];
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>
    );
    expect(screen.getByText('刚刚')).toBeTruthy();
    expect(screen.getByText('7小时')).toBeTruthy();
    expect(screen.getAllByTitle(/更新于/)).toHaveLength(2);
  });

  it('会话行时间按天降级（3天前 → 3天）', () => {
    const ctx = buildCtx('chat');
    const now = Date.now();
    ctx.visibleProjects = ctx.project ? [ctx.project] : [];
    ctx.expandedProjects = new Set(['project-1']);
    ctx.conversations = [
      { id: 'conv_3d', title: '三天前的会话', status: 'active', last_page: null, message_count: 1, created_at: new Date(now).toISOString(), updated_at: new Date(now - 3 * 24 * 3600 * 1000).toISOString() },
    ] as LeftPanelContext['conversations'];
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>
    );
    expect(screen.getByText('3天')).toBeTruthy();
  });
});

  it('renders project tree rows for visibleProjects (ProjectNode 回归)', () => {
    const ctx = buildCtx('chat');
    ctx.visibleProjects = ctx.project ? [ctx.project] : [];
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
      ...(ctx.project as NonNullable<typeof ctx.project>),
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
    ctx.visibleProjects = ctx.project ? [ctx.project] : [];
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /远程连接/ })).toBeNull();
  });
});

describe('UI-327 左栏 globe 行内创建向导（终端式路径输入）', () => {
  it('别名模式：连接 → 进入终端式路径步（输入预填 $HOME/、候选自动加载）', async () => {
    const ctx = buildCtx('chat');
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '新建 SSH 远程项目' }));
    const panel = screen.getByTestId('left-ssh-create-panel');
    const setVal = (el: HTMLInputElement, v: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setVal(panel.querySelector('input[aria-label="SSH 主机别名"]') as HTMLInputElement, 'aliyun');
    fireEvent.click(screen.getByText('连接'));
    const pathInput = (await waitFor(() => {
      const el = panel.querySelector('[data-testid="ssh-path-input"]') as HTMLInputElement;
      expect(el.value).toBe('/root/');
      return el;
    })) as HTMLInputElement;
    expect(ctx.sshListDirs).toHaveBeenCalledWith('aliyun', '/root');
    await waitFor(() => expect(screen.getByText('/root/gewu-block67-demo/')).toBeTruthy());
    void pathInput;
  });

  it('Tab 补全：输入 /root/ge → Tab → 自动完成 /root/gewu-block67-demo/', async () => {
    const ctx = buildCtx('chat');
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '新建 SSH 远程项目' }));
    const panel = screen.getByTestId('left-ssh-create-panel');
    fireEvent.click(screen.getByText('连接'));
    const pathInput = (await waitFor(() => {
      const el = panel.querySelector('[data-testid="ssh-path-input"]') as HTMLInputElement;
      expect(el.value).toBe('/root/');
      return el;
    })) as HTMLInputElement;
    const setVal = (v: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(pathInput, v);
      pathInput.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setVal('/root/ge');
    fireEvent.keyDown(pathInput, { key: 'Tab', bubbles: true, cancelable: true });
    await waitFor(() => expect(pathInput.value).toBe('/root/gewu-block67-demo/'));
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

  it('在此路径创建项目：尾斜杠归一后触发 sshCreateAt', async () => {
    const ctx = buildCtx('chat');
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '新建 SSH 远程项目' }));
    const panel = screen.getByTestId('left-ssh-create-panel');
    const aliasInput = panel.querySelector('input[aria-label="SSH 主机别名"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(aliasInput, 'aliyun');
    aliasInput.dispatchEvent(new Event('input', { bubbles: true }));
    fireEvent.click(screen.getByText('连接'));
    await waitFor(() => expect(screen.getByRole('button', { name: '创建项目' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));
    await waitFor(() => expect(ctx.sshCreateAt).toHaveBeenCalledWith({ alias: 'aliyun', remotePath: '/root' }));
  });
});

describe('UI-327 Tab 多候选：补全到公共前缀', () => {
  it('多候选匹配同一前缀时 Tab 补全到公共段，不误选', async () => {
    const ctx = buildCtx('chat');
    ctx.sshListDirs = vi.fn(async () => ({
      ok: true, path: '/root',
      dirs: [
        { name: 'gewu-a', path: '/root/gewu-a' },
        { name: 'gewu-b', path: '/root/gewu-b' },
      ],
    }));
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '新建 SSH 远程项目' }));
    const panel = screen.getByTestId('left-ssh-create-panel');
    fireEvent.click(screen.getByText('连接'));
    const pathInput = (await waitFor(() => {
      const el = panel.querySelector('[data-testid="ssh-path-input"]') as HTMLInputElement;
      expect(el.value).toBe('/root/');
      return el;
    })) as HTMLInputElement;
    const setVal = (v: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(pathInput, v);
      pathInput.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setVal('/root/ge');
    fireEvent.keyDown(pathInput, { key: 'Tab', bubbles: true, cancelable: true });
    await waitFor(() => expect(pathInput.value).toBe('/root/gewu-'));
  });
});

// UI-335 — 「新建任务」归组至工作台快捷区首位（UI-328 悬浮行退役）
describe('UI-335 新建任务在工作台分组内', () => {
  it('「新建任务」位于工作台快捷区首位，点击回工作台创建页', () => {
    const ctx = buildCtx('chat');
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    const btn = screen.getByRole('button', { name: '新建任务' });
    fireEvent.click(btn);
    expect(ctx.handleNavigateToHome).toHaveBeenCalledTimes(1);
    // 归组断言：工作台标签之后、搜索之前
    const group = btn.closest('[class*="leftQuickActions"]');
    expect(group?.textContent.indexOf('新建任务')).toBeLessThan(group!.textContent.indexOf('搜索'));
    expect(group?.textContent).toContain('工作台');
  });
});
