// UI-451 — 文件面板多 tab 常驻：数组纯函数单测（openWorkspaceFileTab /
// closeWorkspaceFileTabs / moveWorkspaceFileTab）。

import { describe, expect, it } from 'vitest';
import type { ActiveWorkspaceFile } from './types';
import {
  closeWorkspaceFileTabs,
  fileTabPanelId,
  moveWorkspaceFileTab,
  openWorkspaceFileTab,
  pickLruEviction,
  renameWorkspaceFileTab,
} from './workspaceFileTabOps';

function file(path: string): ActiveWorkspaceFile {
  return { path, name: path.split('/').pop() || path, url: `http://mock/${path}` };
}

const A = file('a.txt');
const B = file('b.md');
const C = file('c.json');
const D = file('d.csv');

describe('openWorkspaceFileTab', () => {
  it('新 path 追加尾部', () => {
    const next = openWorkspaceFileTab([A, B], C);
    expect(next.map((item) => item.path)).toEqual(['a.txt', 'b.md', 'c.json']);
  });

  it('已存在 path 原位替换为新对象（顺序不变、身份更新）', () => {
    const seeded = openWorkspaceFileTab([], A);
    const reopened = { ...A, modifiedAt: 42 };
    const next = openWorkspaceFileTab([seeded[0], B], reopened);
    expect(next).toHaveLength(2);
    expect(next[0].path).toBe('a.txt');
    expect(next[0].modifiedAt).toBe(42);
    expect(next[0]).not.toBe(reopened);
    expect(next[1]).toBe(B);
  });

  it('空数组打开即为单元素（带分配的 tabId）', () => {
    const next = openWorkspaceFileTab([], A);
    expect(next).toHaveLength(1);
    expect(next[0].path).toBe('a.txt');
    expect(next[0].tabId).toBeTruthy();
  });

  it('UI-451 v2：追加时分配稳定 tabId；原位替换保留既有 tabId；两次追加 id 互异', () => {
    const first = openWorkspaceFileTab([], A);
    expect(typeof first[0].tabId).toBe('string');
    expect(first[0].tabId).toBeTruthy();
    const second = openWorkspaceFileTab(first, B);
    expect(second[1].tabId).toBeTruthy();
    expect(second[1].tabId).not.toBe(second[0].tabId);
    const replaced = openWorkspaceFileTab(second, { ...B, modifiedAt: 9 });
    expect(replaced[1].tabId).toBe(second[1].tabId);
    expect(replaced[1].modifiedAt).toBe(9);
  });
});

describe('renameWorkspaceFileTab (UI-451 v2 P1-1)', () => {
  it('旧 path 原位重定向到新对象并携带旧 tabId（实例存活）', () => {
    const seeded = openWorkspaceFileTab([], A);
    const withB = openWorkspaceFileTab(seeded, B);
    const moved = { ...C, path: 'c-moved.json' };
    const next = renameWorkspaceFileTab(withB, 'a.txt', moved);
    expect(next.map((item) => item.path)).toEqual(['c-moved.json', 'b.md']);
    expect(next[0].tabId).toBe(withB[0].tabId);
  });

  it('活动语义由 hook 承载：目标 path 已有另一 tab 时去重保留重定向位', () => {
    const seeded = openWorkspaceFileTab([], A);
    const withB = openWorkspaceFileTab(seeded, B);
    const next = renameWorkspaceFileTab(withB, 'a.txt', { ...B });
    expect(next.map((item) => item.path)).toEqual(['b.md']);
    expect(next[0].tabId).toBe(withB[0].tabId);
  });

  it('oldPath 未打开：原数组原样返回（同引用）', () => {
    const files = openWorkspaceFileTab([], A);
    expect(renameWorkspaceFileTab(files, 'x.txt', { ...B })).toBe(files);
  });
});

