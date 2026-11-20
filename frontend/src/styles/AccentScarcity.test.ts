// V1 配色稀缺化 — HK-01 红绿先行消费测试。
// 目标：装饰性 accent 归零（双击强调的冗余 color / 装饰 glow / 通用图标色），
// 保留五类合法语义（主按钮 / 激活选中 / 链接 / 焦点环 / 状态语义）。
// targetMet(≤130) 是终态目标：本测试要求总量严格下降且 ratchet 同步下调，
// 不伪造 targetMet=true（剩余为合法语义，需 U 类裁决才能进一步收敛）。
// 观感零代签：静态结构只证明收敛，不声明视觉通过。

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS_ROOT = path.join(ROOT);
const CHARTER = path.join(ROOT, '..', '..', 'docs', 'design-charter.md');

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
  walk(CSS_ROOT);
  return out;
};

type Rule = { file: string; sel: string; body: string };
const rules = (): Rule[] => {
  const out: Rule[] = [];
  for (const f of cssFiles()) {
    const t = strip(fs.readFileSync(f, 'utf8'));
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(t))) {
      out.push({ file: path.relative(CSS_ROOT, f), sel: m[1].trim().split('\n').pop()!.trim(), body: m[2] });
    }
  }
  return out;
};

const countAccent = () =>
  cssFiles().reduce((n, f) => n + (strip(fs.readFileSync(f, 'utf8')).match(/var\(--petri-accent\)/g) || []).length, 0);

describe('V1 accent scarcity', () => {
  it('no double-emphasis: accent-bg background must not pair with accent text color', () => {
    const bad = rules().filter((r) =>
      /background[^;]*var\(--petri-accent-bg\)/.test(r.body) &&
      /(?:^|;)\s*color:\s*var\(--petri-accent\)(?!-)/.test(r.body),
    );
    expect(bad.map((r) => `${r.file} :: ${r.sel}`)).toEqual([]);
  });

  it('no decorative accent glow (box-shadow on non-focus selectors)', () => {
    const bad = rules().filter((r) =>
      /box-shadow[^;]*var\(--petri-accent\)/.test(r.body) && !/focus/i.test(r.sel),
    );
    expect(bad.map((r) => `${r.file} :: ${r.sel}`)).toEqual([]);
  });

  it('generic icon surfaces use neutral text, not accent', () => {
    const bad = rules().filter((r) =>
      /(?:__icon|\.icon\b|Icon)/.test(r.sel) &&
      /color:\s*var\(--petri-accent\)(?!-)/.test(r.body) &&
      !/Active|active|:hover|focus|\[data-status|\[aria-(?:pressed|selected)/.test(r.sel),
    );
    expect(bad.map((r) => `${r.file} :: ${r.sel}`)).toEqual([]);
  });

  it('total accent strictly decreases from the 356 baseline', () => {
    const total = countAccent();
    expect(total, `current=${total}, baseline=356`).toBeLessThan(356);
  });

  it('charter ceiling is still 130 and targetMet is NOT faked', () => {
    const charter = fs.readFileSync(CHARTER, 'utf8');
    expect(charter).toMatch(/引用总量终态\s*≤130/);
    // 本测试不写达标断言；真值由 c53 生成器现读，剩余合法语义需 U 类裁决。
    const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(self).not.toMatch(/expect\([^)]*targetMet[^)]*\)\.toBe\(true\)/);
  });
});
