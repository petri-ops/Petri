import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
// BLOCK-61：新 key 命名空间 gewu-*；历史 key 读兼容（偏好零丢失），写入只落新 key。
const THEME_STORAGE_KEY = 'gewu-theme';
const LEGACY_THEME_KEYS = ['biof3-theme', 'theme'] as const;
const THEME_CHANGE_EVENT = 'gewu:theme-change';

// BLOCK-49 加映三 — 界面字号：root 字号缩放系数（默认 1 = 14px 正文基准）。
// 注入 --gewu-font-scale 到 html.style，全部字号 token 走 calc() 跟随缩放。
const FONT_SCALE_STORAGE_KEY = 'gewu-font-scale';
export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.4;
const FONT_CHANGE_EVENT = 'gewu:font-scale-change';
import { applyAccent, readAccent, ACCENT_STORAGE_KEY, type AccentId } from './accents';
export { type AccentId } from './accents';

function readFontScale(): number {
  try {
    const raw = Number(localStorage.getItem(FONT_SCALE_STORAGE_KEY));
    if (Number.isFinite(raw) && raw >= FONT_SCALE_MIN && raw <= FONT_SCALE_MAX) return raw;
  } catch {
    /* storage unavailable */
  }
  return 1;
}

function applyFontScale(scale: number): void {
  document.documentElement.style.setProperty('--gewu-font-scale', String(scale));
}

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  /** BLOCK-49 加映三 — 界面字号缩放系数（0.8–1.4，默认 1）。 */
  fontScale: number;
  setFontScale: (scale: number) => void;
  /** BLOCK-49 加映三 — 主题色（强调色维度，独立于明暗）。 */
  accent: AccentId;
  setAccent: (accent: AccentId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreference(): ThemePreference {
  try {
    const saved =
      localStorage.getItem(THEME_STORAGE_KEY) ||
      LEGACY_THEME_KEYS.map((key) => localStorage.getItem(key)).find((v) => v != null);
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      // BLOCK-61 读到即迁移：历史 key 偏好落新 key 并清除旧 key
      try {
        if (localStorage.getItem(THEME_STORAGE_KEY) == null) localStorage.setItem(THEME_STORAGE_KEY, saved);
        for (const key of LEGACY_THEME_KEYS) localStorage.removeItem(key);
      } catch {
        /* 迁移写失败不影响读取 */
      }
      return saved;
    }
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
  const [fontScale, setFontScaleState] = useState<number>(readFontScale);
  const [accent, setAccentState] = useState<AccentId>(readAccent);

  // BLOCK-86 L1 — 多端偏好同步：服务端 /api/user/prefs 为权威源，
  // localStorage 仅作启动缓存。任何端修改，其余端（桌面/手机投影）
  // 经轮询 + 回前台拉取应用。
  const prefsApi = React.useCallback(() => `${getPlatformApiPrefix()}/user/prefs`, []);
  const prefsHeaders = React.useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch { /* 非 authClient 场景忽略 */ }
    return headers;
  }, []);

  const applyRemotePrefs = useCallback((prefs: { theme?: string; fontScale?: number; accent?: string }) => {
    if (prefs.theme === 'light' || prefs.theme === 'dark' || prefs.theme === 'system') {
      setPreferenceState(prefs.theme);
      try { localStorage.setItem(THEME_STORAGE_KEY, prefs.theme); } catch { /* 保留内存 */ }
    }
    if (typeof prefs.fontScale === 'number') {
      const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, prefs.fontScale));
      setFontScaleState(clamped);
      try { localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(clamped)); } catch { /* 保留内存 */ }
    }
    if (typeof prefs.accent === 'string' && prefs.accent) {
      setAccentState(prefs.accent as AccentId);
      try { localStorage.setItem(ACCENT_STORAGE_KEY, prefs.accent); } catch { /* 保留内存 */ }
    }
  }, []);

  const pushPrefs = useCallback((patch: Record<string, unknown>) => {
    try {
      void fetch(prefsApi(), { method: 'PUT', headers: prefsHeaders(), body: JSON.stringify(patch) }).catch(() => {});
    } catch { /* 同步失败不影响本端生效 */ }
  }, [prefsApi, prefsHeaders]);

  // 拉取服务端偏好：挂载时 + 每 15s + 回前台时（跨端应用）
  useEffect(() => {
    let last = '';
    const pull = async () => {
      try {
        const response = await fetch(prefsApi(), { headers: prefsHeaders() });
        const data = (await response.json()) as { ok?: unknown; prefs?: { theme?: string; fontScale?: number; accent?: string } };
        if (data?.ok && data.prefs) {
          const signature = JSON.stringify(data.prefs);
          if (signature !== last) {
            last = signature;
            applyRemotePrefs(data.prefs);
          }
        }
      } catch { /* 服务端不可达时保持本地 */ }
    };
    void pull();
    const timer = window.setInterval(() => { void pull(); }, 15_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void pull(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [applyRemotePrefs, prefsApi, prefsHeaders]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Keep the in-memory preference when persistence is unavailable.
    }
    pushPrefs({ theme: next });
  }, [pushPrefs]);

  const setAccent = useCallback((next: AccentId) => {
    setAccentState(next);
    try { localStorage.setItem(ACCENT_STORAGE_KEY, next); } catch { /* 保留内存 */ }
    pushPrefs({ accent: next });
  }, [pushPrefs]);

  const setFontScale = useCallback((scale: number) => {
    const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, scale));
    setFontScaleState(clamped);
    try {
      localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(clamped));
    } catch {
      /* 保留内存偏好 */
    }
    pushPrefs({ fontScale: clamped });
  }, [pushPrefs]);

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

  // BLOCK-49 加映三 — 字号缩放注入（root var；全部字号 token 走 calc 跟随）
  useEffect(() => {
    applyFontScale(fontScale);
  }, [fontScale]);

  // BLOCK-49 加映三 — 主题色注入（data-accent；teal 默认不设属性）
  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  useEffect(() => {
    const onThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ preference?: ThemePreference }>).detail;
      const next = detail?.preference;
      if (next === 'light' || next === 'dark' || next === 'system') {
        setPreference(next);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== FONT_SCALE_STORAGE_KEY) {
        if (!event.key || THEME_STORAGE_KEY === event.key || LEGACY_THEME_KEYS.includes(event.key as typeof LEGACY_THEME_KEYS[number])) {
          setPreferenceState(readPreference());
        }
        return;
      }
      // FONT_SCALE_STORAGE_KEY 变更：跨窗口同步字号
      const next = readFontScale();
      setFontScaleState(next);
    };
    const onFontChange = (event: Event) => {
      const detail = (event as CustomEvent<{ scale?: number }>).detail;
      if (detail && typeof detail.scale === 'number') setFontScaleState(detail.scale);
    };
    const onAccentStorage = (event: StorageEvent) => {
      if (!event.key || event.key !== ACCENT_STORAGE_KEY) return;
      setAccentState(readAccent());
    };
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    window.addEventListener(FONT_CHANGE_EVENT, onFontChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener('storage', onAccentStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
      window.removeEventListener(FONT_CHANGE_EVENT, onFontChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('storage', onAccentStorage);
    };
  }, [setPreference]);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference, fontScale, setFontScale, accent, setAccent }),
    [preference, resolvedTheme, setPreference, fontScale, setFontScale, accent, setAccent],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
