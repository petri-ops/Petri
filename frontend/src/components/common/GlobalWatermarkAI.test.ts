// 内置水墨多候选 — HK-01 红绿先行与机械判据（2026-11-25）。
// 钉四件事：① 后端 oneOf 扩为 8 值；② 前端枚举与注册表双向同源；③ 6 个 builtin id
// 各自映射到正确 PNG；④ none/custom 行为不变、旧 builtin 缓存回落默认远山。观感零代签。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
// CJS 单源注册表只在测试里跨语言对账（生产代码不 import core/**，由 quality:arch 拦）。
// @ts-expect-error 无声明文件；vitest 走 CJS 互操作可用
import * as rawSchema from '../../../../core/packages/shared-config/config-schema.js';
import {
  BUILTIN_WATERMARK_IDS,
  WATERMARK_MODE_VALUES,
  WATERMARK_MODE_STORAGE_KEY,
  isWatermarkMode,
  readCachedWatermarkMode,
} from '@/themes/watermarkPrefs';
import { resolveWatermarkSource } from './GlobalWatermarkAI';

const schema = rawSchema as {
  findKeyEntry: (key: string) => { domain?: { oneOf?: string[] } } | null;
};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const EXPECTED_MODES = [
  'none', 'builtin:mountain', 'builtin:bamboo', 'builtin:plum',
  'builtin:koi', 'builtin:pine', 'builtin:lotus', 'custom',
];
const ID_TO_FILE: Record<string, string> = {
  mountain: 'cultural-watermark.png',
  bamboo: 'watermark-bamboo.png',
  plum: 'watermark-plum.png',
  koi: 'watermark-koi.png',
  pine: 'watermark-pine.png',
  lotus: 'watermark-lotus.png',
};

describe('内置水墨多候选（HK-01）', () => {
  it('后端 oneOf 与前端枚举都扩为 8 值且逐项相等', () => {
    const mode = schema.findKeyEntry('userPrefs.watermarkMode');
    expect(mode?.domain?.oneOf).toEqual(EXPECTED_MODES);
    expect([...WATERMARK_MODE_VALUES]).toEqual(EXPECTED_MODES);
    expect([...BUILTIN_WATERMARK_IDS]).toEqual(['mountain', 'bamboo', 'plum', 'koi', 'pine', 'lotus']);
    for (const value of EXPECTED_MODES) expect(isWatermarkMode(value)).toBe(true);
    expect(isWatermarkMode('builtin')).toBe(false);
    expect(isWatermarkMode('builtin:unknown')).toBe(false);
  });

  it('6 个 builtin id 各自映射到对应 PNG，none 不出图、custom 沿用自定义逻辑', () => {
    for (const id of BUILTIN_WATERMARK_IDS) {
      const source = resolveWatermarkSource(`builtin:${id}`, '', '');
      expect(source, `${id} 应映射到 ${ID_TO_FILE[id]}`).toContain(ID_TO_FILE[id]);
    }
    expect(resolveWatermarkSource('none', 'data:image/png;base64,AA', '/x.png')).toBe('');
    expect(resolveWatermarkSource('custom', 'data:image/png;base64,AA', '/x.png')).toBe('data:image/png;base64,AA');
    expect(resolveWatermarkSource('custom', '', '/x.png')).toBe('/x.png');
  });

  it('旧 builtin 缓存值回落默认远山（保持现状观感）', () => {
    const store = new Map<string, string>([[WATERMARK_MODE_STORAGE_KEY, 'builtin']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    });
    expect(readCachedWatermarkMode()).toBe('builtin:mountain');
  });

  it('全局节点保留完整 mode 值，6 张图全部 import 进组件', () => {
    const source = readFileSync(path.join(ROOT, 'frontend/src/components/common/GlobalWatermarkAI.tsx'), 'utf8');
    expect(source).toMatch(/data-watermark-mode=\{watermarkMode\}/);
    for (const file of Object.values(ID_TO_FILE)) expect(source, file).toContain(file);
  });
});
