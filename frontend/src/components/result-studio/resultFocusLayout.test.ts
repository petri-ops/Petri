import { describe, expect, it } from 'vitest';
import { isResultWorkspaceMode, resultFocusTransition } from './resultFocusLayout';

describe('Result Studio focus layout', () => {
  it.each(['result', 'code', 'compare', 'history'] as const)(
    'treats %s as the same focused result session',
    (mode) => expect(isResultWorkspaceMode(mode)).toBe(true),
  );

  it('closes panels only on entry and restores only on exit', () => {
    expect(resultFocusTransition(false, 'result')).toBe('enter');
    expect(resultFocusTransition(true, 'compare')).toBe('stay');
    expect(resultFocusTransition(true, 'history')).toBe('stay');
    expect(resultFocusTransition(true, 'chat')).toBe('exit');
    expect(resultFocusTransition(false, 'chat')).toBe('idle');
  });
});
