import { describe, expect, it } from 'vitest';
import { parseWorkspaceMode, segmentToMode } from './useWorkspaceRouting';

describe('workspace route projection', () => {
  it('accepts the two center modes and rejects unknown projections', () => {
    expect(parseWorkspaceMode('chat')).toBe('chat');
    expect(parseWorkspaceMode('scheduled')).toBe('scheduled');
    expect(parseWorkspaceMode('unknown')).toBeNull();
    expect(parseWorkspaceMode(null)).toBeNull();
  });

  // UI-657（BLOCK-334）— 结果查看迁右栏后中央四态出籍：旧深链 fail-closed 落 chat，
  // 与 search/plugins/settings 退役同口径（`?job=` 仍由 open-effects 打开右栏结果）。
  it('fails closed to chat for the retired result/code/compare/history segments', () => {
    for (const retired of ['result', 'code', 'compare', 'history']) {
      expect(parseWorkspaceMode(retired)).toBeNull();
      expect(segmentToMode(retired)).toBe('chat');
    }
  });
});
