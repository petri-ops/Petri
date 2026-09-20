import React from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitRepositoryConsent } from './GitRepositoryConsent';
import type { RepositoryBindingStatus } from './resultStudioClient';

function mockFetchOnce(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  );
}

const baseStatus: RepositoryBindingStatus = {
  ok: true,
  projectId: 'p1',
  existingRepositoryDetected: false,
  existingRepositoryDirty: false,
  managedRepositoryExists: false,
  decisionRequired: false,
  existingRepositoryConsent: null,
  binding: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('G0-RS-P7 existing Git 显式同意 UI（前端）', () => {
  it('加载中如实显示读取状态，且不预先宣称任何结论', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<never>(() => undefined)));
    render(<GitRepositoryConsent projectId="p1" />);
    const status = await screen.findByRole('status');
    expect(status.getAttribute('data-state')).toBe('loading');
    expect(status.textContent).toContain('正在读取');
  });

  it('未检测到用户自有仓库时静默不渲染，不打扰用户', async () => {
    mockFetchOnce({ ...baseStatus });
    const { container } = render(<GitRepositoryConsent projectId="p1" />);
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('decisionRequired 时展示 detected 风险与肯定式 opt-in，不默认替用户同意', async () => {
    mockFetchOnce({
      ...baseStatus,
      existingRepositoryDetected: true,
      decisionRequired: true,
    });
    render(<GitRepositoryConsent projectId="p1" />);
    const group = await screen.findByRole('group', { name: 'Git 仓库同意' });
    expect(group.getAttribute('data-state')).toBe('decision-required');
    expect(group.textContent).toContain('检测到项目目录中已有 Git 仓库');
    expect(group.textContent).toContain('授权 Gewu 写入我的仓库');
    expect(screen.queryByText('已授权')).toBeNull();
    expect(group.textContent).not.toContain('当前仓库有未提交改动');
  });

  it('dirty 仓库的决策态明确说明 WIP 保护与冲突阻断', async () => {
    mockFetchOnce({
      ...baseStatus,
      existingRepositoryDetected: true,
      existingRepositoryDirty: true,
      decisionRequired: true,
    });
    render(<GitRepositoryConsent projectId="p1" />);
    const group = await screen.findByRole('group', { name: 'Git 仓库同意' });
    expect(group.textContent).toContain('当前仓库有未提交改动');
    expect(group.textContent).toContain('不会自动暂存、提交或覆盖');
    expect(group.textContent).toContain('后续写入将被阻止');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '授权 Gewu 写入我的仓库' }).disabled).toBe(false);
  });

  it('用户点击授权后调用提交接口并刷新为已授权状态', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...baseStatus,
        existingRepositoryDetected: true,
        decisionRequired: true,
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        projectId: 'p1',
        bindingStatus: 'ready',
        mode: 'existing',
        consent: { allowExistingRepository: true, decisionSource: 'explicit_api' },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...baseStatus,
        existingRepositoryDetected: true,
        existingRepositoryConsent: { allowExistingRepository: true, decisionSource: 'explicit_api' },
        binding: { mode: 'existing', status: 'ready', reason: null },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<GitRepositoryConsent projectId="p1" />);
    const optIn = await screen.findByRole('button', { name: '授权 Gewu 写入我的仓库' });
    fireEvent.click(optIn);

    await waitFor(() => expect(screen.getByText(/已授权/)).toBeTruthy());
    // GET -> POST -> GET 三次调用，且 POST 体强制 allowExistingRepository:true。
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const postCall = fetchMock.mock.calls[1];
    expect(postCall[0]).toContain('/repository-binding/consent');
    expect(JSON.parse(postCall[1].body)).toMatchObject({
      projectId: 'p1',
      allowExistingRepository: true,
    });
  });

  it('读取失败时展示错误与重试入口，不静默吞掉', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error', json: async () => ({ error: 'boom' }) }),
    );
    render(<GitRepositoryConsent projectId="p1" />);
    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-state')).toBe('error');
    expect(alert.textContent).toContain('boom');
  });

  it('已授权时只展示当前 consent 与绑定状态，不再弹出授权按钮', async () => {
    mockFetchOnce({
      ...baseStatus,
      existingRepositoryDetected: true,
      existingRepositoryConsent: { allowExistingRepository: true, decisionSource: 'explicit_api' },
      binding: { mode: 'existing', status: 'ready', reason: null },
    });
    render(<GitRepositoryConsent projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/已授权/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /授权/ })).toBeNull();
  });
});
