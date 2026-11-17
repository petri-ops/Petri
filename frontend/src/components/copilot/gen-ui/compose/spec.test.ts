import { describe, expect, it } from 'vitest';
import { parseComposeSpec } from './spec';

// BLOCK-461 P0 — ComposeSpec 手写校验器契约（HK-01 红绿先行）。
// fail-closed：未知 kind / 悬空引用 / 环 / 深度超限 / props 越界 / $state 格式非法一律拒绝整份 spec。

function baseSpec(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    root: 'card1',
    nodes: {
      card1: { kind: 'card', title: 'Job 概览' },
    },
    ...overrides,
  };
}

describe('parseComposeSpec（fail-closed 校验器）', () => {
  it('合法最小 spec（单 Card）通过', () => {
    const spec = parseComposeSpec(baseSpec());
    expect(spec).not.toBeNull();
    expect(spec?.root).toBe('card1');
  });

  it('合法树（card → metric/table/chart 混排）通过', () => {
    const spec = parseComposeSpec({
      version: 1,
      root: 'card1',
      nodes: {
        card1: { kind: 'card', title: '概览' },
        m1: { kind: 'metric', parent: 'card1', title: '行数', value: '42', unit: '行' },
        t1: { kind: 'table', parent: 'card1', title: '明细', columns: ['a', 'b'], rows: [['1', '2']] },
        c1: { kind: 'chart', parent: 'card1', title: '趋势', chartType: 'bar', labels: ['x', 'y'], series: [{ name: 's', values: [1, 2] }] },
      },
    });
    expect(spec).not.toBeNull();
    expect(Object.keys(spec?.nodes ?? {}).length).toBe(4);
  });

  it('version 非 1 / root 缺失 / nodes 空 → 拒绝', () => {
    expect(parseComposeSpec({ ...baseSpec(), version: 2 })).toBeNull();
    expect(parseComposeSpec({ version: 1, nodes: baseSpec().nodes })).toBeNull();
    expect(parseComposeSpec(baseSpec({ nodes: {} }))).toBeNull();
    expect(parseComposeSpec(null)).toBeNull();
    expect(parseComposeSpec('nope')).toBeNull();
  });

  it('未知 kind / 悬空 parent 引用 → 拒绝', () => {
    expect(parseComposeSpec(baseSpec({ nodes: { card1: { kind: 'iframe' } } }))).toBeNull();
    expect(parseComposeSpec(baseSpec({ nodes: { card1: { kind: 'card', parent: 'ghost' } } }))).toBeNull();
  });

  it('环（a.parent=b, b.parent=a）→ 拒绝', () => {
    expect(parseComposeSpec(baseSpec({
      root: 'a',
      nodes: {
        a: { kind: 'card', parent: 'b' },
        b: { kind: 'card', parent: 'a' },
      },
    }))).toBeNull();
  });

  it('root 不在 nodes 中 → 拒绝', () => {
    expect(parseComposeSpec(baseSpec({ root: 'ghost' }))).toBeNull();
  });

  it('节点数超限（>32）→ 拒绝', () => {
    const nodes: Record<string, { kind: string; parent?: string }> = {};
    for (let i = 0; i < 33; i += 1) nodes[`n${i}`] = { kind: 'card', parent: i === 0 ? undefined : 'n0' };
    nodes.n0 = { kind: 'card' };
    expect(parseComposeSpec(baseSpec({ root: 'n0', nodes }))).toBeNull();
  });

  it('深度超限（>8 层链）→ 拒绝', () => {
    const nodes: Record<string, { kind: string; parent?: string }> = { root0: { kind: 'card' } };
    for (let i = 1; i <= 9; i += 1) nodes[`d${i}`] = { kind: 'card', parent: i === 1 ? 'root0' : `d${i - 1}` };
    expect(parseComposeSpec(baseSpec({ root: 'root0', nodes }))).toBeNull();
  });

  it('props 越界：metric 缺 value / table 缺 columns / chart 缺 series / 未知字段 → 拒绝', () => {
    expect(parseComposeSpec(baseSpec({ nodes: { card1: { kind: 'metric' } } }))).toBeNull();
    expect(parseComposeSpec(baseSpec({ nodes: { card1: { kind: 'table', rows: [] } } }))).toBeNull();
    expect(parseComposeSpec(baseSpec({ nodes: { card1: { kind: 'chart', chartType: 'bar' } } }))).toBeNull();
    expect(parseComposeSpec(baseSpec({ nodes: { card1: { kind: 'card', evil: 'x' } } }))).toBeNull();
  });

  it('$state 引用格式非法（越界路径/前缀错）→ 拒绝', () => {
    expect(parseComposeSpec(baseSpec({ nodes: { card1: { kind: 'metric', title: 'x', value: '$state..bad' } } }))).toBeNull();
    expect(parseComposeSpec(baseSpec({ nodes: { card1: { kind: 'metric', title: 'x', value: '$env.secret' } } }))).toBeNull();
    expect(parseComposeSpec(baseSpec({ nodes: { card1: { kind: 'metric', title: 'x', value: '$state.__proto__.x' } } }))).toBeNull();
  });

  it('合法 $state 引用通过（P2 数据面）', () => {
    expect(parseComposeSpec(baseSpec({ nodes: { card1: { kind: 'metric', title: '行数', value: '$state.rows.count' } } }))).not.toBeNull();
  });

  it('visible 条件合法 $state 引用通过（P2）', () => {
    expect(parseComposeSpec(baseSpec({ nodes: { card1: { kind: 'metric', title: 'x', value: '1', visible: '$state.ready' } } }))).not.toBeNull();
    expect(parseComposeSpec(baseSpec({ nodes: { card1: { kind: 'metric', title: 'x', value: '1', visible: 'ready' } } }))).toBeNull();
  });
});
