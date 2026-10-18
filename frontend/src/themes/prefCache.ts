/**
 * BLOCK-203 W4a P7 — 外观偏好的**启动缓存**（不是真值）。
 *
 * 真值 = 服务端 `<dataDir>/user-prefs.json`（注册表 `user-prefs` 族，BLOCK-203 P1+P2 收编）。
 * 本模块只承担两件事，别的都不管：
 *  ① localStorage 的键名与枚举域**只在这里出现一次**（此前分散在 ThemeProvider 与 accents 两处）；
 *  ② 缓存读取一律"校验后采用、非法即回落默认"——手改 localStorage 不得把非法值带进渲染。
 *
 * 与真值同源的守护：`prefCache.drift.test.ts` 把这里的键名/枚举/钳位边界与
 * `core/packages/shared-config/config-schema.js` 的 `user-prefs` 族逐项对账。
 * **生产代码不允许 import `core/**`**（`quality:arch` 会拦），故漂移测是唯一跨层通道
 * （先例：`appKeymap.drift.test.ts`）。
 */
/**
 * 强调色/主题的**词汇表**放在这里（而不是 accents.ts）：accents 是"怎么渲染"，
 * 这里是"允许哪些值"。放在渲染侧会造出 `accents ↔ prefCache` 的循环依赖
 * （`gate:arch-cycles` 当场拦下）。
 */
export type AccentId = 'teal' | 'blue' | 'violet' | 'rose' | 'amber';

export const THEME_STORAGE_KEY = 'petri-theme';
export const FONT_SCALE_STORAGE_KEY = 'petri-font-scale';
export const ACCENT_STORAGE_KEY = 'petri-accent';
/** BLOCK-208（W7c）— 动效开关缓存键（真值同 `user-prefs.motion`）。 */
export const MOTION_STORAGE_KEY = 'petri-motion';

/** BLOCK-61：历史 key 读兼容（偏好零丢失），写入只落新 key，读到即迁移。 */
export const LEGACY_THEME_KEYS = ['petri-theme', 'theme'] as const;

export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_VALUES: ReadonlyArray<ThemePreference> = ['system', 'light', 'dark'];
export const ACCENT_VALUES: ReadonlyArray<AccentId> = ['teal', 'blue', 'violet', 'rose', 'amber'];

/** 动效模式：system=跟随系统 prefers-reduced-motion（默认）。 */
export type MotionMode = 'system' | 'full' | 'reduced';
export const MOTION_VALUES: ReadonlyArray<MotionMode> = ['system', 'full', 'reduced'];

/** 与注册表 `userPrefs.fontScale` 的 domain 一致（漂移测兜底）。 */
export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.4;

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_VALUES as ReadonlyArray<string>).includes(value);
}

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === 'string' && (ACCENT_VALUES as ReadonlyArray<string>).includes(value);
}

export function isMotionMode(value: unknown): value is MotionMode {
  return typeof value === 'string' && (MOTION_VALUES as ReadonlyArray<string>).includes(value);
}

export function clampFontScale(value: number): number {
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
}

/** 读取主题偏好（含 legacy 键迁移；非法值/不可用一律回落 system）。 */
export function readCachedTheme(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
      || LEGACY_THEME_KEYS.map((key) => localStorage.getItem(key)).find((value) => value != null);
    if (isThemePreference(saved)) {
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

/** 读取字号缓存（域外/非数值一律回落 1 = 默认）。 */
export function readCachedFontScale(): number {
  try {
    const raw = Number(localStorage.getItem(FONT_SCALE_STORAGE_KEY));
    if (Number.isFinite(raw) && raw >= FONT_SCALE_MIN && raw <= FONT_SCALE_MAX) return raw;
  } catch {
    /* storage unavailable */
  }
  return 1;
}

/** 读取强调色缓存（非法值回落 teal）。 */
export function readCachedAccent(): AccentId {
  try {
    const saved = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (isAccentId(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  return 'teal';
}

/** 读取动效模式缓存（非法/不可用 ⇒ system，零行为变化）。 */
export function readCachedMotion(): MotionMode {
  try {
    const saved = localStorage.getItem(MOTION_STORAGE_KEY);
    if (isMotionMode(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

/** 写缓存：失败只忽略（本端内存仍生效；服务端同步另有一条链）。 */
export function writeCachedTheme(value: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    /* Keep the in-memory preference when persistence is unavailable. */
  }
}

export function writeCachedFontScale(value: number): void {
  try {
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(value));
  } catch {
    /* 保留内存偏好 */
  }
}

export function writeCachedMotion(value: MotionMode): void {
  try {
    localStorage.setItem(MOTION_STORAGE_KEY, value);
  } catch {
    /* 保留内存偏好 */
  }
}

export function writeCachedAccent(value: AccentId): void {
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, value);
  } catch {
    /* 保留内存偏好 */
  }
}
