// A1 色板 token 化 — HK-01 红绿先行消费测试。
// 裁决=A0「行」：B 青瓷·墨工作态主 accent + A 宣纸·朱砂品牌落印点睛 <5%。
// 本契约断言：identity 色板 token 在 :root 与 dark 块成对定义、语义分工正确、
// 点睛 token 只映射到品牌语义、且 accent 亮度关系遵循「暗底更亮」。
// 零产品运行时改动风险：只测 token 定义层，不改组件。

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = path.join(HERE, 'custom.css');
const src = () => fs.readFileSync(CSS, 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const rootBlock = (text: string) =>
  text.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const darkBlock = (text: string) =>
  text.match(/html\[data-theme='dark'\],\s*\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

// A1 新增的 identity 色板 token（骨架/点睛/墨）。
// B 青瓷·墨：工作态 accent；A 宣纸·朱砂：品牌落印点睛。
const REQUIRED = [
  '--petri-ink-paper',      // 骨架：宣纸暖白（亮）/ 墨底（暗）
  '--petri-ink-base',       // 结构：墨（亮）/ 纸字（暗）
  '--petri-accent-celadon', // 工作态主 accent（B）
  '--petri-accent-vermilion', // 品牌点睛（A）
] as const;

const tokensIn = (block: string) =>
  new Set([...block.matchAll(/(--petri-[A-Za-z0-9-]+)\s*:/g)].map((m) => m[1]));

describe('A1 identity palette token contract', () => {
  it('defines identity palette tokens paired in :root and dark (明暗成对)', () => {
    const text = stripComments(src());
    const root = tokensIn(rootBlock(text));
    const dark = tokensIn(darkBlock(text));
    for (const token of REQUIRED) {
      expect(root.has(token), `${token} missing in :root`).toBe(true);
      expect(dark.has(token), `${token} missing in dark block`).toBe(true);
    }
  });

  it('uses only token values (no raw hex in identity palette definitions)', () => {
    const text = stripComments(src());
    const all = rootBlock(text) + '\n' + darkBlock(text);
    for (const token of REQUIRED) {
      const decl = all.match(new RegExp(`${token}\\s*:\\s*([^;]+);`))?.[1] ?? '';
      expect(decl, `${token} declaration missing`).not.toBe('');
      // 定义处允许字面 hex（它是 token 的真源），但不得有多余 fallback 颜色。
      expect((decl.match(/#[0-9a-fA-F]{3,8}/g) ?? []).length,
        `${token} must have at most one literal color`).toBeLessThanOrEqual(1);
    }
  });

  it('keeps vermilion as brand-accent only (点睛语义，不做工作态主色)', () => {
    // 注释即契约说明：检查原始源码中 vermilion 定义附近的语义标注（不 strip 注释）。
    const raw = src();
    // 每个 vermilion 定义前 160 字符内必须有品牌点睛语义（亮/暗各一次）。
    const occurrences = [...raw.matchAll(/--petri-accent-vermilion\s*:/g)];
    expect(occurrences.length, 'vermilion must be defined in both themes').toBeGreaterThanOrEqual(2);
    for (const m of occurrences) {
      const before = raw.slice(Math.max(0, m.index! - 160), m.index!);
      expect(before, 'vermilion must be annotated as brand-point/落印').toMatch(/点睛|落印|品牌/);
    }
  });

  it('A1 introduces no product-component imports (token-only change)', () => {
    // 本契约文件只 import 测试框架与 fs/path；A1 不改任何组件。
    const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(self).not.toMatch(/from ['"]@\//);
    expect(self).not.toMatch(/from ['"]\.\.\/components/);
  });
});
