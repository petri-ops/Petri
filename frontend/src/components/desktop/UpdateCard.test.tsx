import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateCard } from './UpdateCard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { petriDesktop?: unknown }).petriDesktop;
});

type CheckResult = { ok: boolean; hasUpdate: boolean; version?: string; info?: { version?: string } };
type UpdaterStub = {
  check: () => CheckResult | Promise<CheckResult>;
  download: () => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>;
  install: () => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>;
  onUpdateAvailable?: (cb: (info?: { version?: string }) => void) => () => void;
  onUpdateNotAvailable?: (cb: () => void) => () => void;
  onDownloadProgress?: (cb: (p: { ratio: number }) => void) => () => void;
  onUpdateDownloaded?: (cb: () => void) => () => void;
  onError?: (cb: (msg: string) => void) => () => void;
};

function stubUpdater(overrides: Partial<UpdaterStub> = {}): UpdaterStub {
  return {
    check: () => ({ ok: true, hasUpdate: true, version: '0.0.5' }),
    download: () => ({ ok: true }),
    install: () => ({ ok: true }),
    ...overrides,
  };
}

describe('UI-704 — 页面内 UpdateCard（更新主动呈现，不再让用户进设置找）', () => {
  it('检测到新版本：卡片出现（版本号在场）且可关闭；无 updater / 无更新时不渲染', async () => {
    (window as { petriDesktop?: unknown }).petriDesktop = { updater: stubUpdater() };
    const { rerender } = render(<UpdateCard />);
    await waitFor(() => expect(screen.getByTestId('update-card')).toBeTruthy());
    expect(screen.getByTestId('update-card').textContent).toContain('0.0.5');

    // 可关闭
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByTestId('update-card')).toBeNull();

    // 无 updater：不渲染（不炸）
    delete (window as { petriDesktop?: unknown }).petriDesktop;
    rerender(<UpdateCard />);
    expect(screen.queryByTestId('update-card')).toBeNull();
  });

  it('主进程推送 onUpdateAvailable → 卡片即时出现（自动呈现，不等用户进设置）', async () => {
    let push: ((info?: { version?: string }) => void) | null = null;
    (window as { petriDesktop?: unknown }).petriDesktop = {
      updater: stubUpdater({
        check: () => ({ ok: true, hasUpdate: false }),
        onUpdateAvailable: (cb) => { push = cb; return () => { push = null; }; },
      }),
    };
    render(<UpdateCard />);
    await waitFor(() => expect(push).toBeTruthy());
    await waitFor(() => {
      (push as unknown as (info?: { version?: string }) => void)?.({ version: '0.0.9' });
    });
    await waitFor(() => expect(screen.getByTestId('update-card')).toBeTruthy());
    expect(screen.getByTestId('update-card').textContent).toContain('0.0.9');
  });

  it('已下载完成：出现安装动作（沿用现有 DMG/NSIS 流程，不新引 IPC）', async () => {
    let fireDownloaded: (() => void) | null = null;
    (window as { petriDesktop?: unknown }).petriDesktop = {
      updater: stubUpdater({
        check: () => ({ ok: true, hasUpdate: true, version: '0.0.5' }),
        download: () => {
          // 真实链路：下载完成由主进程 onUpdateDownloaded 推送（useAutoUpdate 订阅）
          fireDownloaded?.();
          return { ok: true };
        },
        onUpdateDownloaded: (cb) => { fireDownloaded = cb; return () => { fireDownloaded = null; }; },
      }),
    };
    render(<UpdateCard />);
    await waitFor(() => expect(screen.getByTestId('update-card')).toBeTruthy());
    // 下载动作在场
    const downloadBtn = screen.getByRole('button', { name: /下载/ });
    fireEvent.click(downloadBtn);
    // 模拟下载完成推送
    await waitFor(() => expect(screen.getByRole('button', { name: /安装/ })).toBeTruthy());
  });
});
