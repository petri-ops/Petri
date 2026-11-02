import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpreadsheetResultViewer } from './SpreadsheetResultViewer';

/**
 * BLOCK-142（成果面切片 E·renderer 补课）SpreadsheetResultViewer 契约测试。
 *
 * 契约（docs/block-142-artifact-plane-renderers-plan.md §1.2）：
 *   - props { url, name }：fetch 产物 URL → ArrayBuffer → exceljs 解析 → 首工作表网格；
 *   - 行 ≤200 / 列 ≤50 有界预览，超限**如实标注截断**（真实总行/列数不伪造）；
 *   - 多工作表：列 sheet 名可切换；
 *   - 获取/解析失败如实显示错误。
 *
 * exceljs 以动态 import 引入（bundle 语义同 pdfjs 先例：仅点开 xlsx 时加载）；
 * 测试用 vi.mock 替换其 Workbook。
 */

type FakeSheet = {
  name: string;
  grid: string[][];
  rowCount?: number;
  columnCount?: number;
};

const sheetsHolder = vi.hoisted(() => ({ sheets: [] as unknown[] }));

vi.mock('exceljs', () => ({
  Workbook: class {
    worksheets = sheetsHolder.sheets;
    xlsx = { load: vi.fn(async (_buffer: ArrayBuffer) => {}) };
  },
}));

function makeSheet(def: FakeSheet): Record<string, unknown> {
  const rowCount = def.rowCount ?? def.grid.length;
  const columnCount = def.columnCount ?? (def.grid[0]?.length ?? 0);
  return {
    name: def.name,
    rowCount,
    columnCount,
    getRow: (r: number) => ({
      getCell: (c: number) => ({ text: def.grid[r - 1]?.[c - 1] ?? '' }),
    }),
  };
}

function mockFetchBuffer(ok = true): ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.resolve({ ok, status: ok ? 200 : 404, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sheetsHolder.sheets = [];
});

describe('SpreadsheetResultViewer（BLOCK-142 切片 E）', () => {
  it('exceljs 解析后渲染首工作表网格，并列出多工作表名', async () => {
    sheetsHolder.sheets = [
      makeSheet({ name: 'DEG', grid: [['基因', 'log2FC'], ['TP53', '2.4']] }),
      makeSheet({ name: 'Summary', grid: [['项', '值'], ['行数', '2']] }),
    ];
    vi.stubGlobal('fetch', mockFetchBuffer());
    const { container, getByRole, getByTestId } = render(
      <SpreadsheetResultViewer url="http://mock/results.xlsx" name="results.xlsx" />,
    );
    await waitFor(() => expect(getByTestId('spreadsheet-viewer')).toBeTruthy());
    // 首工作表网格
    expect(container.textContent).toContain('TP53');
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent).toBe('DEG');
    expect(tabs[1].textContent).toBe('Summary');
    expect(getByRole('tab', { name: 'DEG' }).getAttribute('aria-selected')).toBe('true');
  });

  it('行/列有界：超限截断并如实标注真实总数', async () => {
    sheetsHolder.sheets = [
      makeSheet({
        name: 'Big',
        grid: Array.from({ length: 200 }, (_, r) => [`r${r + 1}`, 'c2']),
        rowCount: 5000,
        columnCount: 120,
      }),
    ];
    vi.stubGlobal('fetch', mockFetchBuffer());
    const { container, getByTestId } = render(
      <SpreadsheetResultViewer url="http://mock/big.xlsx" name="big.xlsx" />,
    );
    await waitFor(() => expect(getByTestId('spreadsheet-viewer')).toBeTruthy());
    // 有界：数据行 ≤200（表头行除外）
    expect(container.querySelectorAll('tbody tr').length).toBeLessThanOrEqual(200);
    // 如实标注：真实总行/列数（toLocaleString 千分位）+ 截断提示
    const note = getByTestId('spreadsheet-truncated').textContent ?? '';
    expect(note).toContain('5,000');
    expect(note).toContain('120');
    expect(note).toContain('截断');
  });

  it('未超限时不显示截断标注（有界但不误报）', async () => {
    sheetsHolder.sheets = [
      makeSheet({ name: 'Small', grid: [['a', 'b'], ['1', '2']] }),
    ];
    vi.stubGlobal('fetch', mockFetchBuffer());
    const { container, getByTestId } = render(
      <SpreadsheetResultViewer url="http://mock/small.xlsx" name="small.xlsx" />,
    );
    await waitFor(() => expect(getByTestId('spreadsheet-viewer')).toBeTruthy());
    // 单工作表不渲染 sheet 切换列；无截断标注
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(container.querySelector('[data-testid="spreadsheet-truncated"]')).toBeNull();
  });

  it('点击 sheet 名切换工作表网格', async () => {
    sheetsHolder.sheets = [
      makeSheet({ name: 'DEG', grid: [['基因'], ['TP53']] }),
      makeSheet({ name: 'Summary', grid: [['项'], ['总行数 2']] }),
    ];
    vi.stubGlobal('fetch', mockFetchBuffer());
    const { container, getByRole } = render(
      <SpreadsheetResultViewer url="http://mock/multi.xlsx" name="multi.xlsx" />,
    );
    await waitFor(() => expect(container.textContent).toContain('TP53'));
    getByRole('tab', { name: 'Summary' }).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitFor(() => expect(container.textContent).toContain('总行数 2'));
    expect(getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe('true');
  });

  it('fetch 失败如实显示错误（role=alert）', async () => {
    vi.stubGlobal('fetch', mockFetchBuffer(false));
    const { getByTestId } = render(
      <SpreadsheetResultViewer url="http://mock/gone.xlsx" name="gone.xlsx" />,
    );
    await waitFor(() => expect(getByTestId('spreadsheet-error')).toBeTruthy());
    expect(getByTestId('spreadsheet-error').getAttribute('role')).toBe('alert');
  });
});
