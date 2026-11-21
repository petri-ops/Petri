// V1-U 语义收敛 — HK-01 红绿先行消费测试。
// 用户裁决「行」的唯一建议：只收敛 hover/active 的文字 accent（底色/边框仍需承载反馈），
// focus 环 / 主按钮 / 链接 / 状态色全部保留；不伪造 targetMet。
// 断言：① hover/active 规则无 accent 文字色 ② 凡原仅有文字反馈者已补中性 hover 底
// ③ focus 环 accent 保留 ④ 总量严格下降 ⑤ targetMet 未被写成 true。

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const cssFiles = (): string[] => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.css')) out.push(p);
    }
  };
  walk(ROOT);
  return out;
};
type Rule = { file: string; sel: string; body: string };
const rules = (): Rule[] => {
  const out: Rule[] = [];
  for (const f of cssFiles()) {
    const t = strip(fs.readFileSync(f, 'utf8'));
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(t))) out.push({ file: path.relative(ROOT, f), sel: m[1].trim().split('\n').pop()!.trim(), body: m[2] });
  }
  return out;
};
const accentColor = (b: string) => /(?:^|;)\s*color:\s*var\(--petri-accent\)(?!-)/.test(b);
const hoverOrActive = (s: string) => /:hover|Active|active/.test(s) && !/focus/i.test(s);
const totalAccent = () => cssFiles().reduce((n, f) => n + (strip(fs.readFileSync(f, 'utf8')).match(/var\(--petri-accent\)/g) || []).length, 0);

describe('V1-U semantic accent convergence', () => {
  it('no accent text color remains in hover/active rules', () => {
    const bad = rules().filter((r) => hoverOrActive(r.sel) && accentColor(r.body));
    expect(bad.map((r) => `${r.file} :: ${r.sel}`)).toEqual([]);
  });

  it('every converted rule keeps a feedback channel (bg/border/underline/shadow)', () => {
    const manifestPath = path.join(ROOT, '..', '..', 'acceptance', 'v1u-accent-semantics', 'converted.json');
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { rules?: Array<{ file: string; sel: string; addedBg: boolean }> };
    const converted = parsed.rules ?? [];
    expect(converted.length, 'conversion manifest must exist and be non-empty').toBeGreaterThan(0);
    const feedback = /(?:^|;)\s*background\s*:|border[^:]*:[^;]*var\(|text-decoration:|box-shadow:/;
    const byFile = new Map<string, Rule[]>();
    for (const r of rules()) {
      const arr = byFile.get(r.file) || [];
      arr.push(r);
      byFile.set(r.file, arr);
    }
    const bad: string[] = [];
    for (const c of converted) {
      const rule = (byFile.get(c.file) || []).find((r) => r.sel === c.sel);
      if (!rule || (!feedback.test(rule.body) && !/\[aria-selected|aria-pressed|:checked|data-tone|data-state|is-selected/.test(rule.sel))) {
        bad.push(`${c.file} :: ${c.sel}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('focus ring accent is preserved (WCAG)', () => {
    const focusRules = rules().filter((r) => /focus/i.test(r.sel));
    const rings = focusRules.filter((r) => /var\(--petri-accent\)/.test(r.body));
    expect(rings.length, 'focus ring must keep accent').toBeGreaterThan(0);
  });

  it('total accent strictly decreases from 316', () => {
    expect(totalAccent(), `current=${totalAccent()}, previous=316`).toBeLessThan(316);
  });

  it('targetMet is not faked by aliases', () => {
    const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(self).not.toMatch(/expect\([^)]*targetMet[^)]*\)\.toBe\(true\)/);
  });
});
