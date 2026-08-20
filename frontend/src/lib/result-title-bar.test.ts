import { describe, expect, it } from 'vitest';
import { buildResultTitleBarTitle } from './result-title-bar';

describe('result-title-bar', () => {
  it('keeps project identity in conversation mode', () => {
    // chat mode (and any unrecognized mode) shows the project name only —
    // handleOpenResult preserves 'chat' on auto-open from HomePage so the
    // user sees WHICH project they're in instead of a lone artifact name.
    expect(buildResultTitleBarTitle('chat', 'golden-path')).toBe('golden-path');
    expect(buildResultTitleBarTitle('chat', 'golden-path', 'GO-BP 气泡图 (PNG)')).toBe('golden-path');
  });

  it('uses the active result as the top-level title with project as secondary', () => {
    // BLOCK-10-audit-closeout: home.tsx previously auto-navigated with
    // `?mode=scheduled` which fell through to `result` mode via
    // handleOpenResult, hiding the project name behind '样本对齐详情·结果'.
    // New shape keeps both visible so users always know the project context.
    expect(buildResultTitleBarTitle('result', 'golden-path', 'GO-BP 气泡图 (PNG)')).toBe('GO-BP 气泡图 (PNG) · 结果 · golden-path');
    expect(buildResultTitleBarTitle('code', 'golden-path', 'GO-BP 气泡图 (PNG)')).toBe('GO-BP 气泡图 (PNG) · 代码 · golden-path');
    expect(buildResultTitleBarTitle('compare', 'golden-path', 'GO-BP 气泡图 (PNG)')).toBe('GO-BP 气泡图 (PNG) · 审查修改 · golden-path');
    expect(buildResultTitleBarTitle('history', 'golden-path', 'GO-BP 气泡图 (PNG)')).toBe('GO-BP 气泡图 (PNG) · 版本历史 · golden-path');
  });

  it('falls back to mode + project when no artifact is selected', () => {
    expect(buildResultTitleBarTitle('result', 'golden-path')).toBe('结果 · golden-path');
  });
});
