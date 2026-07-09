/**
 * Embedded xterm theme registry + theme-resolution contract.
 *
 * Out-of-the-box light/dark palettes tuned for the BioF3 workspace shell.
 * Theme switching is driven by `document.documentElement.dataset.theme`
 * (values: "light" | "dark"); default falls back to dark when unset.
 *
 * Consumers should:
 *   1. Call `pickTerminalTheme()` at construction time to seed xterm options.
 *   2. Re-invoke via `useTerminalTheme` (or their own MutationObserver) on
 *      `data-theme` mutations to reapply palette live.
 */
import { useEffect, useState } from 'react';
import type { ITheme } from '@xterm/xterm';

export type TerminalThemeName = 'light' | 'dark';

export const TERMINAL_THEMES: Readonly<Record<TerminalThemeName, ITheme>> = {
  dark: {
    background: '#0d1117',
    foreground: '#e6edf3',
    cursor: '#58a6ff',
    cursorAccent: '#0d1117',
    selectionBackground: 'rgba(56, 139, 253, 0.35)',
    black: '#0d1117',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#ffffff',
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
 * Resolve current terminal theme by reading `data-theme` on `<html>`.
 * Returns dark palette when attribute is unset or document is unavailable
 * (SSR / tests).
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