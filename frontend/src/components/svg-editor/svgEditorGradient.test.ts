import { describe, expect, it } from 'vitest';
import {
  applyGradientOps,
  gradientInsertOps,
  gradientMarkup,
  gradientStopMarkup,
  gradientPreviewCss,
  gradientRefOf,
  linearDirectionAttrs,
  newGradientId,
  parseGradients,
  stopEditOps,
} from './svgEditorGradient';

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg"><defs>
<linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0" stop-color="#ff0000"/><stop offset="50%" stop-color="#00ff00"/><stop offset="1" stop-color="#0000ff"/></linearGradient>
<radialGradient id="g2" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></radialGradient>
<linearGradient gradientTransform="rotate(45)"><stop offset="0" stop-color="#123456"/></linearGradient>
</defs><rect id="box" fill="url(#g1)"/></svg>`;

describe('BLOCK-342 渐变编辑', () => {
  it('parseGradients：线性/径向 stops 与几何属性；无 id 跳过；offset 归一', () => {
    const defs = parseGradients(SAMPLE);
    expect(defs.map((d) => d.id)).toEqual(['g1', 'g2']);
    const g1 = defs[0];
    expect(g1.kind).toBe('linear');
    expect(g1.stops).toHaveLength(3);
    expect(g1.stops[1]).toEqual({ offset: 0.5, color: '#00ff00' });
    expect(g1.attrs.x2).toBe('100%');
    expect(defs[1].kind).toBe('radial');
  });

  it('newGradientId：跳过已用 id', () => {
    expect(newGradientId(['g1', 'g2'])).toBe('g3');
    expect(newGradientId([])).toBe('g1');
  });

  it('linearDirectionAttrs：横/竖/斜预设', () => {
    expect(linearDirectionAttrs('h').x2).toBe('100%');
    expect(linearDirectionAttrs('v').x2).toBe('0%');
    expect(linearDirectionAttrs('v').y2).toBe('100%');
    expect(linearDirectionAttrs('d')).toEqual({ x1: '0%', y1: '0%', x2: '100%', y2: '100%' });
  });

  it('gradientMarkup：空壳开闭对（单元素口径）；direction 几何正确', () => {
    expect(gradientMarkup({ id: 'g3', kind: 'linear', direction: 'd' }))
      .toBe('<linearGradient id="g3" x1="0%" y1="0%" x2="100%" y2="100%"></linearGradient>');
    expect(gradientMarkup({ id: 'g4', kind: 'radial' }))
      .toBe('<radialGradient id="g4" cx="50%" cy="50%" r="50%"></radialGradient>');
    expect(gradientStopMarkup('g3', 0, '#123456')).toBe('<stop id="g3-s0" offset="0" stop-color="#123456" />');
    // 非法颜色回落 #000000（不带引号/尖括号）
    expect(gradientStopMarkup('g3', 1, '"><script>')).toContain('stop-color="#000000"');
  });

  it('gradientInsertOps：全部单元素 op——defs 缺席先建（end 不扰动既有 path），stop 按 id 逐个插', () => {
    const def = { id: 'g9', kind: 'linear' as const, from: '#111111', to: '#222222', direction: 'h' as const };
    const withDefs = gradientInsertOps(def, [2, 0], 0);
    expect(withDefs).toHaveLength(3);
    expect(withDefs[0]).toEqual({ op: 'insert', parent: { path: [2, 0] }, index: 'end', markup: '<linearGradient id="g9" x1="0%" y1="0%" x2="100%" y2="0%"></linearGradient>' });
    expect(withDefs[1]).toEqual({ op: 'insert', parent: { id: 'g9' }, index: 'end', markup: '<stop id="g9-s0" offset="0" stop-color="#111111" />' });
    const noDefs = gradientInsertOps(def, null, 5);
    expect(noDefs[0]).toEqual({ op: 'insert', parent: { path: [] }, index: 'end', markup: '<defs></defs>' });
    expect(noDefs[1]).toEqual({ op: 'insert', parent: { path: [5] }, index: 'end', markup: withDefs[0].markup });
    expect(noDefs).toHaveLength(4);
  });

  it('applyGradientOps：目标优先 id', () => {
    expect(applyGradientOps([{ id: 'box' }], 'g1')).toEqual([
      { op: 'set_attr', target: { id: 'box' }, name: 'fill', value: 'url(#g1)' },
    ]);
  });

  it('stopEditOps：颜色与偏移（offset 钳 [0,1]）', () => {
    expect(stopEditOps({ id: 'g1-s1' }, { color: '#00ff00', offset: 1.5 })).toEqual([
      { op: 'set_attr', target: { id: 'g1-s1' }, name: 'stop-color', value: '#00ff00' },
      { op: 'set_attr', target: { id: 'g1-s1' }, name: 'offset', value: '1' },
    ]);
  });

  it('gradientRefOf：url(#id) 提取；非引用 null', () => {
    expect(gradientRefOf('url(#g1)')).toBe('g1');
    expect(gradientRefOf('#cc0000')).toBeNull();
    expect(gradientRefOf(undefined)).toBeNull();
  });

  it('gradientPreviewCss：CSS 预览串', () => {
    const defs = parseGradients(SAMPLE);
    expect(gradientPreviewCss(defs[0])).toBe('linear-gradient(90deg, #ff0000 0%, #00ff00 50%, #0000ff 100%)');
    expect(gradientPreviewCss(defs[1])).toContain('radial-gradient(circle');
  });
});
