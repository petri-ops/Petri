import { describe, expect, it } from 'vitest';
import { groupLabel, splitOpGroups, targetLabel } from './svgChangeList';

describe('UI-663 改动清单（pendingOps 分组）', () => {
  it('targetLabel：优先 #id，否则 path 形态，异常兜底', () => {
    expect(targetLabel({ id: 'box' })).toBe('#box');
    expect(targetLabel({ path: [1, 0] })).toBe('path[1,0]');
    expect(targetLabel({})).toBe('(根)');
    expect(targetLabel(undefined)).toBe('(?)');
  });

  it('groupLabel：各 op 族单条直出', () => {
    expect(groupLabel([{ op: 'set_attr', target: { id: 'box' }, name: 'fill', value: '#cc0000' }]))
      .toBe('set fill=#cc0000（#box）');
    expect(groupLabel([{ op: 'remove', target: { path: [0] } }])).toBe('删除 path[0]');
    expect(groupLabel([{ op: 'insert', tag: 'rect' }])).toBe('插入 <rect>');
    expect(groupLabel([{ op: 'set_text', target: { id: 'caption' }, text: 'hi' }])).toBe('改文字（#caption）');
    expect(groupLabel([])).toBe('');
  });

  it('groupLabel：多 op「首条 等 N 项」', () => {
    const ops = [
      { op: 'set_attr', target: { id: 'a' }, name: 'fill', value: '#111111' },
      { op: 'set_attr', target: { id: 'b' }, name: 'fill', value: '#222222' },
      { op: 'set_attr', target: { id: 'c' }, name: 'fill', value: '#333333' },
    ];
    expect(groupLabel(ops)).toBe('set fill=#111111（#a） 等 3 项');
  });

  it('splitOpGroups：按 opsLen 快照切组，切片正确', () => {
    const ops = [
      { op: 'set_attr', target: { id: 'a' }, name: 'fill', value: '#111111' },
      { op: 'set_attr', target: { id: 'b' }, name: 'stroke', value: '#00aa55' },
      { op: 'set_attr', target: { id: 'b' }, name: 'stroke-width', value: '3' },
      { op: 'remove', target: { id: 'c' } },
    ];
    const groups = splitOpGroups(ops, [1, 3, 4]);
    expect(groups.map((g) => g.index)).toEqual([0, 1, 2]);
    expect(groups[0].ops).toHaveLength(1);
    expect(groups[1].ops).toHaveLength(2);
    expect(groups[2].ops).toHaveLength(1);
    expect(groups[1].label).toBe('set stroke=#00aa55（#b） 等 2 项');
  });

  it('splitOpGroups：空输入出空清单（零改动不猜）', () => {
    expect(splitOpGroups([], [])).toEqual([]);
  });

  it('splitOpGroups：尾部余量兜底成组（快照滞后不静默丢弃）', () => {
    const ops = [{ op: 'set_attr', target: { id: 'a' }, name: 'fill', value: '#111111' }];
    const groups = splitOpGroups(ops, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].ops).toEqual(ops);
  });
});
