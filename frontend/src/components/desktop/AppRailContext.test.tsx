/**
 * BLOCK-87 实测回归门：项目列表「又没有了」。
 *
 * dev 栈重启竞态（渲染窗口先于后端 3001 就绪）下，AppRailContext 首载
 * listProjects 抛错后 catch 保持空数组且**再无重试**——项目列表永久空白
 * （用户两轮实测复现）。本门锚定：首载失败后按退避重试，后端就绪即自愈。
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listProjectsMock = vi.fn();

vi.mock('@/lib/project-store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listProjects: (...args: unknown[]) => listProjectsMock(...args),
}));

vi.mock('@/hooks/useConversations', () => ({
  useConversations: () => ({ list: [], refresh: vi.fn(), loading: false }),
  useOtherConversations: () => ({ projectConversations: {}, refreshOtherConversations: vi.fn() }),
}));

vi.mock('@/components/common/ToastProvider', () => {
  const noop = () => '';
  return {
    useToast: () => ({ show: noop, success: noop, info: noop, warning: noop, error: noop, dismiss: noop }),
    ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { AppRailProvider, useAppRail } from './AppRailContext';

function ProjectsProbe(): React.ReactElement {
  const { allProjects } = useAppRail();
  return (
    <ul>
      {allProjects.map((p) => (
        <li key={p.id}>{p.name}</li>
      ))}
    </ul>
  );
}

describe('AppRailContext initial projects load retry (BLOCK-87)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    listProjectsMock.mockReset();
  });

  it('retries with backoff when the first load fails, then populates the list', async () => {
    listProjectsMock
      .mockRejectedValueOnce(new Error('backend not ready yet'))
      .mockResolvedValueOnce([
        { id: 'p_1', name: 'YST' },
        { id: 'p_2', name: '1.WorkDir' },
      ]);

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRailProvider>
          <ProjectsProbe />
        </AppRailProvider>
      </MemoryRouter>,
    );

    // 首载失败：列表空，但退避计时已排定
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(listProjectsMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('YST')).toBeNull();

    // 跨过第一段退避（2s）→ 第二次尝试成功 → 列表填充
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByText('YST')).toBeTruthy();
    expect(screen.getByText('1.WorkDir')).toBeTruthy();
    expect(listProjectsMock).toHaveBeenCalledTimes(2);
  });

  it('stops retrying after a successful load', async () => {
    listProjectsMock.mockResolvedValue([{ id: 'p_ok', name: 'biof3' }]);

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRailProvider>
          <ProjectsProbe />
        </AppRailProvider>
      </MemoryRouter>,
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText('biof3')).toBeTruthy();
    const calls = listProjectsMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(listProjectsMock.mock.calls.length).toBe(calls);
  });
});

// ── BLOCK-101 P1 — 首屏 SWR（D2 键 gewu-startup-snapshot-v1）──────────

describe('AppRailContext startup SWR snapshot (BLOCK-101 P1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    listProjectsMock.mockReset();
  });

  it('renders snapshot synchronously before the network reconciles, then overwrites with fresh data', async () => {
    window.localStorage.setItem(
      'gewu-startup-snapshot-v1',
      JSON.stringify({
        version: 1,
        savedAt: Date.now() - 60_000,
        projects: [{ id: 'p_snap', name: '快照项目' }],
      })
    );
    listProjectsMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([{ id: 'p_fresh', name: '新数据项目' }]), 5_000))
    );

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRailProvider>
          <ProjectsProbe />
        </AppRailProvider>
      </MemoryRouter>,
    );

    // 打开瞬间：快照内容同步可见（零首帧等待）
    expect(screen.getByText('快照项目')).toBeTruthy();
    expect(listProjectsMock).toHaveBeenCalledTimes(1);

    // 对账到货：新鲜数据覆盖快照（DB 唯一事实源，快照即弃）
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getByText('新数据项目')).toBeTruthy();
    // 对账后快照写回为新鲜数据（下次启动即用）
    const stored = JSON.parse(window.localStorage.getItem('gewu-startup-snapshot-v1') || '{}') as { projects?: Array<{ id: string }> };
    expect((stored.projects ?? []).map((p: { id: string }) => p.id)).toEqual(['p_fresh']);
  });

  it('discards snapshots with a wrong version or malformed shape (fail-closed to normal load)', async () => {
    window.localStorage.setItem('gewu-startup-snapshot-v1', JSON.stringify({ version: 2, projects: [{ id: 'x', name: '未来版本' }] }));
    listProjectsMock.mockResolvedValue([{ id: 'p_ok', name: '正常加载' }]);

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRailProvider>
          <ProjectsProbe />
        </AppRailProvider>
      </MemoryRouter>,
    );
    // 版本不匹配：快照不渲染，走正常加载
    expect(screen.queryByText('未来版本')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('正常加载')).toBeTruthy();

    // 坏形状（projects 非数组）：同样丢弃
    window.localStorage.setItem('gewu-startup-snapshot-v1', JSON.stringify({ version: 1, projects: 'garbage' }));
    window.localStorage.setItem('gewu-startup-snapshot-v1-bad', 'not json');
    expect(screen.queryByText('未来版本')).toBeNull();
  });
});