describe('closeWorkspaceFileTabs', () => {
  it('关闭非活动 tab：数组剔除、活动不变', () => {
    const { files, nextActivePath } = closeWorkspaceFileTabs([A, B, C], 'b.md', ['a.txt']);
    expect(files.map((item) => item.path)).toEqual(['b.md', 'c.json']);
    expect(nextActivePath).toBe('b.md');
  });

  it('关闭活动 tab（中间位）：回退到其后第一个存活 tab', () => {
    const { files, nextActivePath } = closeWorkspaceFileTabs([A, B, C], 'b.md', ['b.md']);
    expect(files.map((item) => item.path)).toEqual(['a.txt', 'c.json']);
    expect(nextActivePath).toBe('c.json');
  });

  it('关闭活动 tab（尾部）：回退到存活 tab 的最后一个', () => {
    const { nextActivePath } = closeWorkspaceFileTabs([A, B, C], 'c.json', ['c.json']);
    expect(nextActivePath).toBe('b.md');
  });

  it('关闭唯一 tab：活动清空', () => {
    const { files, nextActivePath } = closeWorkspaceFileTabs([A], 'a.txt', ['a.txt']);
    expect(files).toEqual([]);
    expect(nextActivePath).toBeNull();
  });

  it('批量关闭含活动 tab：按第一个被关位置回退（关闭其他且活动被关 → 落到锚 tab）', () => {
    // 「关闭其他」锚在 A，活动是 C：A、B 之后的存活者 = A（锚）成为新活动
    const { files, nextActivePath } = closeWorkspaceFileTabs([A, B, C], 'c.json', ['b.md', 'c.json']);
    expect(files.map((item) => item.path)).toEqual(['a.txt']);
    expect(nextActivePath).toBe('a.txt');
  });

  it('「关闭右侧」关闭活动 tab：回退到锚 tab', () => {
    const { files, nextActivePath } = closeWorkspaceFileTabs([A, B, C, D], 'c.json', ['c.json', 'd.csv']);
    expect(files.map((item) => item.path)).toEqual(['a.txt', 'b.md']);
    expect(nextActivePath).toBe('b.md');
  });

  it('关闭全部：数组空、活动清空', () => {
    const { files, nextActivePath } = closeWorkspaceFileTabs([A, B], 'a.txt', ['a.txt', 'b.md']);
    expect(files).toEqual([]);
    expect(nextActivePath).toBeNull();
  });

  it('路径一个都不命中：原数组与活动原样返回（同引用）', () => {
    const files = [A, B];
    const result = closeWorkspaceFileTabs(files, 'b.md', ['x.txt']);
    expect(result.files).toBe(files);
    expect(result.nextActivePath).toBe('b.md');
  });
});

describe('moveWorkspaceFileTab', () => {
  it('前移（拖到右侧某 tab 之前）', () => {
    const next = moveWorkspaceFileTab([A, B, C], 'a.txt', 2);
    expect(next.map((item) => item.path)).toEqual(['b.md', 'a.txt', 'c.json']);
  });

  it('后移（拖到左侧某 tab 之前）', () => {
    const next = moveWorkspaceFileTab([A, B, C], 'c.json', 1);
    expect(next.map((item) => item.path)).toEqual(['a.txt', 'c.json', 'b.md']);
  });

  it('拖到末尾（toIndex = length）', () => {
    const next = moveWorkspaceFileTab([A, B, C], 'a.txt', 3);
    expect(next.map((item) => item.path)).toEqual(['b.md', 'c.json', 'a.txt']);
  });

  it('拖回头部（toIndex = 0）', () => {
    const next = moveWorkspaceFileTab([A, B, C], 'c.json', 0);
    expect(next.map((item) => item.path)).toEqual(['c.json', 'a.txt', 'b.md']);
  });

  it('原位（含 toIndex = fromIndex + 1 的名义后一位）：原数组原样返回', () => {
    const files = [A, B, C];
    expect(moveWorkspaceFileTab(files, 'b.md', 1)).toBe(files);
    expect(moveWorkspaceFileTab(files, 'b.md', 2)).toBe(files);
  });

  it('越界钳制与未知 path', () => {
    expect(moveWorkspaceFileTab([A, B, C], 'a.txt', 99).map((item) => item.path)).toEqual(['b.md', 'c.json', 'a.txt']);
    expect(moveWorkspaceFileTab([A, B, C], 'a.txt', -5).map((item) => item.path)).toEqual(['a.txt', 'b.md', 'c.json']);
    const files = [A, B];
    expect(moveWorkspaceFileTab(files, 'x.txt', 0)).toBe(files);
  });
});

describe('pickLruEviction (UI-451 v3 P2-7)', () => {
  const f = (p: string) => file(p);
  it('选 LRU 序里第一个仍打开且非脏非保留的 path', () => {
    const files = [f('a'), f('b'), f('c'), f('d')];
    const lru = ['b', 'c', 'a', 'd']; // b 最久未用
    expect(pickLruEviction(files, lru, {}, ['d'])).toBe('b');
  });
  it('跳过脏位与保留位，落到次旧', () => {
    const files = [f('a'), f('b'), f('c'), f('d')];
    const lru = ['b', 'c', 'a', 'd'];
    expect(pickLruEviction(files, lru, { b: true }, ['d', 'c'])).toBe('a');
  });
  it('全脏或无可淘汰：返回 null（诚实超额放行）', () => {
    const files = [f('a'), f('b')];
    expect(pickLruEviction(files, ['a', 'b'], { a: true, b: true }, [])).toBeNull();
    expect(pickLruEviction(files, ['zzz'], {}, [])).toBeNull();
  });
});

describe('fileTabPanelId (UI-451 v3 Minor a11y)', () => {
  it('tabId 优先；无 tabId 时净化 path 为合法 id', () => {
    expect(fileTabPanelId({ ...A, tabId: 'wftab-3' })).toBe('file-tab-panel-wftab-3');
    expect(fileTabPanelId(file('src/a x.txt'))).toBe('file-tab-panel-src_a_x_txt');
  });
});
