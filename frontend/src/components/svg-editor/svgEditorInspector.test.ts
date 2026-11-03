/**
 * BLOCK-342 W2/W3/W4 契约 — 属性/色板/样式/文字段/绘制/会话引用。
 *
 * 只钉机制：白名单属性只出 set_attr·remove_attr；色板只收实色；样式复制粘贴逐属性；
 * 多行 tspan 拆段不丢行；绘制过小框不出元素；会话引用含文件路径 + path + 属性。
 */
import { describe, expect, it } from 'vitest';
import {
  EDITABLE_ATTRS,
  attrOp,
  batchAttrOps,
  drawOp,
  extractPalette,
  pasteStyleOps,
  readAttrs,
  selectionContextPrompt,
  snapshotStyle,
  textSegmentsOf,
} from './svgEditorInspector';

const markupOf = (op: unknown): string => {
  const value = (op as { markup?: unknown } | null)?.markup;
  return typeof value === 'string' ? value : '';
};

function root(inner: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240">${inner}</svg>`,
    'image/svg+xml',
  );
  return doc.documentElement as unknown as SVGSVGElement;
}

describe('BLOCK-342 W2/W3/W4 svgEditorInspector', () => {
  it('白名单属性：全是 svg 表现属性，不含任意属性注入面', () => {
    const names = EDITABLE_ATTRS.map((a) => a.name).sort();
    expect(names).toEqual(['fill', 'font-family', 'font-size', 'font-weight', 'opacity', 'stroke', 'stroke-width', 'text-anchor']);
    expect(names).not.toContain('onclick');
    expect(names).not.toContain('href');
  });

  it('readAttrs 只读已有非空属性', () => {
    const r = root('<rect id="b" fill="#123456" stroke="" opacity="0.5" />');
    const el = r.querySelector('#b');
    expect(readAttrs(el)).toEqual({ fill: '#123456', opacity: '0.5' });
    expect(readAttrs(null)).toEqual({});
  });

  it('extractPalette：按出现次数降序、去重、排除 none/currentColor/渐变引用', () => {
    const r = root('<g fill="#cc0000"><rect fill="#cc0000" /><rect stroke="#003366" /><rect fill="none" /><rect fill="url(#g)" /><rect fill="currentColor" /><rect fill="BLUE" /></g>');
    const palette = extractPalette(r);
    // 显式属性计数（继承不展开）：<g fill> + 一个 <rect fill> = 2
    expect(palette[0]).toEqual({ color: '#cc0000', count: 2 });
    expect(palette.some((p) => p.color === '#003366')).toBe(true);
    expect(palette.some((p) => p.color === 'none')).toBe(false);
    expect(palette.some((p) => p.color.startsWith('url('))).toBe(false);
    expect(palette.some((p) => p.color === 'currentcolor')).toBe(false);
    expect(extractPalette(null)).toEqual([]);
  });

  it('attrOp：空值 = remove_attr；无定位器返回 null；值 trim', () => {
    expect(attrOp({ id: 'b', path: null }, 'fill', '#fff')).toEqual({ op: 'set_attr', target: { id: 'b' }, name: 'fill', value: '#fff' });
    expect(attrOp({ path: [0, 1] }, 'fill', '  ')).toEqual({ op: 'remove_attr', target: { path: [0, 1] }, name: 'fill' });
    expect(attrOp({ id: 'b', path: null }, 'fill', ' #abc ')).toMatchObject({ value: '#abc' });
    expect(attrOp({ path: null }, 'fill', '#fff')).toBeNull();
  });

  it('batchAttrOps：多选批量套样式（逐目标一条 op）', () => {
    const ops = batchAttrOps([{ id: 'a', path: null }, { path: [1] }, { path: null }], 'fill', '#000');
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({ op: 'set_attr', target: { id: 'a' }, name: 'fill', value: '#000' });
  });

  it('snapshotStyle / pasteStyleOps：复制样式并按目标逐属性粘贴', () => {
    const r = root('<rect id="a" fill="#111111" stroke="#222222" stroke-width="3" />');
    const snap = snapshotStyle(r.querySelector('#a'));
    expect(snap?.attrs).toEqual({ fill: '#111111', stroke: '#222222', 'stroke-width': '3' });
    const ops = pasteStyleOps([{ id: 'b', path: null }], snap!);
    expect(ops).toHaveLength(3);
    expect(ops.map((op) => ('name' in op ? op.name : ''))).toEqual(['fill', 'stroke', 'stroke-width']);
    expect(snapshotStyle(null)).toBeNull();
  });

  it('textSegmentsOf：单段 text 一条；多 tspan 逐行拆段且 path 可定位', () => {
    const r = root('<g><text id="t1">单行</text><text id="t2"><tspan x="10" y="20">第一行</tspan><tspan x="10" y="40">第二行</tspan></text></g>');
    const single = textSegmentsOf(r, r.querySelector('#t1'));
    expect(single).toHaveLength(1);
    expect(single[0].text).toBe('单行');
    expect(single[0].path).toEqual([0, 0]);

    const multi = textSegmentsOf(r, r.querySelector('#t2'));
    expect(multi).toHaveLength(2);
    expect(multi.map((s) => s.text)).toEqual(['第一行', '第二行']);
    expect(multi[0].path).toEqual([0, 1, 0]);
    expect(multi[1].path).toEqual([0, 1, 1]);

    expect(textSegmentsOf(r, r.querySelector('g'))).toEqual([]);
  });

  it('drawOp：四类形状 → insert 白名单 markup；过小框不出元素', () => {
    const box = { x: 10, y: 20, width: 100, height: 60 };
    const rect = drawOp('rect', box);
    expect(rect).toMatchObject({ op: 'insert', parent: { path: [] }, index: 'end' });
    expect(markupOf(rect)).toContain('<rect x="10" y="20" width="100" height="60"');

    const ellipse = drawOp('ellipse', box);
    expect(markupOf(ellipse)).toContain('rx="50"');
    expect(markupOf(ellipse)).toContain('cy="50"');

    const line = drawOp('line', box);
    expect(markupOf(line)).toContain('<line x1="10" y1="20" x2="110" y2="80"');

    const text = drawOp('text', box, { text: 'a<b' });
    expect(markupOf(text)).toContain('a&lt;b');

    expect(drawOp('rect', { x: 0, y: 0, width: 1, height: 1 })).toBeNull();
    expect(drawOp('line', { x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  });

  it('selectionContextPrompt：含文件路径、path、标签与属性，且指路 svg_edit', () => {
    const prompt = selectionContextPrompt({
      filePath: 'figures/plot.svg',
      elements: [{ label: '#box', path: [0, 0], tag: 'rect', attrs: { fill: '#4a7cba' } }],
    });
    expect(prompt).toContain('figures/plot.svg');
    expect(prompt).toContain('#box <rect> path=[0,0]');
    expect(prompt).toContain('fill="#4a7cba"');
    expect(prompt).toContain('svg_edit');
  });
});
