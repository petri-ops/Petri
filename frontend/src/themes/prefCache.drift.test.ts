/**
 * BLOCK-203 W4a P7 — 外观偏好缓存 ↔ 配置注册表 漂移测。
 *
 * 为什么需要跨层读 `core/packages/shared-config`：生产代码**不允许**让前端 import `core/**`
 * （`quality:arch` 的 R5 会拦），所以"缓存键名/枚举/钳位边界与注册表同源"这件事只能由
 * 测试承担 —— 先例是 `frontend/src/lib/appKeymap.drift.test.ts`（键位族同款结构）。
 *
 * 钉三件事：
 *  ① 缓存键名**冻结**（改名= 老用户的启动缓存静默失效，外观会闪一下默认值）；
 *  ② 枚举/范围与注册表 `user-prefs` 族逐项相等（曾漏 blue 就是两份集合各自维护的下场）；
 *  ③ **缓存读写单源**：ThemeProvider 不得再直接摸 localStorage（否则"纯缓存"只是口号）。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// CJS 单源注册表，只在测试里跨语言对账（生产构建不引 CJS，故不为它手写 .d.ts）。
// @ts-expect-error 无声明文件；vitest 走 CJS 互操作可用
import * as rawSchema from '../../../core/packages/shared-config/config-schema.js';
import {
  ACCENT_STORAGE_KEY,
  ACCENT_VALUES,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STORAGE_KEY,
  LEGACY_THEME_KEYS,
  THEME_STORAGE_KEY,
  THEME_VALUES,
  clampFontScale,
  isAccentId,
  isThemePreference,
} from './prefCache';

const schema = rawSchema as {
  findKeyEntry: (key: string) => { domain?: { oneOf?: string[]; min?: number; max?: number } } | null;
};

const readRepo = (rel: string) => readFileSync(path.resolve(__dirname, '../../../', rel), 'utf8');

describe('prefCache ↔ user-prefs 注册表', () => {
  it('缓存键名冻结（改名会让老用户的启动缓存静默失效）', () => {
    expect(THEME_STORAGE_KEY).toBe('petri-theme');
    expect(FONT_SCALE_STORAGE_KEY).toBe('petri-font-scale');
    expect(ACCENT_STORAGE_KEY).toBe('petri-accent');
    expect([...LEGACY_THEME_KEYS]).toEqual(['petri-theme', 'theme']);
  });

  it('主题/强调色枚举与服务端注册表逐项相等', () => {
    const theme = schema.findKeyEntry('userPrefs.theme');
    const accent = schema.findKeyEntry('userPrefs.accent');
    expect([...THEME_VALUES]).toEqual(theme?.domain?.oneOf);
    expect([...ACCENT_VALUES]).toEqual(accent?.domain?.oneOf);
  });

  it('字号钳位边界与服务端注册表相同', () => {
    const fontScale = schema.findKeyEntry('userPrefs.fontScale');
    expect(FONT_SCALE_MIN).toBe(fontScale?.domain?.min);
    expect(FONT_SCALE_MAX).toBe(fontScale?.domain?.max);
    expect(clampFontScale(5)).toBe(FONT_SCALE_MAX);
    expect(clampFontScale(0)).toBe(FONT_SCALE_MIN);
  });

  it('谓词与服务端接受的取值一致（缓存里的非法值一律不认）', () => {
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('hacker')).toBe(false);
    expect(isAccentId('blue')).toBe(true);
    expect(isAccentId('orange')).toBe(false);
  });

  it('缓存读写单源：ThemeProvider 不得再直接读写 localStorage', () => {
    const source = readRepo('frontend/src/themes/ThemeProvider.tsx');
    for (const api of ['localStorage.getItem', 'localStorage.setItem', 'localStorage.removeItem']) {
      expect(source.includes(api), `${api} 应留在 prefCache，不进 ThemeProvider`).toBe(false);
    }
  });

  it('prefCache 不得 import core/**（生产代码跨层由 quality:arch 拦，测试是唯一通道）', () => {
    const source = readRepo('frontend/src/themes/prefCache.ts');
    expect(/from\s+['"][^'"]*core\//.test(source)).toBe(false);
  });
});
