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
  it('defines every Petri token referenced in frontend source', () => {
    const definitions = new Set<string>();
    const references = new Set<string>();

    for (const file of walk(srcRoot)) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      for (const match of text.matchAll(/--petri-[A-Za-z0-9-]+(?=\s*:)/g)) {
        definitions.add(match[0]);
      }
      for (const match of text.matchAll(/var\(--(petri-[A-Za-z0-9-]+)/g)) {
        references.add(`--${match[1]}`);
      }
    }

    // JS 运行时 setProperty 注入的拖拽期 live token（useResizableColumns），
    // 无静态定义属预期——白名单见 BLOCK-76 会话 🟢 清债登记（AUDIT-LOG 2026-09-08）。
    const JS_INJECTED_TOKENS = new Set([
      '--petri-live-left-width',
      '--petri-live-left-span',
      '--petri-live-right-width',
      '--petri-live-right-span',
      '--petri-live-result-right-width',
    ]);
    const missing = [...references]
      .filter((token) => !definitions.has(token) && !JS_INJECTED_TOKENS.has(token))
      .sort();
    expect(missing).toEqual([]);
  });

  // UI-392 — 海军蓝家族统一后的防回潮门禁（规范见 .agents/skills/petri-css-theme）。

  it('holds no legacy undefined --color-* token references (零定义家族禁回潮)', () => {
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      if (/var\(--color-/.test(text)) offenders.push(path.relative(srcRoot, file));
    }
    expect(offenders).toEqual([]);
  });

  it('holds no slate-family color literals (navy 家族外禁回潮)', () => {
    const FORBIDDEN = [/rgba\(148,\s*163,\s*184/i, /#0f172a\b/i, /#1b1b1d\b/i, /#334155\b/i];
    // 豁免清单（带理由）：light 终端主题在白底上用近黑文字/ANSI 色，属浅色面
    // 正当用色，非暗色 navy 家族管辖范围。
    const ALLOWED_FILES = new Map([['themes/terminal-themes.ts', new Set(['#0f172a\\b'])]]);
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const rel = path.relative(srcRoot, file);
      const allowed = ALLOWED_FILES.get(rel.replaceAll('\\', '/')) || new Set<string>();
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text) && !allowed.has(pattern.source)) {
          offenders.push(`${rel} :: ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('dark token-definition blocks in styles/ out-rank infima (html 前缀特异性)', () => {
    // infima 暗色默认用 html[data-theme='dark']（0,1,1）；本仓 styles/ 下的
    // 暗色定义块若只写 [data-theme='dark']（0,1,0）即为死字（UI-392 根因二：
    // --ifm-background-color/emphasis 系曾整块失效）。多行 selector 组
    // （逗号续行）需整组包含 html 前缀。
    const stylesDir = path.join(srcRoot, 'styles');
    const offenders: string[] = [];
    for (const file of walk(stylesDir)) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      for (const match of text.matchAll(
        /(?:^|\n)((?:[^\n{}]*,\n)*[^\n{}]*\[data-theme='dark'\][^\n{}]*)\s*\{([^{}]*)\}/g,
      )) {
        const selectorGroup = match[1];
        const body = match[2];
        if (body.includes('--ifm-') && !selectorGroup.includes("html[data-theme='dark']")) {
          offenders.push(`${path.relative(srcRoot, file)} :: ${selectorGroup.trim().slice(0, 60)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
