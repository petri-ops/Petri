/**
 * BLOCK-208（W7c）— 动效开关契约测。
 *
 * 钉三件事：①三档取值写入 `<html data-motion>`（CSS 消费点）；
 * ②非法/缺失缓存回落 `system`（零行为变化）；③切换即时生效且写回缓存键。
 */
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { MOTION_STORAGE_KEY } from './prefCache';

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-motion');
  vi.unstubAllGlobals();
});

describe('motion switch', () => {
  it('defaults to system when nothing is cached', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, media: '(prefers-reduced-motion: reduce)', onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.motion).toBe('system');
    expect(document.documentElement.getAttribute('data-motion')).toBe('system');
  });

  it('applies a cached reduced preference before first paint', () => {
    localStorage.setItem(MOTION_STORAGE_KEY, 'reduced');
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, media: '(prefers-reduced-motion: reduce)', onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.motion).toBe('reduced');
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduced');
  });

  it('ignores invalid cached values and lets the user switch modes', () => {
    localStorage.setItem(MOTION_STORAGE_KEY, 'sometimes');
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, media: '(prefers-reduced-motion: reduce)', onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.motion).toBe('system');
    act(() => result.current.setMotion('full'));
    expect(document.documentElement.getAttribute('data-motion')).toBe('full');
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBe('full');
  });
});
