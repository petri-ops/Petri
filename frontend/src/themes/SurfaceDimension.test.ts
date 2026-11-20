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

  it('no visual sign-off claimed from static evidence', () => {
    const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(self).not.toMatch(/expect\([^)]*verified[^)]*\)\.toBe\(true\)/);
  });
});
