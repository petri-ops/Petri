import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateChecker } from './UpdateChecker';

const useAutoUpdateMock = vi.fn();

vi.mock('@/hooks/useAutoUpdate', () => ({
  useAutoUpdate: () => useAutoUpdateMock(),
}));

type DesktopGlobal = { biof3Desktop?: { updater?: unknown } };

function autoUpdateState() {
  return {
    checking: false,
    available: false,
    availableVersion: '',
    downloading: false,
    progress: null,
    downloaded: false,
    error: '',
    upToDate: false,
    installing: false,
    check: vi.fn(),
    download: vi.fn(),
    install: vi.fn(),
  };
}

describe('UpdateChecker hooks order', () => {
  beforeEach(() => {
    useAutoUpdateMock.mockReset();
    useAutoUpdateMock.mockReturnValue(autoUpdateState());
    delete (window as unknown as DesktopGlobal).biof3Desktop;
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as DesktopGlobal).biof3Desktop;
  });

  // 回归门：useAutoUpdate() 必须无条件调用。修复前它排在 `if (!updater) return null`
  // 之后——桥在两次渲染间出现/消失时 hook 数量变化，React 卸载整棵树。
  it('桥缺失时仍调用 useAutoUpdate（hook 调用无条件）并渲染为空', () => {
    const { container } = render(<UpdateChecker />);
    expect(useAutoUpdateMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('');
  });

  it('桥在位时渲染更新区块', () => {
    (window as unknown as DesktopGlobal).biof3Desktop = { updater: { check: vi.fn() } };
    const { container } = render(<UpdateChecker />);
    expect(useAutoUpdateMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.gewu-update-section')).toBeTruthy();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });
});
