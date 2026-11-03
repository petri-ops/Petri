/**
 * BLOCK-342 W4 契约 — 改动清单与逐元素取舍。
 *
 * 只钉机制：属性/文本/增删四类差异可识别；逐元素拒绝只产出白名单 op；
 * 被删元素的恢复如实拒绝（不伪造片段）；全部拒绝跳过项计数。
 */
import { describe, expect, it } from 'vitest';
import { diffElements, revertAllOps, revertElementOps, summarizeChanges } from './svgProposal';

const BEFORE = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240">
  <rect id="box" x="40" y="40" width="120" height="80" fill="#4a7cba" />
  <text id="cap">draft</text>
  <circle id="dot" cx="10" cy="10" r="4" />
</svg>`;

const AFTER = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240">
  <rect id="box" x="40" y="40" width="120" height="80" fill="#cc0000" transform="translate(48 24)" />
  <text id="cap">final</text>
  <line id="axis" x1="0" y1="0" x2="10" y2="10" />
</svg>`;

describe('BLOCK-342 W4 svgProposal', () => {
  it('diffElements：属性/文字/新增/删除四类齐全', () => {
    const changes = diffElements(BEFORE, AFTER);
    const kinds = changes.map((c) => c.kind).sort();
    expect(kinds).toEqual(['added', 'attr', 'removed', 'text']);

    const box = changes.find((c) => c.key === 'id:box');
    expect(box?.kind).toBe('attr');
    expect(box?.attrs).toEqual([
      { name: 'fill', before: '#4a7cba', after: '#cc0000' },
      { name: 'transform', before: null, after: 'translate(48 24)' },
    ]);

    const cap = changes.find((c) => c.key === 'id:cap');
    expect(cap?.kind).toBe('text');
    expect(cap?.textBefore).toBe('draft');
    expect(cap?.textAfter).toBe('final');

    expect(changes.find((c) => c.key === 'id:axis')?.kind).toBe('added');
    expect(changes.find((c) => c.key === 'id:dot')?.kind).toBe('removed');
  });

  it('无差异 → 空清单（零改动零清单）', () => {
    expect(diffElements(BEFORE, BEFORE)).toEqual([]);
  });

  it('revertElementOps：属性恢复用 before 值，新增属性用 remove_attr', () => {
    const changes = diffElements(BEFORE, AFTER);
    const box = changes.find((c) => c.key === 'id:box')!;
    const { ops } = revertElementOps(box);
    expect(ops).toEqual([
      { op: 'set_attr', target: { id: 'box' }, name: 'fill', value: '#4a7cba' },
      { op: 'remove_attr', target: { id: 'box' }, name: 'transform' },
    ]);
  });

  it('revertElementOps：新增元素 → remove op；删除元素 → 如实拒绝', () => {
    const changes = diffElements(BEFORE, AFTER);
    const added = changes.find((c) => c.kind === 'added')!;
    expect(revertElementOps(added).ops).toEqual([{ op: 'remove', target: { id: 'axis' } }]);

    const removed = changes.find((c) => c.kind === 'removed')!;
    const result = revertElementOps(removed);
    expect(result.ops).toEqual([]);
    expect(result.reason).toContain('暂不支持');
  });

  it('revertAllOps：汇总并可跳过不可逆项；摘要按 kind 计数', () => {
    const changes = diffElements(BEFORE, AFTER);
    const { ops, skipped } = revertAllOps(changes);
    expect(skipped).toBe(1);
    expect(ops.length).toBeGreaterThanOrEqual(3);
    expect(summarizeChanges(changes)).toBe('1 个属性改动 · 1 处文字改动 · 1 个新增 · 1 个删除');
    expect(summarizeChanges([])).toBe('无改动');
  });

  it('解析失败 → 空清单（不猜）', () => {
    expect(diffElements('<html>', AFTER)).toEqual([]);
  });
});
