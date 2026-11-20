import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(srcRoot, 'styles/watermark.css'), 'utf8');
const tsx = fs.readFileSync(path.join(srcRoot, 'components/common/GlobalWatermark.tsx'), 'utf8');

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\S\r\n])\/\/.*$/gm, '$1');
}

describe('国风水印 · 极简几何单线契约', () => {
  const body = stripComments(css);
  const component = stripComments(tsx);
  const prototypes = ['moon-gate', 'seal', 'pebble', 'open-ring'];

  it('四原型均为独立几何节点挂载（非位图铺满）', () => {
    for (const name of prototypes) {
      expect(component, `组件缺少 ${name} 节点`).toContain(`petri-watermark--${name}`);
      expect(body, `样式缺少 ${name} 规则`).toContain(`.petri-watermark--${name}`);
    }
  });

  it('零位图、零 cover 拉伸、零反相/滤镜', () => {
    expect(body).not.toMatch(/background-image\s*:\s*url\(/);
    expect(body).not.toMatch(/background-size\s*:\s*cover/);
    expect(body).not.toMatch(/\bfilter\s*:/);
    expect(body).not.toMatch(/invert\(|sepia\(/);
    expect(body).not.toMatch(/\.png\b/);
  });

  it('颜色由 petri ink token 派生（亮暗与四档和声自适应）', () => {
    expect(body).toMatch(/color-mix\([^)]*var\(--petri-ink-base\)/);
    expect(body).toMatch(/var\(--petri-bg-canvas\)/);
  });

  it('几何线为均匀 stroke（不追笔锋、无楔形 fill）', () => {
    const masks = [...body.matchAll(/^[ \t]*mask-image\s*:\s*url\("data:image\/svg\+xml,([^"]+)"\)/gm)].map(
      (match) => match[1],
    );
    expect(masks.length, '应有四条独立 SVG mask').toBe(4);
    for (const raw of masks) {
      const svg = decodeURIComponent(raw);
      expect(svg, 'mask 路径必须含 path').toMatch(/<path\b/);
      expect(svg, 'mask 必须用 stroke 画单线').toMatch(/stroke=/);
      expect(svg, 'mask 不得用实心 fill 画楔形笔锋').not.toMatch(/fill=['"]black['"]/);
    }
  });

  it('零交互干扰：pointer-events:none + aria-hidden', () => {
    expect(body).toMatch(/pointer-events:\s*none/);
    expect(component).toMatch(/aria-hidden="true"/);
  });
});
