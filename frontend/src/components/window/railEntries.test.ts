// BLOCK-59 P2 — 边缘活动轨道纯逻辑（plan §5 克制版规格）。
import { describe, expect, it } from 'vitest';
import {
  RAIL_MAX_TICKS,
  collapseRailEntries,
  isFadedRailEntry,
  railEntryTitle,
  type RailEntry,
} from './railEntries';

function makeEntry(overrides: Partial<RailEntry>): RailEntry {
  return {
    id: 'result:job1:a.png',
    type: 'result',
    key: 'job1:a.png',
    state: 'railed',
    railClass: 'static',
    fadeAfter: null,
    createdAt: 1,
    poppedAt: 2,
    railedAt: 3,
    ...overrides,
  };
}

describe('isFadedRailEntry（静态 5min 淡出）', () => {
  it('static 类 fadeAfter 已过 → 淡出', () => {
    expect(
      isFadedRailEntry({ railClass: 'static', fadeAfter: 1000 }, 1001),
    ).toBe(true);
  });

  it('static 类未到时间 → 不淡出', () => {
    expect(
      isFadedRailEntry({ railClass: 'static', fadeAfter: 1000 }, 999),
    ).toBe(false);
  });

  it('persistent（终端/agent）永不淡出', () => {
    expect(
      isFadedRailEntry({ railClass: 'persistent', fadeAfter: null }, 10**12),
    ).toBe(false);
    expect(
      isFadedRailEntry({ railClass: 'persistent', fadeAfter: 5 }, 10**12),
    ).toBe(false);
  });

  it('fadeAfter 缺失 → 不淡出（诚实缺省）', () => {
    expect(isFadedRailEntry({ railClass: 'static', fadeAfter: null }, 10**12)).toBe(false);
  });
});

describe('collapseRailEntries（单屏刻度上限 7，超出收拢 +N）', () => {
  it('≤7 全显示，按 railedAt 最新在前', () => {
    const entries = Array.from({ length: RAIL_MAX_TICKS }, (_, i) =>
      makeEntry({ id: `e${i}`, railedAt: i }),
    );
    const { visible, overflow } = collapseRailEntries(entries);
    expect(visible).toHaveLength(RAIL_MAX_TICKS);
    expect(visible[0].id).toBe(`e${RAIL_MAX_TICKS - 1}`);
    expect(overflow).toBe(0);
  });

  it('8 条 → 显示最新 6 条 + overflow=2', () => {
    const entries = Array.from({ length: RAIL_MAX_TICKS + 1 }, (_, i) =>
      makeEntry({ id: `e${i}`, railedAt: i }),
    );
    const { visible, overflow } = collapseRailEntries(entries);
    expect(visible).toHaveLength(RAIL_MAX_TICKS - 1);
    expect(visible[0].id).toBe(`e${RAIL_MAX_TICKS}`);
    expect(overflow).toBe(2);
  });

  it('空轨道 → 空显示零收拢', () => {
    expect(collapseRailEntries([])).toEqual({ visible: [], overflow: 0 });
  });
});

describe('railEntryTitle（轨道卡标题）', () => {
  it('result 键取尾段产物名', () => {
    expect(railEntryTitle({ type: 'result', key: 'tj_1:volcano.png' })).toBe('结果 · volcano.png');
  });

  it('terminal 键整段即 sessionId', () => {
    expect(railEntryTitle({ type: 'terminal', key: 'default' })).toBe('终端 · default');
  });

  it('未知类型回退类型名', () => {
    expect(railEntryTitle({ type: 'mystery', key: '' })).toBe('mystery');
  });
});
