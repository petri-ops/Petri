import { describe, expect, it } from 'vitest';

import {
  computeFileDiffStats,
  groupDisplayName,
  groupFilesByDirectory,
  hunkDecisionKey,
  hunkDecisionList,
  hunkSignature,
  isFileReviewed,
} from './reviewModeHelpers';
import type { DiffFile, Hunk, HunkDecision } from './useWorkingTreeReview';

describe('hunkDecisionKey 形态锚（BLOCK-147 P2-3）', () => {
  // 键形态是后端 commitReview（lastIndexOf('#') 切分文件路径）正确性的唯一前提：
  // 签名段不得引入 '#'。若签名算法改法破坏该形态，此测试红——防止静默错切路径。
  it('键形态锁定：`path#h{oldStart}-{base36}`，签名段不含 #', () => {
    const hunk: Hunk = {
      oldStart: 12,
      newStart: 15,
      lines: [
        { type: 'ctx', text: 'context' },
        { type: 'add', text: 'added' },
        { type: 'del', text: 'gone' },
      ],
    };
    const key = hunkDecisionKey('src/a.py', hunk);
    expect(key).toMatch(/^src\/a\.py#h\d+-[0-9a-z]+$/);
    // 签名段（首个 '#' 之后）不含 '#'，后端 lastIndexOf 切分才落在 path 与签名交界。
    expect(key.slice(key.indexOf('#') + 1)).not.toContain('#');
  });
});

function makeDiffFile(overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path: 'src/a.py',
    oldPath: null,
    binary: false,
    hunks: [],
    ...overrides,
  };
}

describe('computeFileDiffStats', () => {
  it('counts add/del lines per file and ignores context lines', () => {
    const file = makeDiffFile({
      hunks: [
        {
          oldStart: 1,
          newStart: 1,
          lines: [
            { type: 'ctx', text: 'a' },
            { type: 'add', text: 'b' },
            { type: 'del', text: 'c' },
            { type: 'add', text: 'd' },
          ],
        },
      ],
    });
    expect(computeFileDiffStats(file)).toEqual({ added: 2, removed: 1 });
  });

  it('returns zeros for missing files', () => {
    expect(computeFileDiffStats(undefined)).toEqual({ added: 0, removed: 0 });
  });
});

describe('isFileReviewed', () => {
  it('is false when the file is not covered by the diff', () => {
    expect(isFileReviewed(undefined, {})).toBe(false);
  });

  it('is auto-true for binary or hunk-less files', () => {
    expect(isFileReviewed(makeDiffFile({ binary: true }), {})).toBe(true);
    expect(isFileReviewed(makeDiffFile({ hunks: [] }), {})).toBe(true);
  });

  it('requires every hunk to carry a decision (BLOCK-147 #1 内容寻址键)', () => {
    const h0: Hunk = { oldStart: 1, newStart: 1, lines: [{ type: 'add', text: 'x' }] };
    const h1: Hunk = { oldStart: 5, newStart: 5, lines: [{ type: 'del', text: 'y' }] };
    const file = makeDiffFile({ hunks: [h0, h1] });
    const partial: Record<string, HunkDecision> = { [hunkDecisionKey('src/a.py', h0)]: 'accept' };
    expect(isFileReviewed(file, partial)).toBe(false);
    const full: Record<string, HunkDecision> = {
      [hunkDecisionKey('src/a.py', h0)]: 'accept',
      [hunkDecisionKey('src/a.py', h1)]: 'reject',
    };
    expect(isFileReviewed(file, full)).toBe(true);
  });
});

// ============================================================
// BLOCK-147 #1 — hunk 决策键内容寻址
// ============================================================
describe('BLOCK-147 #1 — hunkSignature / hunkDecisionKey / hunkDecisionList', () => {
  const HUNK_A: Hunk = {
    oldStart: 10,
    newStart: 12,
    lines: [
      { type: 'ctx', text: 'keep-line' },
      { type: 'add', text: 'A-new-line' },
    ],
  };
  const HUNK_B: Hunk = {
    oldStart: 40,
    newStart: 45,
    lines: [
      { type: 'ctx', text: 'hold-line' },
      { type: 'del', text: 'B-old-line' },
    ],
  };

  it('签名只由 oldStart + 行内容决定；newStart 漂移（前序 hunk 被拒回退）不改键', () => {
    expect(hunkSignature(HUNK_A)).toBe(hunkSignature({ ...HUNK_A, newStart: 99 }));
    expect(hunkDecisionKey('src/a.py', HUNK_A)).toBe(
      hunkDecisionKey('src/a.py', { ...HUNK_A, newStart: HUNK_A.newStart - 3 })
    );
  });

  it('不同内容 / 不同 oldStart / 不同路径的键互不相同', () => {
    const keyA = hunkDecisionKey('src/a.py', HUNK_A);
    const keyB = hunkDecisionKey('src/a.py', HUNK_B);
    const keyAOldStart = hunkDecisionKey('src/a.py', { ...HUNK_A, oldStart: 11 });
    const keyAOtherFile = hunkDecisionKey('src/b.py', HUNK_A);
    expect(new Set([keyA, keyB, keyAOldStart, keyAOtherFile]).size).toBe(4);
  });

  it('同内容 hunk 重新出现时命中既有决策（reject 后 agent 原样重写场景）', () => {
    const decisions: Record<string, HunkDecision> = { [hunkDecisionKey('src/a.py', HUNK_A)]: 'reject' };
    const list = hunkDecisionList(
      makeDiffFile({ path: 'src/a.py', hunks: [{ ...HUNK_A, newStart: 11 }] }),
      decisions
    );
    expect(list).toEqual(['reject']);
  });

  it('refresh 后被拒 hunk 消失：幸存 hunk 不继承决策（错位复现，纯函数层）', () => {
    const decisions: Record<string, HunkDecision> = { [hunkDecisionKey('src/a.py', HUNK_A)]: 'reject' };
    // A 被拒回退 → diff 重解析仅剩 B（newStart 前移，oldStart 不变）
    const afterRefresh = makeDiffFile({
      path: 'src/a.py',
      hunks: [{ ...HUNK_B, newStart: 44 }],
    });
    expect(hunkDecisionList(afterRefresh, decisions)).toEqual([null]);
    expect(isFileReviewed(afterRefresh, decisions)).toBe(false);
  });

  it('hunkDecisionList 输出与 CodeMirrorDiffView.hunkDecisions 契约对齐（null = 未决）', () => {
    const decisions: Record<string, HunkDecision> = {
      [hunkDecisionKey('src/a.py', HUNK_A)]: 'accept',
      [hunkDecisionKey('src/a.py', HUNK_B)]: 'pending',
    };
    expect(hunkDecisionList(makeDiffFile({ path: 'src/a.py', hunks: [HUNK_A, HUNK_B] }), decisions))
      .toEqual(['accept', null]);
  });
});

describe('groupFilesByDirectory', () => {
  it('groups by directory, sorts deterministically and puts root files last', () => {
    const groups = groupFilesByDirectory([
      { path: 'README.md' },
      { path: 'src/b.ts' },
      { path: 'src/a.ts' },
      { path: 'docs/x.md' },
    ]);
    expect(groups.map((g) => g.dir)).toEqual(['docs', 'src', '']);
    expect(groups[1].files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(groups[2].files.map((f) => f.path)).toEqual(['README.md']);
  });

  it('renders root group display name as （根目录） (UI-244)', () => {
    expect(groupDisplayName('')).toBe('（根目录）');
    expect(groupDisplayName('src')).toBe('src');
  });
});
