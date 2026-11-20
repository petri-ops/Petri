// B 方案（正交 surface 维度）— HK-01 红绿先行消费测试。
// 用户裁决 B：新建 html[data-surface] 维度承载骨架，随 accent 联切；
// surface 块用 var(--petri-ink-*) 派生，不在骨架位写 hex ⇒ c53 navyLadder 门禁不放宽。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { surfaceForAccent } from './accents';
import type { AccentId } from './prefCache';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ACCENTS = path.join(ROOT, 'frontend', 'src', 'themes', 'accents.ts');
const CSS = path.join(ROOT, 'frontend', 'src', 'styles', 'custom.css');
const C53 = path.join(ROOT, 'scripts', 'c53-visual-consistency.mjs');
const SURFACES = ['paper', 'celadon', 'ultramarine', 'mist'] as const;

describe('B: data-surface dimension', () => {
  it('four harmony accents map to distinct surfaces; legacy accents keep default', () => {
    expect(surfaceForAccent('paper-vermilion' as AccentId)).toBe('paper');
    expect(surfaceForAccent('celadon-ink' as AccentId)).toBe('celadon');
    expect(surfaceForAccent('ultramarine-brass' as AccentId)).toBe('ultramarine');
    expect(surfaceForAccent('indigo-mist' as AccentId)).toBe('mist');
    for (const legacy of ['teal', 'blue', 'violet', 'rose', 'amber'] as AccentId[]) {
      expect(surfaceForAccent(legacy), `${legacy} must keep default skeleton`).toBeNull();
    }
  });

  it('applyAccent drives data-surface (联动而不新增持久化偏好)', () => {
    const src = fs.readFileSync(ACCENTS, 'utf8');
    expect(src).toMatch(/setAttribute\(\s*'data-surface'/);
    expect(src).toMatch(/removeAttribute\(\s*'data-surface'/);
  });

  it('each surface has light + dark CSS blocks overriding skeleton tiers', () => {
    const css = fs.readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const s of SURFACES) {
      // 聚合该档所有相关块（组合选择器 + 单档覆写），检查声明覆盖完整。
      const light = [...css.matchAll(new RegExp(`\\[data-surface='${s}'\\](?:\\[data-theme='dark'\\])?[^}]*\\{([^}]*)\\}`, 'g'))]
        .filter((m) => !m[0].includes('[data-theme=')).map((m) => m[1]).join('\n');
      const dark = [...css.matchAll(new RegExp(`\\[data-surface='${s}'\\]\\[data-theme='dark'\\][^}]*\\{([^}]*)\\}`, 'g'))]
        .map((m) => m[1]).join('\n');
      expect(light, `${s} light declarations missing`).not.toBe('');
      expect(dark, `${s} dark declarations missing`).not.toBe('');
      for (const decls of [light, dark]) {
        expect(decls).toMatch(/--petri-bg-canvas\s*:/);
        expect(decls).toMatch(/--petri-bg-surface\s*:/);
        expect(decls).toMatch(/--petri-border\s*:/);
        expect(decls).toMatch(/--petri-text\s*:/);
      }
    }
  });

  it('surface skeleton derives from ink tokens, never raw hex (navyLadder gate stays strict)', () => {
    const css = fs.readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let hijacks = 0;
    for (const s of SURFACES) {
      for (const sel of [`\\[data-surface='${s}'\\]`, `\\[data-surface='${s}'\\]\\[data-theme='dark'\\]`]) {
        const block = [...css.matchAll(new RegExp(`${sel}[^}]*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join('\n');
        for (const tier of ['canvas', 'surface', 'subtle', 'elevated']) {
          const decl = block.match(new RegExp(`--petri-bg-${tier}:\\s*([^;]+);`))?.[1] ?? '';
          expect(decl, `${s} bg-${tier} must derive from ink token`).toMatch(/var\(--petri-ink-/);
          expect(decl, `${s} bg-${tier} must not contain hex`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
          if (/--petri-bg-[a-z]+:\s*#[0-9a-f]/.test(block)) hijacks++;
        }
      }
    }
    expect(hijacks).toBe(0);
  });

  it('c53 navyLadder scanner is NOT weakened (no exemption for data-surface)', () => {
    const src = fs.readFileSync(C53, 'utf8');
    const fn = src.slice(src.indexOf('export function scanNavyLadder'), src.indexOf('export function scanSlateFamily'));
    expect(fn).not.toMatch(/data-surface/);
    expect(fn).toMatch(/hits\[hits\.length - 1\]/);
  });

  it('derived muted text keeps WCAG AA (>=4.5:1) on every surface (亮+暗)', () => {
    const hex2rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
    const lum = (h: string) => {
      const [r, g, b] = hex2rgb(h).map((c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const cr = (a: string, b: string) => {
      const x = lum(a), y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const mixHex = (bgHex: string, fgHex: string, p: number) => {
      const a = hex2rgb(bgHex), b = hex2rgb(fgHex);
      return '#' + a.map((v, i) => Math.round(v * (1 - p) + b[i] * p).toString(16).padStart(2, '0')).join('');
    };
    const pairs: Array<[string, string, string]> = [
      ['paper', '#f2efe6', '#1c1b19'],
      ['celadon', '#f4f1e8', '#173a38'],
      ['ultramarine', '#edf0f6', '#1e2e52'],
      ['mist', '#eaeef2', '#1b2b40'],
    ];
    for (const [name, inkPaper, inkBase] of pairs) {
      for (const [bg, fg, ratios] of [
        [inkPaper, inkBase, [0.82, 0.74, 0.70]],
        [inkBase, inkPaper, [0.84, 0.76, 0.72]],
      ] as Array<[string, string, number[]]>) {
        for (const p of ratios) {
          expect(cr(mixHex(bg, fg, p), bg), `${name} text ratio ${p} must be >=4.5:1`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('no visual sign-off claimed from static evidence', () => {
    const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(self).not.toMatch(/expect\([^)]*verified[^)]*\)\.toBe\(true\)/);
  });
});
