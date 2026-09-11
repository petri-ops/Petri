import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Welcome from './welcome';
import { createConversation } from '@/components/copilot/copilotConversationsClient';
import { branchApi } from '@/lib/branchBridge';
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
}));

const createConversationMock = vi.mocked(createConversation);
const branchListMock = vi.mocked(branchApi.list);
const listProjectsMock = vi.mocked(
  (await import('@/lib/project-store')).listProjects
);

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

function mockSuccess() {
  listProjectsMock.mockResolvedValue([projectA, projectB]);
  branchListMock.mockResolvedValue([
    { id: 'br_main', name: 'main', isActive: true },
  ] as never);
  createConversationMock.mockResolvedValue({
    id: 'conv_new', title: '新任务', status: 'active', last_page: null,
    message_count: 0, created_at: '2026-09-10T00:00:00Z', updated_at: '2026-09-10T00:00:00Z',
    project_id: 'p_a',
  } as never);
}

beforeEach(() => {
  mockSuccess();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('Welcome（BLOCK-80 欢迎页）', () => {
  it('渲染问候语 + 项目下拉（既有项目 + 管理入口）+ 当前分支徽标', async () => {
    renderWelcome();
    expect(screen.getByLabelText('欢迎页')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /.+/ })).toBeTruthy();
    const select = await screen.findByLabelText('选择项目') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('p_a'), { timeout: 2000 });
    expect(screen.getByText(/main/)).toBeTruthy();
    expect(screen.getByText('管理项目…')).toBeTruthy();
  });

  it('快捷 chip 点击填充首问输入框', async () => {
    renderWelcome();
    const chip = await screen.findByText('差异分析');
    fireEvent.click(chip);
    const textarea = screen.getByLabelText('任务描述') as HTMLTextAreaElement;
    expect(textarea.value).toContain('DESeq2');
  });

  it('发送：创建会话 + sessionStorage 交接 + 导航项目工作区', async () => {
    const navigateSpy = vi.fn();
    // 拦截 navigate：Welcome 用 useNavigate —— MemoryRouter 下验证导航结果用
    // sessionStorage 交接 + createConversation 参数（导航本身由 router 完成）
    const store: Record<string, string> = {};
    vi.stubGlobal('sessionStorage', {
      setItem: (k: string, v: string) => { store[k] = v; },
      getItem: (k: string) => store[k] ?? null,
      removeItem: (k: string) => { delete store[k]; },
    });
    renderWelcome();
    await screen.findByLabelText('选择项目');
    fireEvent.change(screen.getByLabelText('任务描述'), { target: { value: '跑差异分析' } });
    fireEvent.click(screen.getByText('开始任务'));
    await waitFor(() => expect(createConversationMock).toHaveBeenCalledWith('新任务', undefined, 'p_a'));
    const handoff = JSON.parse(store['gewu.welcomeLaunch'] || '{}');
    expect(handoff.conversationId).toBe('conv_new');
    expect(handoff.prompt).toBe('跑差异分析');
    void navigateSpy;
  });

  it('空输入不可发送', async () => {
    renderWelcome();
    await screen.findByLabelText('选择项目');
    expect((screen.getByText('开始任务') as HTMLButtonElement).disabled).toBe(true);
  });
});
