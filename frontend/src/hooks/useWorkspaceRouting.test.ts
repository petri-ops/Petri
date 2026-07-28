import { describe, expect, it } from 'vitest';
import { parseWorkspaceMode } from './useWorkspaceRouting';

describe('G0-RS-P1 workspace route projection', () => {
  it('accepts durable result modes and rejects unknown projections', () => {
    expect(parseWorkspaceMode('result')).toBe('result');
    expect(parseWorkspaceMode('compare')).toBe('compare');
    expect(parseWorkspaceMode('history')).toBe('history');
    expect(parseWorkspaceMode('chat')).toBe('chat');
    expect(parseWorkspaceMode('code')).toBe('code');
    expect(parseWorkspaceMode('unknown')).toBeNull();
    expect(parseWorkspaceMode(null)).toBeNull();
  });
});
