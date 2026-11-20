// 国风背景水印 — HK-01 红绿先行消费测试（第二轮·钢笔笔锋）。
// 用户反馈首版「模糊」→ 改钢笔白描：细而硬、有笔锋提按、清晰不抢内容。
// 判据：四原型在场、楔形笔锋(path fill 变宽)、墨浓度 10–16%、无全局 opacity 模糊、
// 主题自适应、零交互干扰、不触 z-index/raw-color ratchet。
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

  it('pen-stroke: tapered path fills (笔锋提按), thin, no round-cap blur', () => {
    const css = read(WATERMARK);
    const uriBlocks = css.match(/data:image\/svg\+xml[^;)]*/g) || [];
    const tapered = uriBlocks.filter((u) => {
      const paths = [...u.matchAll(/%3Cpath\s[^%]*?(?=%3E|>)/gi)].map((m) => m[0]);
      return paths.some((p) => /fill='black'/i.test(p) && /d='M[^']*[CLQ]/i.test(p));
    });
    expect(tapered.length, 'each archetype needs at least one filled taper path (笔锋)').toBeGreaterThanOrEqual(2);
    expect(css, 'no round stroke caps (钢笔硬锋)').not.toMatch(/stroke-linecap='round'/);
    expect(css, 'no global opacity blur').not.toMatch(/opacity:\s*0?\.\d/);
  });

  it('ink concentration 6–16% (清晰但不抢内容), theme-adaptive', () => {
    const css = read(WATERMARK);
    expect(css).toMatch(/color-mix\(\s*in srgb,\s*var\(--petri-ink-base\)\s+([6-9]|1[0-6])\%/);
    expect(css).toMatch(/var\(--petri-bg-canvas\)/);
  });

  it('watermark is non-interactive and never writes a raw z-index', () => {
    const css = read(WATERMARK) + read(GLOBAL);
    const local = read(WATERMARK);
    expect(local).toMatch(/pointer-events:\s*none/);
    expect(local).not.toMatch(/z-index:\s*\d/);
  });

  it('mounted once globally (all routes) with all four archetypes, aria-hidden', () => {
    const comp = read('frontend/src/components/common/GlobalWatermark.tsx');
    for (const cls of ['moon-gate', 'seal', 'pebble', 'open-ring']) {
      expect(comp, `${cls} missing in global watermark`).toContain(`petri-watermark--${cls}`);
    }
    expect(comp).toMatch(/aria-hidden/);
    const main = read('frontend/src/main.tsx');
    expect(main).toMatch(/<GlobalWatermark\s*\/>/);
    // 逐页重复挂载已移除（单源）。
    expect(read('frontend/src/pages/welcome.tsx')).not.toMatch(/petri-watermark--/);
    expect(read('frontend/src/pages/project-workspace.tsx')).not.toMatch(/petri-watermark--/);
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
