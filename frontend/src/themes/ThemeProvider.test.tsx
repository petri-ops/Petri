import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeProvider';

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

function mockSystemTheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return dark; },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
  return (nextDark: boolean) => {
    dark = nextDark;
    listeners.forEach((listener) => listener());
  };
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-preference');
  document.documentElement.style.colorScheme = '';
  vi.unstubAllGlobals();
});

describe('ThemeProvider', () => {
  it('defaults to system and follows system changes', () => {
    const setSystemDark = mockSystemTheme(false);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe('system');
    expect(result.current.resolvedTheme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    act(() => setSystemDark(true));
    expect(result.current.resolvedTheme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('migrates existing light or dark storage and ignores system changes', () => {
    localStorage.setItem('gewu-theme', 'dark');
    const setSystemDark = mockSystemTheme(false);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');

    act(() => setSystemDark(true));
    act(() => setSystemDark(false));
    expect(result.current.resolvedTheme).toBe('dark');
  });

  it('accepts the legacy theme storage key for startup compatibility', () => {
    localStorage.setItem('theme', 'light');
    mockSystemTheme(true);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
  });

  it('persists all three preferences and updates color-scheme', () => {
    mockSystemTheme(false);
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => result.current.setPreference('dark'));
    expect(localStorage.getItem('gewu-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');

    act(() => result.current.setPreference('system'));
    expect(localStorage.getItem('gewu-theme')).toBe('system');
    expect(document.documentElement.dataset.themePreference).toBe('system');
  });

  it('syncs external theme change events into the provider state', () => {
    mockSystemTheme(false);
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('gewu:theme-change', {
          detail: { preference: 'dark' },
        })
      );
    });

    expect(result.current.preference).toBe('dark');
    expect(localStorage.getItem('gewu-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
