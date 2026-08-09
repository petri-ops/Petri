import { describe, expect, it } from 'vitest';
import { buildResultTitleBarTitle } from './result-title-bar';

describe('result-title-bar', () => {
  it('keeps project identity in conversation mode', () => {
    expect(buildResultTitleBarTitle('chat', 'golden-path')).toBe('golden-path');
  });

  it('uses the active result as the top-level title', () => {
    expect(buildResultTitleBarTitle('result', 'golden-path', 'GO-BP 气泡图 (PNG)')).toBe('GO-BP 气泡图 (PNG) · 结果');
    expect(buildResultTitleBarTitle('code', 'golden-path', 'GO-BP 气泡图 (PNG)')).toBe('GO-BP 气泡图 (PNG) · 代码');
    expect(buildResultTitleBarTitle('compare', 'golden-path', 'GO-BP 气泡图 (PNG)')).toBe('GO-BP 气泡图 (PNG) · 审查修改');
    expect(buildResultTitleBarTitle('history', 'golden-path', 'GO-BP 气泡图 (PNG)')).toBe('GO-BP 气泡图 (PNG) · 版本历史');
  });

  it('falls back to the mode when no artifact is selected', () => {
    expect(buildResultTitleBarTitle('result', 'golden-path')).toBe('结果');
  });
});
