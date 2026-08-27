import { describe, it, expect } from 'vitest';
import {
  parseContextWindow,
  formatContextWindow,
} from './format-context-window';

describe('format-context-window', () => {
  describe('parseContextWindow', () => {
    it.each([
      ['', undefined],
      ['64K', 64000],
      ['128k', 128000],
      ['128K', 128000],
      ['1M', 1_000_000],
      ['1m', 1_000_000],
      [' 64K ', 64000],
      ['64000', 64000],
      ['1.5M', 1_500_000],
      ['abc', undefined],
      ['-1K', undefined],
      ['0', undefined],
      [null, undefined],
      [undefined, undefined],
      [128000, 128000],
    ])('parses %p → %p', (input, expected) => {
      expect(parseContextWindow(input)).toBe(expected);
    });
  });

  describe('formatContextWindow', () => {
    it.each([
      [64000, '64K'],
      [128000, '128K'],
      [1_000_000, '1M'],
      [1_500_000, '1.5M'],
      [800, '800'],
      [undefined, ''],
      [null, ''],
      [0, ''],
    ])('formats %p → %p', (input, expected) => {
      expect(formatContextWindow(input)).toBe(expected);
    });
  });

  describe('round-trip K/M display ↔ raw tokens', () => {
    it('preserves common values', () => {
      for (const tokens of [8000, 32000, 64000, 128000, 200000, 500000, 1_000_000]) {
        const formatted = formatContextWindow(tokens);
        const parsed = parseContextWindow(formatted);
        expect(parsed).toBe(tokens);
      }
    });

    it('input field never renders as empty after a successful parse', () => {
      // Simulate user typing "128K"
      const userInput = '128K';
      const parsed = parseContextWindow(userInput);
      expect(parsed).toBe(128000);

      // What gets rendered after a save→reload cycle
      const rendered = formatContextWindow(parsed);
      expect(rendered).toBe('128K');
      expect(rendered).not.toBe('');
    });

    it('empty input clears the value cleanly', () => {
      expect(parseContextWindow('')).toBeUndefined();
      expect(formatContextWindow(undefined)).toBe('');
    });
  });
});