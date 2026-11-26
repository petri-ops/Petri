/**
 * P3 艺术创作包收官（主仓）HK-01：SVG 编辑器三项真实缺口。
 * 只钉机制：参数化圆角矩形、图层可见性 op、导出文件名派生；不重复既有 UI-672~693 能力。
 */
import { describe, expect, it } from 'vitest';
import { DRAW_TOOLS, drawOp, layerVisibilityOps } from './svgEditorInspector';
import { exportFileName } from './svgEditorModel';

const markupOf = (op: unknown): string => {
  const value = (op as { markup?: unknown } | null)?.markup;
  return typeof value === 'string' ? value : '';
};

function doc(inner: string): Element {
  return new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240">${inner}</svg>`,
    'image/svg+xml',
  ).documentElement;
}

describe('P3 参数化圆角矩形', () => {
  it('roundrect 工具在册，drawOp 带 rx 参数化 markup', () => {
    expect(DRAW_TOOLS.some((t) => t.id === 'roundrect')).toBe(true);
    const op = drawOp('roundrect', { x: 10, y: 20, width: 100, height: 60 }, { rx: 12, color: '#abcdef' });
    const markup = markupOf(op);
    expect(markup).toMatch(/^<rect /);
    expect(markup).toContain('x="10"');
    expect(markup).toContain('y="20"');
    expect(markup).toContain('width="100"');
    expect(markup).toContain('height="60"');
    expect(markup).toContain('rx="12"');
    expect(markup).toContain('fill="#abcdef"');
  });

  it('rx 钳制到短边一半，过小框不出元素', () => {
    const clamped = markupOf(drawOp('roundrect', { x: 0, y: 0, width: 20, height: 10 }, { rx: 99 }));
    expect(clamped).toContain('rx="5"');
    expect(drawOp('roundrect', { x: 0, y: 0, width: 1, height: 1 }, {})).toBeNull();
  });
});

describe('P3 图层可见性', () => {
  it('隐藏/显示走 set_style display，已符合态零 op（id 定位）', () => {
    const root = doc('<g id="layer1"><rect fill="red" /></g>');
    const layer = root.querySelector('#layer1')!;
    expect(layerVisibilityOps(root, layer, false)).toEqual([
      { op: 'set_style', target: { id: 'layer1' }, props: { display: 'none' } },
    ]);
    const hidden = doc('<g id="layer1" style="display:none"><rect /></g>');
    const hiddenLayer = hidden.querySelector('#layer1')!;
    expect(layerVisibilityOps(hidden, hiddenLayer, false)).toEqual([]);
    expect(layerVisibilityOps(hidden, hiddenLayer, true)).toEqual([
      { op: 'set_style', target: { id: 'layer1' }, props: { display: null } },
    ]);
  });

  it('无 id 走 path 定位；display 表现属性隐藏态显示时补 remove_attr', () => {
    const root = doc('<g><rect /></g>');
    const layer = root.firstElementChild!;
    expect(layerVisibilityOps(root, layer, false)).toEqual([
      { op: 'set_style', target: { path: [0] }, props: { display: 'none' } },
    ]);
    const attrHidden = doc('<g display="none"><rect /></g>');
    const attrLayer = attrHidden.firstElementChild!;
    expect(layerVisibilityOps(attrHidden, attrLayer, true)).toEqual([
      { op: 'remove_attr', target: { path: [0] }, name: 'display' },
    ]);
  });
});

describe('P3 导出文件名', () => {
  it('去目录/去旧扩展/非法字符替换，空名回落', () => {
    expect(exportFileName('figures/logo.svg', 'png')).toBe('logo.png');
    expect(exportFileName('a/b/my.logo.svg', 'svg')).toBe('my.logo.svg');
    expect(exportFileName('dir/bad:name?.svg', 'png')).toBe('bad_name_.png');
    expect(exportFileName('', 'png')).toBe('svg-export.png');
  });
});
