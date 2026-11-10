import { describe, expect, it } from 'vitest';
import { treeRovingIntent, rovingTabIndex } from './treeRoving';

describe('B-10 树 roving tabindex 纯映射', () => {
  it('整棵树只有一个 tab stop', () => {
    const tabs = Array.from({ length: 7 }, (_, i) => rovingTabIndex(i, 3));
    expect(tabs.filter((t) => t === 0)).toHaveLength(1);
    expect(tabs[3]).toBe(0);
    expect(tabs.filter((t) => t === -1)).toHaveLength(6);
  });

  it('上下键移动并钳制边界', () => {
    expect(treeRovingIntent('ArrowDown', 2, 5)).toEqual({ kind: 'move', index: 3 });
    expect(treeRovingIntent('ArrowUp', 2, 5)).toEqual({ kind: 'move', index: 1 });
    expect(treeRovingIntent('ArrowDown', 4, 5)).toEqual({ kind: 'move', index: 4 });
    expect(treeRovingIntent('ArrowUp', 0, 5)).toEqual({ kind: 'move', index: 0 });
  });

  it('Home/End 跳首尾，左右键表达展开折叠意图', () => {
    expect(treeRovingIntent('Home', 3, 5)).toEqual({ kind: 'home', index: 0 });
    expect(treeRovingIntent('End', 3, 5)).toEqual({ kind: 'end', index: 4 });
    expect(treeRovingIntent('ArrowRight', 3, 5)).toEqual({ kind: 'toggle', index: 3 });
    expect(treeRovingIntent('ArrowLeft', 3, 5)).toEqual({ kind: 'toggle', index: 3 });
  });

  it('空树 / 无关按键不动焦点', () => {
    expect(treeRovingIntent('ArrowDown', 0, 0)).toEqual({ kind: 'none' });
    expect(treeRovingIntent('a', 2, 5)).toEqual({ kind: 'none' });
  });
});

// 真挂载契约：防止只写纯函数不接线（B-10 的出口判据是树真的能键盘导航）
describe('B-10 真挂载', () => {
  it('LeftPanel 的 ProjectTree 消费纯映射并挂 tabIndex / onKeyDown', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(__dirname, 'LeftPanel.tsx'), 'utf8');
    expect(src).toContain("from './treeRoving'");
    expect(src).toContain('treeRovingIntent(event.key, activeIndex, count)');
    expect(src).toContain('rovingTabIndex(index, activeIndex)');
    expect(src).toContain('onKeyDown={onTreeKeyDown}');
    expect(src).toContain('tabIndex={treeTabIndex}');
    expect(src).toContain('rowRefs.current[intent.index]?.focus()');
  });
});
