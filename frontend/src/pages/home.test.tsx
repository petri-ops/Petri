import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendStatus } from '@/lib/electron';
import Home from './home';

let backendStatus: BackendStatus;

vi.mock('@/components/backend/BackendStatusProvider', () => ({
  useBackendStatus: () => backendStatus,
}));

vi.mock('@/components/icons/Icon', () => ({
  Icon: () => <span aria-hidden="true" />,
}));

vi.mock('@/components/desktop/PluginStorePanel', () => ({
  PluginStorePanel: () => <div>插件商店</div>,
}));

vi.mock('@/lib/project-store', () => ({
  createProject: vi.fn(),
  listProjectJobs: vi.fn().mockResolvedValue([]),
  listProjects: vi.fn().mockResolvedValue([]),
}));

vi.mock('react-router-dom', () => ({
  Navigate: ({ to }: { to: string }) => <div>navigate:{to}</div>,
  useNavigate: () => vi.fn(),
}));

function status(overrides: Partial<BackendStatus>): BackendStatus {
  return {
    rRuntime: true,
    pyRuntime: true,
    rServerUp: false,
    plumberUp: false,
    isReady: false,
    downReason: null,
    loaded: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('UI-141 startup gate', () => {
  it('shows backend recovery after 30s when runtimes are installed', () => {
    backendStatus = status({ rRuntime: true, pyRuntime: true });
    render(<Home />);

    expect(screen.queryByText('本地分析服务未就绪')).toBeNull();
    act(() => vi.advanceTimersByTime(30_000));

    expect(screen.getByRole('heading', { name: '本地分析服务未就绪' })).toBeTruthy();
    expect(screen.getByText(/与「是否安装运行时」无关/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试连接' })).toBeTruthy();
    expect(screen.queryByText('先安装分析运行时')).toBeNull();
  });

  it('shows runtime installation only when rRuntime is explicitly false', () => {
    backendStatus = status({ rRuntime: false, pyRuntime: true });
    render(<Home />);

    expect(screen.getByRole('heading', { name: '先安装分析运行时' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开插件商店安装' })).toBeTruthy();
    expect(screen.queryByText('本地分析服务未就绪')).toBeNull();
  });
});
