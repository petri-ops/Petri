import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Welcome from './welcome';
import { createConversation } from '@/components/copilot/copilotConversationsClient';
import { branchApi } from '@/lib/branchBridge';
import {
  createProject,
  listProjects,
  listSshTargetCandidates,
  validateSshProject,
} from '@/lib/project-store';
import type { Project } from '@/lib/project-types';

vi.mock('@/components/backend/BackendStatusProvider', () => ({
  useBackendStatus: () => ({ serverUp: true, isReady: true, loaded: true }),
}));

vi.mock('@/components/copilot/copilotConversationsClient', () => ({
  createConversation: vi.fn(),
}));

vi.mock('@/lib/branchBridge', () => ({
  branchApi: { list: vi.fn() },
}));

vi.mock('@/lib/project-store', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  listSshTargetCandidates: vi.fn(),
  validateSshProject: vi.fn(),
  connectSshHost: vi.fn(),
  listSshRemoteDirs: vi.fn(),
}));

vi.mock('@/components/desktop/FolderPicker', () => ({
  FolderPicker: ({ onPick }: { onPick: (path: string) => void }) => (
    <button type="button" onClick={() => onPick('/srv/demo')} data-testid="folder-picker-stub">
      pick-stub
    </button>
  ),
}));

const createConversationMock = vi.mocked(createConversation);
const branchListMock = vi.mocked(branchApi.list);
const listProjectsMock = vi.mocked(listProjects);
const createProjectMock = vi.mocked(createProject);
const listSshTargetsMock = vi.mocked(listSshTargetCandidates);
const validateSshMock = vi.mocked(validateSshProject);
const connectSshHostMock = vi.mocked((await import('@/lib/project-store')).connectSshHost);
const listSshRemoteDirsMock = vi.mocked((await import('@/lib/project-store')).listSshRemoteDirs);

const projectA: Project = {
  id: 'p_a', name: '阿尔法项目', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
};
const projectB: Project = {
  id: 'p_b', name: '贝塔项目', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z',
};

function renderWelcome() {
  return render(
    <MemoryRouter>
      <Welcome />
    </MemoryRouter>
  );
}

async function openPicker() {
  fireEvent.click(screen.getByLabelText('选择项目'));
  await screen.findByPlaceholderText('搜索工作区');
}

