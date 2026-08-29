import { describe, expect, it } from 'vitest';

import {
  computeFileDiffStats,
  groupDisplayName,
  groupFilesByDirectory,
  isFileReviewed,
} from './reviewModeHelpers';
import type { DiffFile } from './useWorkingTreeReview';

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

  it('requires every hunk to carry a decision', () => {
    const file = makeDiffFile({
      hunks: [
        { oldStart: 1, newStart: 1, lines: [{ type: 'add', text: 'x' }] },
        { oldStart: 5, newStart: 5, lines: [{ type: 'del', text: 'y' }] },
      ],
    });
    const partial = { 'src/a.py#0': 'accept' } as const;
    expect(isFileReviewed(file, { ...partial })).toBe(false);
    const full = { 'src/a.py#0': 'accept', 'src/a.py#1': 'reject' } as const;
    expect(isFileReviewed(file, { ...full })).toBe(true);
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

  it('renders root group display name as "."', () => {
    expect(groupDisplayName('')).toBe('.');
    expect(groupDisplayName('src')).toBe('src');
  });
});
