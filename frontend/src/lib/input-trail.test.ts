import { describe, it, expect } from 'vitest';
import { parseContextWindow } from './format-context-window';

describe('input trail during typing', () => {
  it('user types "128K" character by character', () => {
    // Browser fires onChange with the full e.target.value AFTER each keystroke
    const inputs = ['1', '12', '128', '128K'];
    const expected = [1, 12, 128, 128000];
    inputs.forEach((value, i) => {
      expect(parseContextWindow(value)).toBe(expected[i]);
    });
  });

  it('user types "1M" then types "1M " (trailing space)', () => {
    expect(parseContextWindow('1M ')).toBe(1_000_000);
    expect(parseContextWindow(' 1M')).toBe(1_000_000);
  });

  it('user types "1.5M"', () => {
    expect(parseContextWindow('1.5M')).toBe(1_500_000);
  });

  it('user pastes "128000"', () => {
    expect(parseContextWindow('128000')).toBe(128000);
  });

  it('user accidentally types non-numeric then numeric', () => {
    expect(parseContextWindow('1a')).toBeUndefined();
    expect(parseContextWindow('1a2')).toBeUndefined();
    expect(parseContextWindow('1a2K')).toBeUndefined();
  });
});
