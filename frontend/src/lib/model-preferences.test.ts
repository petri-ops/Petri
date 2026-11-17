/**
 * BLOCK-456 — 前端镜像与后端单源的一致性契约（跨源矩阵）。
 * 后端 = core/shared-backend/llm-providers/model-profile.js（CJS，createRequire 加载）。
 * 任何一侧改解析规则而另一侧未同步 → 本矩阵红。
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveModelContextWindow,
  resolveModelThinkingDefault,
  type ModelPreferenceProfileLike,
} from './model-preferences';

const require = createRequire(import.meta.url);
const backend = require(resolve(__dirname, '../../../core/shared-backend/llm-providers/model-profile.js')) as {
  resolveModelContextWindow: (profile: ModelPreferenceProfileLike | null | undefined, model?: string) => number | undefined;
  resolveModelThinkingDefault: (profile: ModelPreferenceProfileLike | null | undefined, model?: string) => string | undefined;
};

const PROFILES: (ModelPreferenceProfileLike | null | undefined)[] = [
  null,
  undefined,
  {},
  { contextWindow: 128000 },
  { defaultThinkingLevel: 'standard' },
  { contextWindow: 128000, defaultThinkingLevel: 'high' },
  { contextWindow: 0, defaultThinkingLevel: 'weird' },
  { contextWindow: -5, defaultThinkingLevel: '' },
  { contextWindow: 128000.4, defaultThinkingLevel: 'off' },
  { modelPreferences: { 'm-a': { contextWindow: 400000 } } },
  { modelPreferences: { 'm-a': { thinkingLevel: 'high' } } },
  { contextWindow: 128000, defaultThinkingLevel: 'off', modelPreferences: { 'm-a': { contextWindow: 400000, thinkingLevel: 'high' } } },
  { contextWindow: 128000, defaultThinkingLevel: 'high', modelPreferences: { 'm-a': { contextWindow: 0, thinkingLevel: 'nope' } } },
  { contextWindow: 128000, modelPreferences: { 'm-a': { contextWindow: Number.NaN, thinkingLevel: 'off' } } },
  { contextWindow: 128000, modelPreferences: { 'm-a': { contextWindow: Number.POSITIVE_INFINITY } } },
  { contextWindow: 128000, modelPreferences: { 'm-a': { contextWindow: 63999.6 } } },
  { modelPreferences: { 'm-a': null as never } },
  { modelPreferences: {} },
  { contextWindow: 128000, defaultThinkingLevel: 'standard', modelPreferences: { '带 空格': { contextWindow: 64000, thinkingLevel: 'high' } } },
];

const MODELS: (string | undefined)[] = [
  undefined,
  '',
  'm-a',
  'm-b',
  ' m-a ',
  '带 空格',
  ' 带 空格 ',
];

describe('BLOCK-456 前后端模型偏好解析一致性', () => {
  it('resolveModelContextWindow 跨源矩阵逐字一致（覆写/兜底/非法回落/trim）', () => {
    for (const profile of PROFILES) {
      for (const model of MODELS) {
        const label = `${JSON.stringify(profile)} × ${JSON.stringify(model)}`;
        expect(resolveModelContextWindow(profile, model), label).toEqual(backend.resolveModelContextWindow(profile, model));
      }
    }
  });

  it('resolveModelThinkingDefault 跨源矩阵逐字一致（覆写/兜底/非法回落/trim）', () => {
    for (const profile of PROFILES) {
      for (const model of MODELS) {
        const label = `${JSON.stringify(profile)} × ${JSON.stringify(model)}`;
        expect(resolveModelThinkingDefault(profile, model), label).toEqual(backend.resolveModelThinkingDefault(profile, model));
      }
    }
  });

  it('镜像关键语义抽查（防止两侧同错互抵）', () => {
    const profile: ModelPreferenceProfileLike = {
      contextWindow: 128000,
      defaultThinkingLevel: 'off',
      modelPreferences: { 'm-a': { contextWindow: 400000, thinkingLevel: 'high' } },
    };
    expect(resolveModelContextWindow(profile, 'm-a')).toBe(400000);
    expect(resolveModelThinkingDefault(profile, 'm-a')).toBe('high');
    expect(resolveModelContextWindow(profile, 'm-b')).toBe(128000);
    expect(resolveModelThinkingDefault(profile, 'm-b')).toBe('off');
    expect(resolveModelContextWindow(profile, undefined)).toBe(128000);
    expect(resolveModelThinkingDefault(undefined, 'm-a')).toBeUndefined();
    expect(resolveModelContextWindow({ modelPreferences: { 'm-a': { contextWindow: -1 } }, contextWindow: 64000 }, 'm-a')).toBe(64000);
    expect(resolveModelThinkingDefault({ modelPreferences: { 'm-a': { thinkingLevel: 'ultra' } }, defaultThinkingLevel: 'standard' }, 'm-a')).toBe('standard');
  });
});