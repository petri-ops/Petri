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
