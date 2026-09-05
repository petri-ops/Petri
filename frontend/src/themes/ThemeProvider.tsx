import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
// BLOCK-61：新 key 命名空间 gewu-*；历史 key 读兼容（偏好零丢失），写入只落新 key。
const THEME_STORAGE_KEY = 'gewu-theme';
const LEGACY_THEME_KEYS = ['gewu-theme', 'theme'] as const;
const THEME_CHANGE_EVENT = 'gewu:theme-change';

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreference(): ThemePreference {
  try {
    const saved =
      localStorage.getItem(THEME_STORAGE_KEY) ||
      LEGACY_THEME_KEYS.map((key) => localStorage.getItem(key)).find((v) => v != null);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // Storage can be unavailable in hardened renderer contexts.
  }
  return 'system';
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemResolvedTheme, setSystemResolvedTheme] = useState<ResolvedTheme>(systemTheme);
  const resolvedTheme = preference === 'system' ? systemResolvedTheme : preference;

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Keep the in-memory preference when persistence is unavailable.
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const update = () => setSystemResolvedTheme(media.matches ? 'dark' : 'light');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-theme', resolvedTheme);
    html.setAttribute('data-theme-preference', preference);
    html.style.colorScheme = resolvedTheme;
  }, [preference, resolvedTheme]);

  useEffect(() => {
    const onThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ preference?: ThemePreference }>).detail;
      const next = detail?.preference;
      if (next === 'light' || next === 'dark' || next === 'system') {
        setPreference(next);
      }
    };
      const onStorage = (event: StorageEvent) => {
        if (event.key && event.key !== THEME_STORAGE_KEY && !LEGACY_THEME_KEYS.includes(event.key as typeof LEGACY_THEME_KEYS[number])) return;
        setPreferenceState(readPreference());
      };
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [setPreference]);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
