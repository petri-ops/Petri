import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    if (!/\.(css|ts|tsx|js|jsx)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx|js|jsx)$/.test(entry.name) || /\.spec\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    files.push(fullPath);
  }
  return files;
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\S\r\n])\/\/.*$/gm, '$1');
}

describe('theme token contract', () => {
  it('defines every Gewu token referenced in frontend source', () => {
    const definitions = new Set<string>();
    const references = new Set<string>();

    for (const file of walk(srcRoot)) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      for (const match of text.matchAll(/--gewu-[A-Za-z0-9-]+(?=\s*:)/g)) {
        definitions.add(match[0]);
      }
      for (const match of text.matchAll(/var\(--(gewu-[A-Za-z0-9-]+)/g)) {
        references.add(`--${match[1]}`);
      }
    }

    // JS 运行时 setProperty 注入的拖拽期 live token（useResizableColumns），
    // 无静态定义属预期——白名单见 BLOCK-76 会话 🟢 清债登记（AUDIT-LOG 2026-09-08）。
    const JS_INJECTED_TOKENS = new Set([
      '--gewu-live-left-width',
      '--gewu-live-left-span',
      '--gewu-live-right-width',
      '--gewu-live-right-span',
      '--gewu-live-result-right-width',
    ]);
    const missing = [...references]
      .filter((token) => !definitions.has(token) && !JS_INJECTED_TOKENS.has(token))
      .sort();
    expect(missing).toEqual([]);
  });
});
