// 国风背景水印 — HK-01 红绿先行消费测试（第三轮·AI 专业出图）。
// 用户诉求：手绘 SVG 没质感→用专业工具设计图案原封不动落地。
// 判据：AI 图案资源在场、全局单 div、抠底 alpha、淡度有界、主题自适应、零交互干扰。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CSS = 'frontend/src/styles/watermark-ai.css';
const COMPONENT = 'frontend/src/components/common/GlobalWatermarkAI.tsx';

describe('国风水印（AI 专业出图·原封不动）', () => {
  it('AI-generated pattern asset exists and is a real PNG', () => {
    const p = path.join(ROOT, 'frontend/src/assets/cultural-watermark.png');
    expect(fs.existsSync(p), 'AI watermark asset missing').toBe(true);
    const buf = fs.readFileSync(p);
    expect(buf.length, 'asset too small').toBeGreaterThan(10000);
    expect(buf.subarray(1, 4).toString(), 'must be PNG').toBe('PNG');
  });

  it('source image (原图) preserved as provenance evidence', () => {
    const dir = path.join(ROOT, 'acceptance/cultural-watermark/design-concepts');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
    expect(files.length, 'original AI image must be kept verbatim').toBeGreaterThanOrEqual(1);
  });

  it('global single-source component (no hand-drawn archetype divs left)', () => {
    const comp = read(COMPONENT);
    expect(comp).toMatch(/petri-watermark-global/);
    expect(comp).toMatch(/aria-hidden/);
    expect(comp).not.toMatch(/moon-gate|pebble|open-ring|seal/);
    const main = read('frontend/src/main.tsx');
    expect(main).toMatch(/<GlobalWatermarkAI\s*\/>/);
  });

  it('CSS uses the image verbatim, bounded opacity, theme-adaptive', () => {
    const css = read(CSS);
    expect(css).toMatch(/background-image:\s*url\(['"]?\.\.\/assets\/cultural-watermark\.png/);
    expect(css).toMatch(/pointer-events:\s*none/);
    const opacities = [...css.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    expect(opacities.length).toBeGreaterThan(0);
    expect(Math.max(...opacities), '水印不得抢内容：opacity ≤ 0.2').toBeLessThanOrEqual(0.2);
    expect(css).toMatch(/\[data-theme='dark'\]/);
  });

  it('non-interactive, no raw z-index, no new dependency', () => {
    const css = read(CSS);
    expect(css).not.toMatch(/z-index:\s*\d/);
    const pkg = JSON.parse(read('frontend/package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps: Record<string, string | undefined> = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const d of ['lucide-react', '@phosphor-icons/react', 'react-icons', 'heroicons']) {
      expect(deps[d], `unexpected dependency ${d}`).toBeUndefined();
    }
  });

  it('no static-to-visual sign-off claim', () => {
    const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(self).not.toMatch(/expect\([^)]*verified[^)]*\)\.toBe\(true\)/);
  });
});
