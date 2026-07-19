import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/copilot/simple-chat.css'),
  'utf8',
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))?.[1] ?? '';
}

describe('SimpleChat model menu layout', () => {
  it('allows the upward menu to escape the composer boundary', () => {
    expect(rule('.sc-composer')).toContain('overflow: visible');
    expect(rule('.sc-composer')).toContain('position: relative');
    expect(rule('.sc-model-menu')).toContain('bottom: calc(100% + 8px)');
  });

  it('keeps the menu usable in narrow and short windows', () => {
    expect(rule('.sc-model-menu')).toContain('width: min(280px, calc(100vw - 32px))');
    expect(rule('.sc-model-menu')).toContain('max-height: min(360px, calc(100vh - 168px))');
    expect(rule('.sc-model-menu')).toContain('overflow-y: auto');
  });
});
