import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdatePill } from './UpdatePill';

/**
 * UI-705 — 标题栏更新 pill 行为契约（接 UpdateCard 测试资产，同语义迁移）：
 * 推送到达 → pill 出现；点击展开面板；下载完成 → pill 变「安装更新」；
 * 稍后 = 本会话隐藏；新推送复现。
 */
const updaterStubs = {
  check: vi.fn(async () => ({ ok: false, error: 'disabled' })),
  download: vi.fn(async () => ({ ok: true })),
  install: vi.fn(async () => ({ ok: true })),
  onUpdateAvailable: vi.fn(),
  onUpdateNotAvailable: vi.fn(),
  onDownloadProgress: vi.fn(),
  onUpdateDownloaded: vi.fn(),
  onError: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { petriDesktop: unknown }).petriDesktop = { updater: updaterStubs };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { petriDesktop?: unknown }).petriDesktop;
});

/** 取主进程推送回调并触发（useAutoUpdate 订阅面）。 */
function pushEvent(name: keyof typeof updaterStubs, payload?: unknown): void {
  const mock = updaterStubs[name] as ReturnType<typeof vi.fn>;
  const cb = mock.mock.calls.at(-1)?.[0];
  act(() => {
    (cb as ((...args: unknown[]) => void) | undefined)?.(payload);
  });
}

describe('UI-705 — 标题栏更新 pill', () => {
  it('无更新推送：pill 不渲染（推送制不常驻）', () => {
    render(<UpdatePill />);
    expect(screen.queryByTestId('update-pill')).toBeNull();
  });

  it('主进程推送 onUpdateAvailable → pill「更新」出现；点击展开面板（版本号+下载+稍后）', async () => {
    render(<UpdatePill />);
    await waitFor(() => expect(updaterStubs.onUpdateAvailable).toHaveBeenCalled());
    pushEvent('onUpdateAvailable', { version: '0.0.5' });
    await waitFor(() => expect(screen.getByTestId('update-pill')).toBeTruthy());
    expect(screen.getByTestId('update-pill').textContent).toContain('更新');
    // 展开面板
    fireEvent.click(screen.getByRole('button', { name: '更新面板' }));
    expect(screen.getByRole('dialog').textContent).toContain('0.0.5');
    expect(screen.getByRole('dialog').textContent).toContain('下载更新');
    expect(screen.getByRole('dialog').textContent).toContain('稍后');
  });

  it('下载流转：面板内「⬇ 下载更新」→ 进度推送 → 下载完成 → pill 变「安装更新」', async () => {
    render(<UpdatePill />);
    await waitFor(() => expect(updaterStubs.onUpdateAvailable).toHaveBeenCalled());
    pushEvent('onUpdateAvailable', { version: '0.0.5' });
    await waitFor(() => expect(screen.getByTestId('update-pill')).toBeTruthy());
    const dialog = () => screen.getByRole('dialog', { name: '更新面板' });
    fireEvent.click(screen.getByRole('button', { name: '更新面板' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: /下载更新/ }));
    expect(updaterStubs.download).toHaveBeenCalled();
    // 进度推送
    await waitFor(() => expect(updaterStubs.onDownloadProgress).toHaveBeenCalled());
    pushEvent('onDownloadProgress', { ratio: 0.6, percent: 60 });
    await waitFor(() => expect(screen.getByTestId('update-pill').textContent).toContain('60%'));
    // 下载完成
    pushEvent('onUpdateDownloaded');
    await waitFor(() => expect(screen.getByTestId('update-pill').textContent).toContain('安装更新'));
    // 面板内出现安装按钮（pill 就绪态文本同为「安装更新」——within(dialog) 区分作用域）。
    // 面板在下载全程保持打开（pill 点击是 toggle——已开则不再点，否则关掉）。
    if (!screen.queryByRole('dialog')) {
      fireEvent.click(screen.getByRole('button', { name: '更新面板' }));
    }
    await waitFor(() => expect(dialog()).toBeTruthy());
    fireEvent.click(within(dialog()).getByRole('button', { name: /安装更新/ }));
    expect(updaterStubs.install).toHaveBeenCalled();
  });

  it('稍后：面板「✕」/「稍后」→ pill 本会话隐藏；下载完成态重新唤起', async () => {
    render(<UpdatePill />);
    await waitFor(() => expect(updaterStubs.onUpdateAvailable).toHaveBeenCalled());
    pushEvent('onUpdateAvailable', { version: '0.0.5' });
    await waitFor(() => expect(screen.getByTestId('update-pill')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '更新面板' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '更新面板' })).getByRole('button', { name: '稍后' }));
    expect(screen.queryByTestId('update-pill')).toBeNull();
    // 下载完成推送重新唤起（提示安装）
    pushEvent('onUpdateDownloaded');
    await waitFor(() => expect(screen.getByTestId('update-pill')).toBeTruthy());
    expect(screen.getByTestId('update-pill').textContent).toContain('安装更新');
  });
});