beforeEach(() => {
  listProjectsMock.mockResolvedValue([projectA, projectB]);
  branchListMock.mockResolvedValue([
    { id: 'br_main', name: 'main', isActive: true },
  ] as never);
  createConversationMock.mockResolvedValue({
    id: 'conv_new', title: '新任务', status: 'active', last_page: null,
    message_count: 0, created_at: '2026-09-10T00:00:00Z', updated_at: '2026-09-10T00:00:00Z',
    project_id: 'p_a',
  } as never);
  createProjectMock.mockResolvedValue({
    id: 'p_new', name: 'demo', createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
  });
  listSshTargetsMock.mockResolvedValue([
    { alias: 'dell', label: 'dell 工作机', registered: true },
  ]);
  validateSshMock.mockResolvedValue({ ok: true });
  connectSshHostMock.mockResolvedValue({ ok: true, home: '/root' });
  listSshRemoteDirsMock.mockResolvedValue({ ok: true, path: '/root', dirs: [{ name: 'demo', path: '/root/demo' }, { name: 'jobs', path: '/root/jobs' }] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('UI-338 加映 — ?project= 预选当前项目', () => {
  it('从工作区带 ?project= 进入时，下拉默认预选该项目', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/', search: '?project=p_b' }]}>
        <Welcome />
      </MemoryRouter>
    );
    await openPicker();
    const rows = screen.getAllByText('贝塔项目');
    // 触发器 + 清单行都显示贝塔（当前 ✓）
    expect(rows.length).toBe(2);
  });
});

describe('Welcome（BLOCK-80 欢迎页 + UI-337 ZCode 式项目面板）', () => {
  it('渲染问候语 + 触发器 + 当前分支徽标；打开面板含搜索/清单/两动作', async () => {
    renderWelcome();
    expect(screen.getByLabelText('欢迎页')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/main/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText('选择项目'));
    expect(await screen.findByPlaceholderText('搜索工作区')).toBeTruthy();
    // 触发器与清单行都显示项目名 → 用计数断言
    expect(screen.getAllByText('阿尔法项目').length).toBe(2);
    expect(screen.getByText('贝塔项目')).toBeTruthy();
    expect(screen.getByText('打开文件夹')).toBeTruthy();
    expect(screen.getByText('远程连接')).toBeTruthy();
  });

  it('搜索过滤工作区清单', async () => {
    renderWelcome();
    await openPicker();
    fireEvent.change(screen.getByPlaceholderText('搜索工作区'), { target: { value: '贝塔' } });
    expect(screen.getByText('贝塔项目')).toBeTruthy();
    // 触发器仍显示当前选中项目（阿尔法），清单行已被过滤
    expect(screen.getAllByText('阿尔法项目')).toHaveLength(1);
  });

  it('选择项目行 → 关闭面板 → 发送创建会话并交接首问', async () => {
    renderWelcome();
    const store: Record<string, string> = {};
    vi.stubGlobal('sessionStorage', {
      setItem: (k: string, v: string) => { store[k] = v; },
      getItem: (k: string) => store[k] ?? null,
      removeItem: (k: string) => { delete store[k]; },
    });
    await openPicker();
    fireEvent.click(screen.getByText('贝塔项目'));
    await waitFor(() => expect(screen.queryByPlaceholderText('搜索工作区')).toBeNull());
    fireEvent.change(screen.getByLabelText('任务描述'), { target: { value: '跑差异分析' } });
    fireEvent.click(screen.getByText('开始任务'));
    await waitFor(() => expect(createConversationMock).toHaveBeenCalledWith('新任务', undefined, 'p_b'));
    const handoff = JSON.parse(store['gewu.welcomeLaunch'] || '{}');
    expect(handoff.conversationId).toBe('conv_new');
    expect(handoff.prompt).toBe('跑差异分析');
  });

  it('打开文件夹：FolderPicker 选目录 → 命名 → createProject 创建并选中', async () => {
    renderWelcome();
    await openPicker();
    fireEvent.click(screen.getByText('打开文件夹'));
    fireEvent.click(screen.getByTestId('folder-picker-stub'));
    const nameInput = await screen.findByLabelText('项目名称');
    expect((nameInput as HTMLInputElement).value).toBe('demo');
    fireEvent.click(screen.getByText('确认创建'));
    await waitFor(() => expect(createProjectMock).toHaveBeenCalledWith({
      name: 'demo', modality: 'general', workspacePath: '/srv/demo',
    }));
    await waitFor(() => expect(screen.queryByPlaceholderText('搜索工作区')).toBeNull());
  });

  it('远程连接：先连接再目录补全（datalist 联想 + 建议行）→ 校验并创建 ssh 项目', async () => {
    renderWelcome();
    await openPicker();
    fireEvent.click(screen.getByText('远程连接'));
    const aliasInput = await screen.findByLabelText('远程目标') as HTMLInputElement;
    fireEvent.change(aliasInput, { target: { value: 'dell' } });
    fireEvent.click(screen.getByText('连接'));
    await waitFor(() => expect(connectSshHostMock).toHaveBeenCalledWith('dell'));
    // 连接成功 → $HOME 回填路径 + 目录建议出现
    await waitFor(() => expect((screen.getByLabelText('远程路径') as HTMLInputElement).value).toBe('/root/'));
    expect(await screen.findByText('/root/demo/')).toBeTruthy();
    // 点击建议行 → 路径补全
    fireEvent.click(screen.getByText('/root/demo/'));
    await waitFor(() => expect((screen.getByLabelText('远程路径') as HTMLInputElement).value).toBe('/root/demo/'));
    fireEvent.click(screen.getByText('校验并创建'));
    await waitFor(() => expect(validateSshMock).toHaveBeenCalledWith({ alias: 'dell', remotePath: '/root/demo/' }));
    await waitFor(() => expect(createProjectMock).toHaveBeenCalledWith(expect.objectContaining({
      workspaceKind: 'ssh', sshHost: 'dell', remotePath: '/root/demo/',
    })));
  });

  it('UI-338 退出按钮：渲染于欢迎页左上，点击不崩溃', async () => {
    renderWelcome();
    const btn = screen.getByTitle('返回');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    // 冷启动（无历史）分支：导航至最近项目工作区（路由内变化，不抛错即可）
  });

  it('快捷 chip 点击填充首问输入框；空输入不可发送', async () => {
    renderWelcome();
    const chip = await screen.findByText('差异分析');
    fireEvent.click(chip);
    const textarea = screen.getByLabelText('任务描述') as HTMLTextAreaElement;
    expect(textarea.value).toContain('DESeq2');
    expect((screen.getByText('开始任务') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(textarea, { target: { value: '' } });
    await waitFor(() => expect((screen.getByText('开始任务') as HTMLButtonElement).disabled).toBe(true));
  });
});
