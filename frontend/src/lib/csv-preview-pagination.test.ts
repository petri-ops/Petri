import { describe, expect, it } from 'vitest';
import { CSV_PREVIEW_PAGE_SIZE, csvPreviewPageCount, csvPreviewPageRows } from './csv-preview-pagination';

describe('csv-preview-pagination（UI-454 静态表格本地分页）', () => {
  it('empty and small tables always have at least one page', () => {
    expect(csvPreviewPageCount(0)).toBe(1);
    expect(csvPreviewPageCount(24)).toBe(1);
    expect(csvPreviewPageCount(CSV_PREVIEW_PAGE_SIZE)).toBe(1);
  });

  it('splits rows into fixed-size pages', () => {
    expect(CSV_PREVIEW_PAGE_SIZE).toBe(50);
    expect(csvPreviewPageCount(51)).toBe(2);
    expect(csvPreviewPageCount(120)).toBe(3);
  });

  it('returns the correct slice for a page', () => {
    const rows = Array.from({ length: 120 }, (_, i) => `row-${i}`);
    expect(csvPreviewPageRows(rows, 0)[0]).toBe('row-0');
    expect(csvPreviewPageRows(rows, 0).length).toBe(50);
    expect(csvPreviewPageRows(rows, 1)[0]).toBe('row-50');
    expect(csvPreviewPageRows(rows, 2).length).toBe(20);
    expect(csvPreviewPageRows(rows, 2)[19]).toBe('row-119');
  });

  it('clamps out-of-range pages instead of rendering nothing', () => {
    const rows = Array.from({ length: 70 }, (_, i) => `row-${i}`);
    expect(csvPreviewPageRows(rows, -1)[0]).toBe('row-0');
    expect(csvPreviewPageRows(rows, 99).length).toBe(20);
    expect(csvPreviewPageRows(rows, 99)[0]).toBe('row-50');
    expect(csvPreviewPageRows([], 5)).toEqual([]);
  });
});
