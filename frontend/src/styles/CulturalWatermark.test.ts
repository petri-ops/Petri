// 国风简约背景水印 — HK-01 红绿先行消费测试。
// 用户诉求：月洞门弧/卵石柔/落印方/开环缺做成若有若无的页面底纹（计白当黑）。
// 判据：四原型纹样在场、极淡(≤4%)、主题自适应、零交互干扰、不触 z-index/raw-color ratchet。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const WATERMARK = 'frontend/src/styles/watermark.css';
const GLOBAL = 'frontend/src/styles/global.css';

describe('国风背景水印（计白当黑）', () => {
  it('watermark stylesheet exists with four archetype patterns', () => {
    expect(fs.existsSync(path.join(ROOT, WATERMARK)), 'watermark.css missing').toBe(true);
    const css = read(WATERMARK);
    for (const [name, re] of [
      ['月洞门', /moon-gate/],
      ['卵石', /pebble/],
      ['落印', /seal/],
      ['开环', /open-ring/],
    ] as Array<[string, RegExp]>) {
      expect(css, `${name} pattern missing`).toMatch(re);
    }
  });

  it('patterns are mask-image data-URI SVG (no hardcoded color in URI)', () => {
    const css = read(WATERMARK);
    expect(css).toMatch(/mask-image:\s*url\(["']?data:image\/svg\+xml/);
    const uriBlocks = css.match(/data:image\/svg\+xml[^;)]*/g) || [];
    expect(uriBlocks.length).toBeGreaterThanOrEqual(4);
    for (const uri of uriBlocks) {
      expect(uri, 'no hex color inside SVG URI').not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(uri, 'no rgb() inside SVG URI').not.toMatch(/rgba?\(/);
    }
  });

  it('tint derives from ink tokens at ≤4% (计白当黑, theme-adaptive)', () => {
    const css = read(WATERMARK);
    expect(css).toMatch(/color-mix\(\s*in srgb,\s*var\(--petri-ink-base\)\s+(\d|1\d|2\d|3\d|40)\%/);
    expect(css).toMatch(/var\(--petri-bg-canvas\)/);
  });

  it('watermark is non-interactive and never writes a raw z-index', () => {
    const css = read(WATERMARK) + read(GLOBAL);
    const local = read(WATERMARK);
    expect(local).toMatch(/pointer-events:\s*none/);
    expect(local).not.toMatch(/z-index:\s*\d/);
  });

  it('bound to root containers via aria-hidden watermark element (zero interaction)', () => {
    const welcome = read('frontend/src/pages/welcome.tsx');
    const workspace = read('frontend/src/pages/project-workspace.tsx');
    expect(welcome).toMatch(/petri-watermark--moon-gate/);
    expect(welcome).toMatch(/aria-hidden/);
    expect(workspace).toMatch(/petri-watermark--pebble|petri-watermark--open-ring/);
    expect(workspace).toMatch(/aria-hidden/);
  });

  it('no new dependency / no static-to-visual sign-off', () => {
    const pkg = JSON.parse(read('frontend/package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps: Record<string, string | undefined> = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const d of ['lucide-react', '@phosphor-icons/react', 'react-icons', 'heroicons']) {
      expect(deps[d], `unexpected dependency ${d}`).toBeUndefined();
    }
    const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(self).not.toMatch(/expect\([^)]*verified[^)]*\)\.toBe\(true\)/);
  });
});
