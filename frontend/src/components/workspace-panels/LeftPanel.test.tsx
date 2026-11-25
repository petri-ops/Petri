import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeftPanel, type LeftPanelContext } from './LeftPanel';
import type { Project } from '@/lib/project-types';
import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';

vi.mock('@/components/copilot/conversationRunStore', () => ({
  useConversationRun: () => null,
}));

vi.mock('@/components/copilot/copilotConversationsClient', () => ({
  listConversations: vi.fn(() => Promise.resolve([
    { id: 'conv-deseq2', title: 'DESeq2 结果解读', status: 'active', last_page: null, message_count: 4, created_at: '2026-09-26T00:00:00.000Z', updated_at: '2026-09-26T00:00:00.000Z', project_id: 'project-2' },
    { id: 'conv-deseq2-extra', title: 'DESeq2 补充分析', status: 'active', last_page: null, message_count: 2, created_at: '2026-09-26T00:00:00.000Z', updated_at: '2026-09-26T00:00:00.000Z', project_id: null },
    { id: 'conv-chat', title: '闲聊一条', status: 'active', last_page: null, message_count: 1, created_at: '2026-09-26T00:00:00.000Z', updated_at: '2026-09-26T00:00:00.000Z', project_id: 'project-1' },
  ])),
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
    renameProject: vi.fn(() => Promise.resolve(true)),
    renameConversation: vi.fn(() => Promise.resolve(true)),
    archiveProject: vi.fn(() => Promise.resolve(true)),
    archiveConversation: vi.fn(() => Promise.resolve(true)),
    forkConversation: vi.fn(() => Promise.resolve(null)),
    workspaceMode,
    sshConnectProject: vi.fn(),
    sshConnectHost: vi.fn(() => Promise.resolve({ ok: true, home: '/root' })),
    sshListDirs: vi.fn(() => Promise.resolve({ ok: true, path: '/root', dirs: [{ name: 'petri-block67-demo', path: '/root/petri-block67-demo' }] })),
    sshRegisterHost: vi.fn(() => Promise.resolve({ ok: true, alias: 'petri-1-2-3-4' })),
    sshCreateAt: vi.fn(() => Promise.resolve({ ok: true })),
    handleShowScheduled: vi.fn(),
    handleShowExtensions: vi.fn(),
    handleShowSettings: vi.fn(),
    handleNavigateToKnowledge: vi.fn(),
    // UI-366 — handleNavigateToBackend 随 /backend 页退役移除
    handleNavigateToHome: vi.fn(),
    switchToProject: vi.fn(),
    handleSwitchConversation: vi.fn(),
    toggleProjectExpand: vi.fn(),
    handleOpenWorkspacePath: vi.fn(),
    showConversations: true,
  };
}

describe('UI-715 会话行右键信息菜单', () => {
  const conv715 = { id: 'conv-715', title: '会话甲', status: 'active' as const, last_page: null, message_count: 3, created_at: '2026-11-20T00:00:00.000Z', updated_at: '2026-11-20T00:00:00.000Z', project_id: 'project-1' };

  function renderWithConv() {
    const ctx = buildCtx('chat');
    ctx.conversations = [conv715];
    ctx.expandedProjects = new Set<string>(['project-1']);
    ctx.visibleProjects = [ctx.project];
    const utils = render(
      <MemoryRouter initialEntries={['/project/project-1']}>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    const row = screen.getByText('会话甲').closest('li');
    if (!row) throw new Error('会话行未渲染');
    return { ctx, utils, row };
  }

  it('右键弹菜单：只读会话 ID 在场；复制 ID/复制信息写剪贴板；Escape 关闭', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { row } = renderWithConv();
    expect(row.getAttribute('data-conversation-id')).toBe('conv-715');
    fireEvent.contextMenu(row);
    const menu = screen.getByRole('menu');
    expect(menu).toBeTruthy();
    expect(screen.getByText('conv-715')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '复制会话 ID' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('conv-715'));
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole('menuitem', { name: '复制会话信息（JSON）' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"id": "conv-715"')));
    fireEvent.contextMenu(row);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('普通左键点击不弹菜单（仅右键触发）', () => {
    renderWithConv();
    fireEvent.click(screen.getByText('会话甲').closest('li')!);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('BLOCK-14 LeftPanel QuickActions a11y', () => {
  it('UI-714 加映二 — /extensions 路由下「扩展」标 aria-current=page，其余项不标', () => {
    const ctx = buildCtx('chat');
    render(
      <MemoryRouter initialEntries={['/extensions']}>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: '扩展' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: '知识空间' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('button', { name: '新建任务' }).getAttribute('aria-current')).toBeNull();
  });

  it('UI-714 加映二 — /knowledge 下「知识空间」标 page；项目路由下全部不标（动作钮语义）', () => {
    const ctx = buildCtx('chat');
    const { unmount } = render(
      <MemoryRouter initialEntries={['/knowledge']}>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: '知识空间' }).getAttribute('aria-current')).toBe('page');
    unmount();
    render(
      <MemoryRouter initialEntries={['/project/p1']}>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    for (const label of ['新建任务', '扩展', '知识空间']) {
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-current')).toBeNull();
    }
  });

  it('renders workbench quick-actions without the retired search entry (UI-347)', () => {
    const ctx = buildCtx('chat');
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
    // UI-347 退役的是工作台「搜索」快捷入口（精确名）；UI-445 的新会话搜索
    // 按钮在项目树头部（title=搜索会话标题），两者名字不同不冲突。
    expect(screen.queryByRole('button', { name: '搜索' })).toBeNull();
    // BLOCK-156 — 插件+Skills 收敛为「扩展」单入口（扩展中心四货架）
    expect(screen.getByRole('button', { name: '扩展' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '插件' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull();
  });

  it('item26 — 项目区 ➕ 建项目入口撤销（项目创建唯一入口=工作台创建区）', () => {
    const ctx = buildCtx('chat');
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: /新建项目/ })).toBeNull();
    expect(ctx.createPanel.onOpen).not.toHaveBeenCalled();
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
      ...(ctx.project),
      workspaceKind: 'ssh',
      sshHost: 'aliyun',
      remotePath: '/root/petri-block67-demo',
    }];
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

describe('item26 — 🌐 SSH 创建并入 home 统一面板（能力不丢、组件去重）', () => {
  it('点击 globe 跳转 home 创建区（?create=ssh），不再渲染行内向导', () => {
    const ctx = buildCtx('chat');
    const LocationProbe = () => {
      const loc = useLocation();
      return <span data-testid="loc">{loc.pathname + loc.search}</span>;
    };
    render(
      <MemoryRouter initialEntries={['/project/p1/chat']}>
        <LeftPanel ctx={ctx} />
        <LocationProbe />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '新建 SSH 远程项目' }));
    expect(screen.getByTestId('loc').textContent).toBe('/?create=ssh');
    expect(screen.queryByTestId('left-ssh-create-panel')).toBeNull();
  });
});

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
    // 归组断言：工作台标签之后、扩展之前（UI-347 起搜索项已退役；BLOCK-156 插件并入扩展）
    const group = btn.closest('[class*="leftQuickActions"]');
    expect(group?.textContent.indexOf('新建任务')).toBeLessThan(group!.textContent.indexOf('扩展'));
    expect(group?.textContent).toContain('工作台');
  });
});


describe('UI-445 会话标题搜索', () => {
  function buildCtxWithProjects() {
    const ctx = buildCtx('chat');
    ctx.visibleProjects = [
      { id: 'project-1', name: 'Project One', createdAt: '', updatedAt: '' },
      { id: 'project-2', name: 'Project Two', createdAt: '', updatedAt: '' },
    ];
    return ctx;
  }

  function renderPanel(ctx: LeftPanelContext) {
    return render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>,
    );
  }

  async function openSearchAndType(ctx: LeftPanelContext, query: string) {
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: '搜索会话标题' }));
    const input = await screen.findByPlaceholderText('搜索会话标题…');
    fireEvent.change(input, { target: { value: query } });
    await waitFor(() => expect(screen.getByTestId('conv-search-results')).toBeTruthy());
  }

  it('默认态无搜索框；点击搜索钮出现输入框', async () => {
    const ctx = buildCtxWithProjects();
    renderPanel(ctx);
    expect(screen.queryByPlaceholderText('搜索会话标题…')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '搜索会话标题' }));
    expect(await screen.findByPlaceholderText('搜索会话标题…')).toBeTruthy();
  });

  it('输入查询：标题匹配的会话按项目过滤展示，点击直达会话', async () => {
    const ctx = buildCtxWithProjects();
    await openSearchAndType(ctx, 'DESeq2');
    expect(await screen.findByText('DESeq2 结果解读')).toBeTruthy();
    expect(screen.queryByText('闲聊一条')).toBeNull();
    // 点击结果 → 切项目 + 切会话
    fireEvent.click(screen.getByText('DESeq2 结果解读'));
    expect(ctx.switchToProject).toHaveBeenCalledWith('project-2');
    expect(ctx.handleSwitchConversation).toHaveBeenCalledWith('conv-deseq2');
  });

  it('无匹配 → 诚实空态', async () => {
    const ctx = buildCtxWithProjects();
    await openSearchAndType(ctx, '不存在的标题');
    expect(await screen.findByText('无匹配会话')).toBeTruthy();
  });
});
