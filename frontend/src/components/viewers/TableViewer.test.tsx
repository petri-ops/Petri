import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TableViewer } from './TableViewer';

afterEach(cleanup);

const rows = [['列A', '列B'], ...Array.from({ length: 95 }, (_, i) => [`r${i}`, 'x'])];

describe('BLOCK-334 P2 TableViewer（两宿主唯一表格 viewer）', () => {
  it('clipped：最多展示 clipRows 行 + 截断提示（文件宿主语义）', () => {
    render(
      <TableViewer rows={rows} mode="clipped" clipRows={40} classNames={{ root: 'root-c', hint: 'hint-c' }} />,
    );
    expect(document.querySelectorAll('tbody tr')).toHaveLength(40);
    expect(screen.getByText(/已展示前 40 行 \/ 共 95 行/)).toBeTruthy();
    expect(document.querySelector('p.hint-c')).toBeTruthy();
    expect(screen.queryByText('上一页')).toBeNull();
  });

  it('paged：页码受控 + 上下页回调（壳宿主语义）', () => {
    const onPageChange = vi.fn();
    render(
      <TableViewer rows={rows} mode="paged" page={0} onPageChange={onPageChange} classNames={{ root: 'root-p', pager: 'pager-p' }} />,
    );
    const pager = document.querySelector('div.pager-p');
    expect(pager?.textContent).toContain('共 95 行');
    const buttons = Array.from(pager?.querySelectorAll('button') || []);
    expect(buttons.find((b) => b.textContent === '上一页')?.hasAttribute('disabled')).toBe(true);
    fireEvent.click(buttons.find((b) => b.textContent === '下一页')!);
    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange.mock.calls[0][0]).toBeTypeOf('function');
  });

  it('空缺单元格以 — 兜底', () => {
    render(<TableViewer rows={[['列A', '列B'], ['只有第一列', '']]} mode="clipped" />);
    expect(screen.getByText('—')).toBeTruthy();
  });
});
