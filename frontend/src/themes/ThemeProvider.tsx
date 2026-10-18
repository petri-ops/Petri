import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

/**
 * BLOCK-203 W4a P7 — 主题/字号/强调色的 localStorage 读写、键名与枚举域统一由 `prefCache` 供应。
 * 真值是服务端 `user-prefs.json`（注册表 `user-prefs` 族）；localStorage 只是**启动缓存**：
 * 先前打开就能用正确外观，随后由服务端值收敛。键名/枚举/钳位边界与注册表的一致性
 * 由 `prefCache.drift.test.ts` 双向钉住（前端生产代码不 import `core/**`）。
 */
import {
  ACCENT_STORAGE_KEY,
  FONT_SCALE_STORAGE_KEY,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  LEGACY_THEME_KEYS,
  clampFontScale,
  THEME_STORAGE_KEY,
  readCachedFontScale,
  readCachedMotion,
  readCachedTheme,
  writeCachedAccent,
  writeCachedFontScale,
  writeCachedTheme,
  writeCachedMotion,
  type MotionMode,
  type ThemePreference,
} from './prefCache';

export type { ThemePreference } from './prefCache';
export { FONT_SCALE_MIN, FONT_SCALE_MAX };
export type ResolvedTheme = 'light' | 'dark';
const THEME_CHANGE_EVENT = 'petri:theme-change';
const FONT_CHANGE_EVENT = 'petri:font-scale-change';
import { applyAccent, readAccent, type AccentId } from './accents';
export { type AccentId } from './accents';

const readFontScale = readCachedFontScale;
const readPreference = readCachedTheme;

function applyFontScale(scale: number): void {
  document.documentElement.style.setProperty('--petri-font-scale', String(scale));
}

/**
 * BLOCK-199 P4③ — 跨端偏好同步的状态（原状是 `void fetch(...).catch(()=>{})`：本端已生效、
 * 服务端可能没收到、用户与调用方一律看不见 ⇒ "另一个窗口读到旧值"无从归因）。
 * 状态只增不改既有生效顺序：本地立即生效 + 15s 拉取回正（回滚到服务端真相）都保持原样。
 */
interface PrefsSyncState {
  state: 'ok' | 'pending' | 'failed';
  error?: string;
  at: number;
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
  /** BLOCK-208 — 动效开关（system=跟随系统 prefers-reduced-motion）。 */
  motion: MotionMode;
  setMotion: (mode: MotionMode) => void;
  /** 服务端偏好同步状态（设置面据此提示"本机已生效但没存到服务端"）。 */
  prefsSync: PrefsSyncState;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemResolvedTheme, setSystemResolvedTheme] = useState<ResolvedTheme>(systemTheme);
  const resolvedTheme = preference === 'system' ? systemResolvedTheme : preference;
  const [fontScale, setFontScaleState] = useState<number>(readFontScale);
  const [accent, setAccentState] = useState<AccentId>(readAccent);
  const [motion, setMotionState] = useState<MotionMode>(readCachedMotion);

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

  const applyRemotePrefs = useCallback((prefs: { theme?: string; fontScale?: number; accent?: string; motion?: string }) => {
    if (prefs.theme === 'light' || prefs.theme === 'dark' || prefs.theme === 'system') {
      setPreferenceState(prefs.theme);
      writeCachedTheme(prefs.theme);
    }
    if (typeof prefs.fontScale === 'number') {
      const clamped = clampFontScale(prefs.fontScale);
      setFontScaleState(clamped);
      writeCachedFontScale(clamped);
    }
    if (typeof prefs.accent === 'string' && prefs.accent) {
      setAccentState(prefs.accent as AccentId);
      writeCachedAccent(prefs.accent as AccentId);
    }
    // BLOCK-208 — 动效偏好跨端应用（与其它外观偏好同一条链）
    if (typeof prefs.motion === 'string' && ['system', 'full', 'reduced'].includes(prefs.motion)) {
      setMotionState(prefs.motion as MotionMode);
      writeCachedMotion(prefs.motion as MotionMode);
    }
  }, []);

  const [prefsSync, setPrefsSync] = useState<PrefsSyncState>({ state: 'ok', at: 0 });

  const pushPrefs = useCallback((patch: Record<string, unknown>) => {
    setPrefsSync({ state: 'pending', at: Date.now() });
    const fail = (error: string) => {
      setPrefsSync({ state: 'failed', error, at: Date.now() });
      // 失败不回滚本端（本地先生效是既有体验契约），但必须可见：状态入 context + 控制台留痕。
      console.warn(`[prefs] 服务端同步失败（本端已生效）：${error}`);
    };
    try {
      void fetch(prefsApi(), { method: 'PUT', headers: prefsHeaders(), body: JSON.stringify(patch) })
        .then((response) => {
          if (response?.ok) { setPrefsSync({ state: 'ok', at: Date.now() }); return; }
          fail(`HTTP ${response?.status ?? '?'}`);
        })
        .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
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
    // Keep the in-memory preference when persistence is unavailable.
    writeCachedTheme(next);
    pushPrefs({ theme: next });
  }, [pushPrefs]);

  const setMotion = useCallback((next: MotionMode) => {
    setMotionState(next);
    writeCachedMotion(next);
    pushPrefs({ motion: next });
  }, [pushPrefs]);

  const setAccent = useCallback((next: AccentId) => {
    setAccentState(next);
    writeCachedAccent(next);
    pushPrefs({ accent: next });
  }, [pushPrefs]);

  const setFontScale = useCallback((scale: number) => {
    const clamped = clampFontScale(scale);
    setFontScaleState(clamped);
    /* 保留内存偏好：写失败不影响本端生效 */
    writeCachedFontScale(clamped);
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

  // BLOCK-208（W7c）— 动效开关：`data-motion` 交给 CSS（reduced 降级时长/行为；
  // system 由 `prefers-reduced-motion` 媒体查询负责，JS 不去猜系统设置）。
  useEffect(() => {
    document.documentElement.setAttribute('data-motion', motion);
  }, [motion]);

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
    () => ({ preference, resolvedTheme, setPreference, fontScale, setFontScale, accent, setAccent, motion, setMotion, prefsSync }),
    [preference, resolvedTheme, setPreference, fontScale, setFontScale, accent, setAccent, motion, setMotion, prefsSync],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * BLOCK-213 — 可选读取主题上下文（无 Provider 时返回 null，不抛）。
 *
 * 命令面板等"可能脱离 Provider 被单测直接调用"的钩子用它构建外观类命令；
 * `useTheme` 保持严格（缺 Provider 必须炸，那是真 bug）。
 */
export function useThemeOptional(): ThemeContextValue | null {
  return useContext(ThemeContext);
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
