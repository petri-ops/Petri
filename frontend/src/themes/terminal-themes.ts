/**
 * Embedded xterm theme registry + theme-resolution contract.
 *
 * Out-of-the-box light/dark palettes tuned for the BioF3 workspace shell.
 * Theme switching is driven by the application's resolved `light` / `dark`
 * value. Callers should pass that value explicitly so xterm and the React
 * shell update from the same source of truth.
 *
 * Consumers should:
 *   1. Call `pickTerminalTheme(resolvedTheme)` when constructing xterm.
 *   2. Re-invoke via `useTerminalTheme` (or their own MutationObserver) on
 *      `data-theme` mutations to reapply palette live.
 */
import { useEffect, useState } from 'react';
import type { ITheme } from '@xterm/xterm';

export type TerminalThemeName = 'light' | 'dark';

export const TERMINAL_THEMES: Readonly<Record<TerminalThemeName, ITheme>> = {
  dark: {
    background: '#111a2e',
    foreground: '#e6edf3',
    cursor: '#2dd4bf',
    cursorAccent: '#111a2e',
    selectionBackground: 'rgba(45, 212, 191, 0.24)',
    black: '#0b1220',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#fbbf24',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#2dd4bf',
    white: '#b1bac4',
    brightBlack: '#8b98ad',
    brightRed: '#fca5a5',
    brightGreen: '#86efac',
    brightYellow: '#fde047',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#5eead4',
    brightWhite: '#f8fafc',
  },
  light: {
    background: '#ffffff',
    foreground: '#0f172a',
    cursor: '#0d9488',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(13, 148, 136, 0.22)',
    black: '#0f172a',
    red: '#b91c1c',
    green: '#15803d',
    yellow: '#a16207',
    blue: '#1d4ed8',
    magenta: '#7e22ce',
    cyan: '#0e7490',
    white: '#475569',
    brightBlack: '#64748b',
    brightRed: '#dc2626',
    brightGreen: '#16a34a',
    brightYellow: '#ca8a04',
    brightBlue: '#2563eb',
    brightMagenta: '#9333ea',
    brightCyan: '#0891b2',
    brightWhite: '#0f172a',
  },
} as const;

/**
 * Resolve an explicit application theme to the matching xterm palette.
 * Unknown or missing values use the dark palette as a safe fallback.
 */
export function pickTerminalTheme(name?: TerminalThemeName | string | null): ITheme {
  const resolved: TerminalThemeName = name === 'light' ? 'light' : 'dark';
  return TERMINAL_THEMES[resolved];
}

/**
 * Hook variant: returns the active theme and re-renders whenever
 * `<html data-theme>` changes. Use this when you want React to drive
 * xterm theme updates; the legacy code uses an explicit MutationObserver,
 * which still works but doesn't trigger re-renders.
 */
export function useTerminalTheme(): ITheme {
  const [name, setName] = useState<TerminalThemeName>(() => readActiveThemeName());

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    const sync = () => setName(readActiveThemeName());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return TERMINAL_THEMES[name];
}

function readActiveThemeName(): TerminalThemeName {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
