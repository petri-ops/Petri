/**
 * thinkingLevel.test.ts — BLOCK-81 P2 会话级档位持久化与词表（零网络）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THINKING_LEVEL,
  THINKING_LEVEL_LABELS,
  THINKING_LEVELS,
  hasExplicitThinkingLevel,
  loadThinkingLevel,
  migrateThinkingLevel,
  nextThinkingLevel,
  normalizeThinkingLevel,
  resolveEffectiveThinkingLevel,
  saveThinkingLevel,
} from './thinkingLevel';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('thinkingLevel（BLOCK-81 P2）', () => {
  it('词表为三档中性命名，默认标准', () => {
    expect(THINKING_LEVELS).toEqual(['off', 'standard', 'high']);
    expect(DEFAULT_THINKING_LEVEL).toBe('standard');
    expect(THINKING_LEVEL_LABELS.standard).toBe('标准');
  });

  it('归一化：非法/缺失一律回落默认档（标准）', () => {
    expect(normalizeThinkingLevel('high')).toBe('high');
    expect(normalizeThinkingLevel('off')).toBe('off');
    expect(normalizeThinkingLevel('ultra')).toBe('standard');
    expect(normalizeThinkingLevel(null)).toBe('standard');
    expect(normalizeThinkingLevel(undefined)).toBe('standard');
    expect(normalizeThinkingLevel(3)).toBe('standard');
  });

  it('会话级读写：不同会话互不影响', () => {
    saveThinkingLevel('p1', 'c1', 'high');
    saveThinkingLevel('p1', 'c2', 'off');
    expect(loadThinkingLevel('p1', 'c1')).toBe('high');
    expect(loadThinkingLevel('p1', 'c2')).toBe('off');
    // 未写入过的会话/项目 → 默认
    expect(loadThinkingLevel('p1', 'c3')).toBe('standard');
    expect(loadThinkingLevel('p2', 'c1')).toBe('standard');
    // 空会话键（发送前）与项目隔离
    saveThinkingLevel('p1', null, 'high');
    expect(loadThinkingLevel('p1', null)).toBe('high');
    expect(loadThinkingLevel('p2', null)).toBe('standard');
  });

  it('新建会话迁移：档位随会话落到新键（首轮之后不丢档）', () => {
    saveThinkingLevel('p1', null, 'high');
    migrateThinkingLevel('p1', null, 'cNew');
    expect(loadThinkingLevel('p1', 'cNew')).toBe('high');
  });

  it('快捷键循环：标准 → 高 → 关闭 → 标准', () => {
    expect(nextThinkingLevel('standard')).toBe('high');
    expect(nextThinkingLevel('high')).toBe('off');
    expect(nextThinkingLevel('off')).toBe('standard');
  });

  it('存储不可用时静默降级（读取回默认、写入不抛），不影响发送链', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(loadThinkingLevel('p1', 'c1')).toBe('standard');
    expect(() => saveThinkingLevel('p1', 'c1', 'high')).not.toThrow();
  });
});

describe('thinkingLevel（BLOCK-456 发送档生效序）', () => {
  it('hasExplicitThinkingLevel：键在场且合法才算显式覆写', () => {
    expect(hasExplicitThinkingLevel('p1', 'c1')).toBe(false);
    saveThinkingLevel('p1', 'c1', 'high');
    expect(hasExplicitThinkingLevel('p1', 'c1')).toBe(true);
    expect(hasExplicitThinkingLevel('p1', 'c2')).toBe(false);
    window.localStorage.setItem('petri:thinking-level:p1:c3', 'ultra');
    expect(hasExplicitThinkingLevel('p1', 'c3')).toBe(false);
  });

  it('resolveEffectiveThinkingLevel：显式覆写 > 模型级默认 > 会话值', () => {
    expect(resolveEffectiveThinkingLevel(true, 'off', 'high')).toBe('high');
    expect(resolveEffectiveThinkingLevel(false, 'off', 'high')).toBe('off');
    expect(resolveEffectiveThinkingLevel(false, undefined, 'high')).toBe('high');
    expect(resolveEffectiveThinkingLevel(false, undefined, undefined)).toBe(DEFAULT_THINKING_LEVEL);
    expect(resolveEffectiveThinkingLevel(true, 'off', undefined)).toBe(DEFAULT_THINKING_LEVEL);
  });

  it('新建会话迁移：仅迁移显式覆写（无覆写不物化模型默认）', () => {
    migrateThinkingLevel('p1', null, 'cNew');
    expect(hasExplicitThinkingLevel('p1', 'cNew')).toBe(false);
    saveThinkingLevel('p1', null, 'off');
    migrateThinkingLevel('p1', null, 'cNew2');
    expect(loadThinkingLevel('p1', 'cNew2')).toBe('off');
    expect(hasExplicitThinkingLevel('p1', 'cNew2')).toBe(true);
  });

  it('存储不可用时 hasExplicit=false（发送链回落模型默认，不抛）', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(hasExplicitThinkingLevel('p1', 'c1')).toBe(false);
  });
});
