import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestInstanceBadge } from './TestInstanceBadge';

/**
 * UI-421 加映（用户裁决 2026-11-17「组合键太麻烦，换成可解锁按钮」）：
 * 徽标条一键解锁按钮行为契约——点击调 toggle 通道；锁定态 hover 触发窥视；
 * 解锁态渲染「锁定」按钮。
 */
const toggleMock = vi.fn();
const hoverMock = vi.fn();
const modeChangedCb: Array<(manage: boolean) => void> = [];

function mockDesktopBridge(testInstance: boolean) {
  (window as unknown as { petriDesktop: unknown }).petriDesktop = {
    __testInstance: testInstance,
    __testManageShortcut: 'Ctrl+Alt+Shift+M',
    window: {
      onTestManageModeChanged: (cb: (manage: boolean) => void) => {
        modeChangedCb.push(cb);
        return () => { modeChangedCb.length = 0; };
      },
      testManageToggle: toggleMock,
      testManageHover: hoverMock,
    },
  };
}

beforeEach(() => {
  toggleMock.mockClear();
  hoverMock.mockClear();
  modeChangedCb.length = 0;
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { petriDesktop?: unknown }).petriDesktop;
});

describe('UI-421 加映 — 管理条一键解锁按钮', () => {
  it('锁定态：渲染「🔓 解锁」按钮，点击调 testManageToggle；hover 触发窥视（true）', () => {
    mockDesktopBridge(true);
    render(<TestInstanceBadge />);
    const unlock = screen.getByRole('button', { name: /🔓 解锁/ });
    fireEvent.mouseEnter(unlock.closest('[class*="bar"]') as HTMLElement);
    expect(hoverMock).toHaveBeenLastCalledWith(true);
    fireEvent.click(unlock);
    expect(toggleMock).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(unlock.closest('[class*="bar"]') as HTMLElement);
    expect(hoverMock).toHaveBeenLastCalledWith(false);
  });

  it('解锁态（主进程广播 manageMode=true）：渲染「🔒 锁定」按钮，点击回 toggle', () => {
    mockDesktopBridge(true);
    render(<TestInstanceBadge />);
    // 主进程广播解锁
    act(() => {
      for (const cb of modeChangedCb) cb(true);
    });
    const lock = screen.getByRole('button', { name: /🔒 锁定/ });
    fireEvent.click(lock);
    expect(toggleMock).toHaveBeenCalledTimes(1);
    // 解锁态下 hover 不再窥视（全交互无需窥视）
    fireEvent.mouseEnter(lock.closest('[class*="bar"]') as HTMLElement);
    expect(hoverMock).not.toHaveBeenCalled();
  });

  it('非测试实例（主窗）：组件不渲染', () => {
    mockDesktopBridge(false);
    render(<TestInstanceBadge />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
