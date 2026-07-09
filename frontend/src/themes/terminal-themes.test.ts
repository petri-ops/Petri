import { describe, expect, it } from 'vitest';
import {
  TERMINAL_THEMES,
  pickTerminalTheme,
  type TerminalThemeName,
} from '@/themes/terminal-themes';

describe('terminal-themes', () => {
  it('exposes light and dark palettes with symmetric keys', () => {
    const expectedKeys: Array<keyof (typeof TERMINAL_THEMES)['dark']> = [
      'background',
      'foreground',
      'cursor',
      'cursorAccent',
      'selectionBackground',
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'brightBlack',
      'brightRed',
      'brightGreen',
      'brightYellow',
      'brightBlue',
      'brightMagenta',
      'brightCyan',
      'brightWhite',
    ];
    for (const key of expectedKeys) {
      expect(TERMINAL_THEMES.dark, `dark.${String(key)}`).toHaveProperty(key);
      expect(TERMINAL_THEMES.light, `light.${String(key)}`).toHaveProperty(key);
    }
  });

  it('uses distinct palettes for light vs dark', () => {
    expect(TERMINAL_THEMES.dark.background).not.toBe(TERMINAL_THEMES.light.background);
    expect(TERMINAL_THEMES.dark.foreground).not.toBe(TERMINAL_THEMES.light.foreground);
  });

  describe('pickTerminalTheme', () => {
    const cases: Array<[unknown, TerminalThemeName]> = [
      ['light', 'light'],
      ['dark', 'dark'],
      [null, 'dark'],
      [undefined, 'dark'],
      ['', 'dark'],
      ['unknown', 'dark'],
    ];
    for (const [input, expected] of cases) {
      it(`returns ${expected} for ${JSON.stringify(input)}`, () => {
        expect(pickTerminalTheme(input as string | null | undefined)).toBe(
          TERMINAL_THEMES[expected],
        );
      });
    }
  });
});
