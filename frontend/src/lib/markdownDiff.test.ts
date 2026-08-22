import { describe, expect, it } from 'vitest';
import { classifyDiffLine, computeLcsDiff, computeSimpleDiff, computeUnifiedDiff } from './markdownDiff';

// ---------- computeSimpleDiff (BLOCK-17 保留) ----------

describe('markdownDiff.computeSimpleDiff', () => {
  it('相同字符串每行都标 ctx', () => {
    const r = computeSimpleDiff('a\nb\nc', 'a\nb\nc');
    expect(r.left).toEqual([' a', ' b', ' c']);
    expect(r.right).toEqual([' a', ' b', ' c']);
  });

  it('左侧多行：右侧用空白占位', () => {
    const r = computeSimpleDiff('a\nb\nc', 'a\nb');
    expect(r.left).toEqual([' a', ' b', '-c']);
    expect(r.right).toEqual([' a', ' b', '  ']);
  });

  it('右侧多行：左侧用空白占位', () => {
    const r = computeSimpleDiff('a\nb', 'a\nb\nc');
    expect(r.left).toEqual([' a', ' b', '  ']);
    expect(r.right).toEqual([' a', ' b', '+c']);
  });
});

// ---------- computeLcsDiff (BLOCK-18 双列) ----------

describe('markdownDiff.computeLcsDiff', () => {
  it('完全相同：每行标 ctx', () => {
    const r = computeLcsDiff('a\nb\nc', 'a\nb\nc', 0);
    expect(r.left).toEqual([' a', ' b', ' c']);
    expect(r.right).toEqual([' a', ' b', ' c']);
  });

  it('行重排：LCS 识别出未变化的行', () => {
    // A\nB\nC vs C\nA\nB → LCS = A\nB（长度 2）。等价于：先 add C，再 eq A eq B，再 del C
    const r = computeLcsDiff('A\nB\nC', 'C\nA\nB', 0);
    expect(r.left).toEqual(['  ', ' A', ' B', '-C']);
    expect(r.right).toEqual(['+C', ' A', ' B', '  ']);
  });

  it('空字符串 split 后得到 1 行占位', () => {
    expect(computeLcsDiff('', '', 0)).toEqual({ left: [' '], right: [' '] });
  });
});

// ---------- computeUnifiedDiff (BLOCK-18 新版, 单列 git-style) ----------

describe('markdownDiff.computeUnifiedDiff', () => {
  it('完全相同：空数组（无 hunk）', () => {
    expect(computeUnifiedDiff('a\nb\nc', 'a\nb\nc', 3)).toEqual([]);
  });

  it('右侧末尾多行：hunk header + ctx + add', () => {
    expect(computeUnifiedDiff('a\nb', 'a\nb\nc\nd', 3)).toEqual([
      '@@ -1,2 +1,4 @@',
      ' a',
      ' b',
      '+c',
      '+d',
    ]);
  });

  it('左侧末尾多行：hunk header + ctx + del', () => {
    expect(computeUnifiedDiff('a\nb\nc\nd', 'a\nb', 3)).toEqual([
      '@@ -1,4 +1,2 @@',
      ' a',
      ' b',
      '-c',
      '-d',
    ]);
  });

  it('中间一行改：hunk header + ctx + del + add + ctx', () => {
    // ops: eq a, add Y, del X, eq b → 渲染按 ops 顺序：ctx a, +Y, -X, ctx b
    expect(computeUnifiedDiff('a\nX\nb', 'a\nY\nb', 3)).toEqual([
      '@@ -1,3 +1,3 @@',
      ' a',
      '+Y',
      '-X',
      ' b',
    ]);
  });

  it('中间插入 1 行：hunk header + ctx + add + ctx', () => {
    expect(computeUnifiedDiff('a\nb\nc', 'a\nX\nb\nc', 3)).toEqual([
      '@@ -1,3 +1,4 @@',
      ' a',
      '+X',
      ' b',
      ' c',
    ]);
  });

  it('删除中间 1 行：hunk header + ctx + del + ctx', () => {
    expect(computeUnifiedDiff('a\nX\nb\nc', 'a\nb\nc', 3)).toEqual([
      '@@ -1,4 +1,3 @@',
      ' a',
      '-X',
      ' b',
      ' c',
    ]);
  });

  it('连续 7 行 eq + 1 行改动 + 3 行 eq：前 4 行游离折叠', () => {
    // ops: eq a1..a7, add Y, del X, eq b1..b3
    // 前 4 行 eq (a1..a4) 距离最近改动 > context=3 → 游离
    // hunk 从 a5 开始
    const left = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'X', 'b1', 'b2', 'b3'].join('\n');
    const right = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'Y', 'b1', 'b2', 'b3'].join('\n');
    expect(computeUnifiedDiff(left, right, 3)).toEqual([
      '@@ -5,7 +5,7 @@',
      ' a5',
      ' a6',
      ' a7',
      '+Y',
      '-X',
      ' b1',
      ' b2',
      ' b3',
    ]);
  });

  it('连续 eq 段长度 < 2*context：不折叠', () => {
    expect(computeUnifiedDiff('a\nX\nb', 'a\nY\nb', 3)).toEqual([
      '@@ -1,3 +1,3 @@',
      ' a',
      '+Y',
      '-X',
      ' b',
    ]);
  });

  it('两段改动距离远：两个 hunk', () => {
    // 在中间隔很远两处改
    const left = ['1', '2', '3', '4', '5', '6', '7', '8', 'X', '10', '11', '12', '13', '14', '15', '16', '17', 'Y', '19', '20'].join('\n');
    const right = ['1', '2', '3', '4', '5', '6', '7', '8', 'X\'', '10', '11', '12', '13', '14', '15', '16', '17', 'Y\'', '19', '20'].join('\n');
    const r = computeUnifiedDiff(left, right, 3);
    const hunkHeaders = r.filter((l) => l.startsWith('@@'));
    expect(hunkHeaders.length).toBeGreaterThanOrEqual(2);
  });

  it('空 vs 非空：保留 split 行为（""split→[""]长度 1）', () => {
    // '' split 后是 ['']（长度 1），所以 leftCount=1，hunk header 为 @@ -1,1 +1,2 @@
    const r = computeUnifiedDiff('', 'a\nb', 3);
    expect(r[0]).toMatch(/^@@ -1,1 \+1,2 @@$/);
    expect(r.filter((l) => l.startsWith('+'))).toEqual(['+a', '+b']);
  });
});

// ---------- classifyDiffLine ----------

describe('markdownDiff.classifyDiffLine', () => {
  it.each([
    [' foo', 'ctx'],
    ['+foo', 'add'],
    ['-foo', 'del'],
    ['… 5 unchanged lines', 'fold'],
    ['@@ -1,3 +1,3 @@', 'hunk'],
    ['', 'ctx'],
  ])('classify %j → %s', (line, expected) => {
    expect(classifyDiffLine(line)).toBe(expected);
  });
});
