import { describe, expect, it } from 'vitest';
import { buildResultTitleBarTitle } from './result-title-bar';

describe('result-title-bar', () => {
  it('keeps project identity when no result is focused in the right rail', () => {
    // 右栏结果 tab 未激活（或无任务）时只显示项目名——用户任何时候都要看见自己在哪个项目（UI-181）。
    expect(buildResultTitleBarTitle(false, 'golden-path')).toBe('golden-path');
    expect(buildResultTitleBarTitle(false, 'golden-path', 'GO-BP 气泡图 (PNG)')).toBe('golden-path');
  });

  it('prefixes the focused artifact while keeping the project as secondary context', () => {
    // BLOCK-334 — 中央四态退役：不再拼「· 结果/代码/审查修改/版本历史」模式后缀，
    // 判据改为右栏结果 tab 激活且有产物。
    expect(buildResultTitleBarTitle(true, 'golden-path', 'GO-BP 气泡图 (PNG)')).toBe('GO-BP 气泡图 (PNG) · golden-path');
  });

  it('falls back to the project when the focused result has no artifact yet', () => {
    expect(buildResultTitleBarTitle(true, 'golden-path')).toBe('golden-path');
    expect(buildResultTitleBarTitle(true, undefined)).toBe('梳理开发进展');
  });
});
