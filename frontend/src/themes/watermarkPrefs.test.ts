// 背景水印偏好 — HK-01 红绿先行消费测试。
// 判据：三态枚举域、透明度 0–30%（默认 0.10）、自定义图缓存上限与非法回落、
// 缓存键名冻结（改名=老用户启动缓存静默失效）。观感零代签。
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  WATERMARK_MODE_VALUES,
  WATERMARK_MODE_STORAGE_KEY,
  WATERMARK_OPACITY_STORAGE_KEY,
  WATERMARK_CUSTOM_STORAGE_KEY,
  WATERMARK_OPACITY_MIN,
  WATERMARK_OPACITY_MAX,
  WATERMARK_OPACITY_DEFAULT,
  isWatermarkMode,
  clampWatermarkOpacity,
  readCachedWatermarkMode,
  readCachedWatermarkOpacity,
  readCachedWatermarkCustom,
  writeCachedWatermarkMode,
  writeCachedWatermarkOpacity,
  writeCachedWatermarkCustom,
} from './watermarkPrefs';

describe('背景水印偏好缓存', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });

  it('三态枚举冻结，默认维持现状（内置水墨）', () => {
    expect([...WATERMARK_MODE_VALUES]).toEqual(['none', 'builtin', 'custom']);
    expect(isWatermarkMode('none')).toBe(true);
    expect(isWatermarkMode('custom')).toBe(true);
    expect(isWatermarkMode('whenever')).toBe(false);
    expect(readCachedWatermarkMode()).toBe('builtin');
  });

  it('透明度钳位到 0–30%，默认 0.10', () => {
    expect(WATERMARK_OPACITY_MIN).toBe(0);
    expect(WATERMARK_OPACITY_MAX).toBe(0.3);
    expect(WATERMARK_OPACITY_DEFAULT).toBe(0.1);
    expect(clampWatermarkOpacity(0.5)).toBe(0.3);
    expect(clampWatermarkOpacity(-1)).toBe(0);
    expect(readCachedWatermarkOpacity()).toBe(0.1);
  });

  it('缓存键名冻结', () => {
    expect(WATERMARK_MODE_STORAGE_KEY).toBe('petri-watermark-mode');
    expect(WATERMARK_OPACITY_STORAGE_KEY).toBe('petri-watermark-opacity');
    expect(WATERMARK_CUSTOM_STORAGE_KEY).toBe('petri-watermark-custom');
  });

  it('写入后读回一致，非法值回落默认', () => {
    writeCachedWatermarkMode('custom');
    writeCachedWatermarkOpacity(0.25);
    expect(readCachedWatermarkMode()).toBe('custom');
    expect(readCachedWatermarkOpacity()).toBe(0.25);
    localStorage.setItem(WATERMARK_MODE_STORAGE_KEY, 'bogus');
    localStorage.setItem(WATERMARK_OPACITY_STORAGE_KEY, 'nope');
    expect(readCachedWatermarkMode()).toBe('builtin');
    expect(readCachedWatermarkOpacity()).toBe(0.1);
  });

  it('自定义图缓存只认图片 data URI，超限或不合法一律不采用', () => {
    expect(readCachedWatermarkCustom()).toBe('');
    writeCachedWatermarkCustom('data:image/png;base64,iVBORw0KGgo=');
    expect(readCachedWatermarkCustom()).toBe('data:image/png;base64,iVBORw0KGgo=');
    localStorage.setItem(WATERMARK_CUSTOM_STORAGE_KEY, 'javascript:alert(1)');
    expect(readCachedWatermarkCustom()).toBe('');
    localStorage.setItem(WATERMARK_CUSTOM_STORAGE_KEY, `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`);
    expect(readCachedWatermarkCustom()).toBe('');
  });
});
