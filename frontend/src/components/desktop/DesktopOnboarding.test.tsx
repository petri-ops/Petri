import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopOnboarding } from './DesktopOnboarding';

const listPacksRequiringRuntimesMock = vi.fn<() => Promise<{ packId: string; name: string }[]>>();
const dispatchGewuEventMock = vi.fn();

vi.mock('@/lib/domainPack', () => ({
  listPacksRequiringRuntimes: () => listPacksRequiringRuntimesMock(),
}));

vi.mock('@/lib/events', () => ({
  gewuEvents: { onboardingDone: 'biof3:onboarding-done' },
  dispatchGewuEvent: (...args: unknown[]) => dispatchGewuEventMock(...args),
  subscribeGewuEvent: () => () => {},
}));

vi.mock('@/lib/releaseContract', () => ({
  loadReleaseTagline: () => '本地化 AI 陪伴的全组学学习与实战平台',
}));

vi.mock('@/components/backend/BackendStatusProvider', () => ({
  useBackendStatus: () => ({ loaded: true, rRuntime: true, pyRuntime: true }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe('DesktopOnboarding hooks order', () => {
  beforeEach(() => {
    listPacksRequiringRuntimesMock.mockReset();
    dispatchGewuEventMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // 回归门（P6 渲染层实机抓真）：早退守卫曾在全部 useCallback 之前，首渲染只调 3 个
  // hook、领域判定落地后的二次渲染调 6 个 → React 抛
  // 「Rendered more hooks than during the previous render」并卸载整棵树（首启整页空白）。
  it('领域判定异步落地后仍能完成二次渲染，不触发 hook 顺序崩溃', async () => {
    const gate = deferred<{ packId: string; name: string }[]>();
    listPacksRequiringRuntimesMock.mockReturnValue(gate.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { container } = render(<DesktopOnboarding />);
    expect(container.querySelector('[aria-label="首次启动引导"]')).toBeNull();

    await act(async () => {
      gate.resolve([]);
      await gate.promise;
    });

    await waitFor(() => {
      expect(screen.getByLabelText('首次启动引导')).toBeTruthy();
    });
    expect(container.querySelector('[aria-label="首次启动引导"]')).toBeTruthy();
    const messages = consoleError.mock.calls.map((call) => String(call[0])).join('\n');
    expect(messages).not.toContain('Rendered more hooks');
    expect(messages).not.toContain('change in the order of Hooks');
    consoleError.mockRestore();
  });

  it('无领域包需求时收成单步欢迎流（不出现「准备运行时」步骤）', async () => {
    listPacksRequiringRuntimesMock.mockResolvedValue([]);
    render(<DesktopOnboarding />);
    await waitFor(() => expect(screen.getByLabelText('首次启动引导')).toBeTruthy());
    expect(screen.queryByText('准备运行时')).toBeNull();
    expect(screen.getByText('欢迎来到 Gewu')).toBeTruthy();
  });

  it('有领域包声明运行时则保留运行时步骤，可线性前进', async () => {
    listPacksRequiringRuntimesMock.mockResolvedValue([{ packId: 'gewu-pack-bio', name: '格物 · 生信分析包' }]);
    render(<DesktopOnboarding />);
    await waitFor(() => expect(screen.getByLabelText('首次启动引导')).toBeTruthy());
    expect(screen.getByText('准备运行时')).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByText('下一步')); });
    expect(screen.getByText('R 运行时')).toBeTruthy();
    expect(screen.getByText('Python 运行时')).toBeTruthy();
  });

  it('点击「跳过引导」派发 onboardingDone（App 侧据此卸载引导）', async () => {
    listPacksRequiringRuntimesMock.mockResolvedValue([]);
    render(<DesktopOnboarding />);
    await waitFor(() => expect(screen.getByLabelText('首次启动引导')).toBeTruthy());

    await act(async () => { fireEvent.click(screen.getByText('跳过引导')); });
    expect(dispatchGewuEventMock).toHaveBeenCalledWith('biof3:onboarding-done');
  });
});
