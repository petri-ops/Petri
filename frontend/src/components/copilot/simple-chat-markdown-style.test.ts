import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/copilot/simple-chat.css'),
  'utf8',
);

function declarationsStartingAt(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}[^{}]*\\{([^}]*)\\}`, 's'))?.[1] ?? '';
}

describe('SimpleChat Markdown visual contract', () => {
  it('lets the outer language block own the frame instead of framing pre twice', () => {
    const declarations = declarationsStartingAt('.cp-md .cp-code-pre');
    expect(declarations).toContain('border: 0');
    expect(declarations).toContain('border-radius: 0');
    expect(declarations).toContain('background: transparent');
  });

  it('uses only top and bottom separators for plain text fences', () => {
    const baseSelector = '.cp-md .cp-code-pre';
    const plainSelector = '.cp-md .cp-code-block-plain .cp-code-pre';
    const declarations = declarationsStartingAt(plainSelector);
    expect(declarations).toContain('border: 0');
    expect(declarations).toContain('border-top: 1px');
    expect(declarations).toContain('border-bottom: 1px');
    expect(declarations).toContain('border-radius: 0');
    expect(css.indexOf(plainSelector)).toBeGreaterThan(css.indexOf(baseSelector));
  });

  it('clears inherited table cell frames before adding row separators', () => {
    const declarations = declarationsStartingAt('.cp-md .cp-table th,');
    expect(declarations).toContain('border: 0');
    expect(declarations).toContain('border-bottom: 0.5px');
  });
});
