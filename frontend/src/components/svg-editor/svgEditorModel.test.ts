/**
 * BLOCK-342 W1 — SVG 编辑器纯逻辑契约。
 *
 * 只钉机制：元素 path 与后端定位器同源、transform 合成不堆叠、快捷键映射、
 * 层序/复制 op 边界、视图脱敏（危险面剥离但结构保留）、缩放钳制与框选几何。
 */
import { describe, expect, it } from 'vitest';
import {
  boxIntersects,
  clampScale,
  composeTranslate,
  duplicateOp,
  elementLabel,
  elementPath,
  findByPath,
  formatNumber,
  keyToCommand,
  normalizeBox,
  orderOp,
  pathKey,
  sanitizeSvgForView,
  zoomAtPoint,
} from './svgEditorModel';

function svgDoc(inner: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`,
    'image/svg+xml',
  );
  return doc.documentElement as unknown as SVGSVGElement;
}

describe('BLOCK-342 W1 svgEditorModel', () => {
  it('composeTranslate：纯 translate 累加，混合形态追加，空值新建', () => {
    expect(composeTranslate(null, 5, 7)).toBe('translate(5 7)');
    expect(composeTranslate('', 5, 7)).toBe('translate(5 7)');
    expect(composeTranslate('translate(10 20)', 5, -3)).toBe('translate(15 17)');
    expect(composeTranslate('translate(10)', 5, 2)).toBe('translate(15 2)');
    expect(composeTranslate('rotate(45)', 5, 0)).toBe('rotate(45) translate(5 0)');
    // 小数保留两位、去尾零
    expect(formatNumber(1.23456)).toBe('1.23');
    expect(formatNumber(2)).toBe('2');
  });

  it('elementPath / findByPath：子元素序号 path 与后端 {path} 同源', () => {
    const root = svgDoc('<g id="g1"><rect id="r"/><text id="t">x</text></g><circle id="c"/>');
    const g = root.children[0];
    const t = g.children[1];
    expect(elementPath(root, t)).toEqual([0, 1]);
    expect(pathKey([0, 1])).toBe('0.1');
    expect(findByPath(root, [0, 1])).toBe(t);
    expect(findByPath(root, [9])).toBeNull();
    expect(elementPath(root, root)).toEqual([]);
    expect(elementLabel(t)).toBe('#t');
    expect(elementPath(root, null)).toBeNull();
  });

  it('keyToCommand：保存/撤销/重做/删除/复制/微移/命令面板，输入框内不触发', () => {
    expect(keyToCommand({ key: 's', metaKey: true })).toEqual({ type: 'save' });
    expect(keyToCommand({ key: 'z', ctrlKey: true })).toEqual({ type: 'undo' });
    expect(keyToCommand({ key: 'z', metaKey: true, shiftKey: true })).toEqual({ type: 'redo' });
    expect(keyToCommand({ key: 'y', metaKey: true })).toEqual({ type: 'redo' });
    expect(keyToCommand({ key: 'Delete' })).toEqual({ type: 'delete' });
    expect(keyToCommand({ key: 'd', metaKey: true })).toEqual({ type: 'duplicate' });
    expect(keyToCommand({ key: 'k', metaKey: true })).toEqual({ type: 'palette' });
    expect(keyToCommand({ key: 'Escape' })).toEqual({ type: 'escape' });
    expect(keyToCommand({ key: 'ArrowLeft' })).toEqual({ type: 'nudge', dx: -1, dy: 0 });
    expect(keyToCommand({ key: 'ArrowDown', shiftKey: true })).toEqual({ type: 'nudge', dx: 0, dy: 10 });
    expect(keyToCommand({ key: 'ArrowUp' })).toEqual({ type: 'nudge', dx: 0, dy: -1 });
    expect(keyToCommand({ key: 'x' })).toBeNull();

    const input = document.createElement('input');
    expect(keyToCommand({ key: 'Delete', target: input })).toBeNull();
  });

  it('orderOp / duplicateOp：根元素与首层边界拒绝', () => {
    expect(orderOp([], 'up')).toBeNull();
    expect(orderOp([0], 'up')).toBeNull();
    expect(orderOp([0, 1], 'up')).toEqual({ op: 'move', target: { path: [0, 1] }, parent: { path: [0] }, index: 0 });
    expect(orderOp([0, 1], 'down')).toEqual({ op: 'move', target: { path: [0, 1] }, parent: { path: [0] }, index: 2 });
    expect(duplicateOp([], '<g/>')).toBeNull();
    expect(duplicateOp([1, 2], '<rect/>')).toEqual({ op: 'insert', parent: { path: [1] }, index: 3, markup: '<rect/>' });
  });

  it('sanitizeSvgForView：剥 script/foreignObject/on 事件/javascript:，结构保留', () => {
    const dirty = '<svg xmlns="http://www.w3.org/2000/svg" onload="x()">'
      + '<script>alert(1)</script>'
      + '<foreignObject><b>h</b></foreignObject>'
      + '<a href="javascript:alert(2)"><text id="t">ok</text></a>'
      + '<rect id="r" fill="#123456" onclick="y()"/>'
      + '</svg>';
    const result = sanitizeSvgForView(dirty);
    expect(result.ok).toBe(true);
    const markup = result.markup || '';
    expect(markup.toLowerCase()).not.toContain('<script');
    expect(markup.toLowerCase()).not.toContain('foreignobject');
    expect(markup.toLowerCase()).not.toContain('onload');
    expect(markup.toLowerCase()).not.toContain('onclick');
    expect(markup.toLowerCase()).not.toContain('javascript:');
    expect(markup).toContain('id="r"');
    expect(markup).toContain('#123456');
    expect(result.removed).toBeGreaterThanOrEqual(4);
  });

  it('sanitizeSvgForView：非 svg 文档如实报错（不猜修复）', () => {
    const result = sanitizeSvgForView('<html><body>x</body></html>');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('svg_parse_error');
  });

  it('缩放与框选几何', () => {
    expect(clampScale(0.01)).toBe(0.1);
    expect(clampScale(99)).toBe(8);
    expect(clampScale(Number.NaN)).toBe(1);
    expect(zoomAtPoint(1, -1)).toBeCloseTo(1.1);
    expect(zoomAtPoint(1, 1)).toBeCloseTo(0.9);

    const a = normalizeBox({ x: 30, y: 40 }, { x: 10, y: 10 });
    expect(a).toEqual({ x: 10, y: 10, width: 20, height: 30 });
    expect(boxIntersects(a, { x: 25, y: 20, width: 10, height: 10 })).toBe(true);
    expect(boxIntersects(a, { x: 100, y: 100, width: 5, height: 5 })).toBe(false);
  });
});
