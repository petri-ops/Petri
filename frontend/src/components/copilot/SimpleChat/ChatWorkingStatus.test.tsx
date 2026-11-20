import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatWorkingStatus } from './ChatWorkingStatus';

describe('UI-712 底部工作中状态', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T00:00:00.000Z'));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('未运行时不渲染状态条', () => {
    const { container } = render(<ChatWorkingStatus running={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('运行时显示「工作中」并按 startedAt 起算秒表', () => {
    render(<ChatWorkingStatus running startedAt={Date.now() - 5000} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('工作中');
    expect(status.textContent).toContain('已运行 0 秒');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(status.textContent).toContain('已运行 6 秒');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(status.textContent).toContain('已运行 7 秒');
  });

  it('缺省 startedAt 时按挂载时刻起算', () => {
    render(<ChatWorkingStatus running />);
    expect(screen.getByRole('status').textContent).toContain('已运行 0 秒');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('status').textContent).toContain('已运行 2 秒');
  });

  it('运行结束后移除状态条并停止计时', () => {
    const startedAt = Date.now() - 2000;
    const { rerender } = render(<ChatWorkingStatus running startedAt={startedAt} />);
    expect(screen.getByRole('status')).toBeTruthy();
    rerender(<ChatWorkingStatus running={false} startedAt={startedAt} />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
