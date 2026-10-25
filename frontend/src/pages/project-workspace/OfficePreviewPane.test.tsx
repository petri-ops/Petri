// BLOCK-254 P7 — Office 预览的段落/表格行批注入口。
//
// 钉三件事：① 有回调时每个段落/数据行都有「批注」按钮，并回传 0 起序号 + 原文；
// ② 没有回调时不渲染任何死按钮；③ 表格行与文档段落各自只出现自己那一类按钮。

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfficePreviewPane } from './OfficePreviewPane';
import type { OfficePreviewModel } from '@/lib/office-file-preview';

afterEach(cleanup);

function docPreview(text: string): OfficePreviewModel {
  return { kind: 'docx', title: 'report.docx', text };
}

function sheetPreview(): OfficePreviewModel {
  return {
    kind: 'xlsx',
    title: 'counts.xlsx',
    sheet: {
      name: 'Sheet1',
      rows: [
        { cells: ['gene', 'padj'] },
        { cells: ['TP53', '0.001'] },
      ],
    },
  };
}

describe('OfficePreviewPane（BLOCK-254 P7 锚点批注）', () => {
  it('文档段落：每段一个批注按钮，回传 0 起序号与段落原文', () => {
    const onAnnotateParagraph = vi.fn();
    render(
      <OfficePreviewPane
        preview={docPreview('第一段结论\n\n第二段方法\n\n第三段讨论')}
        onAssetOpen={() => undefined}
        onAnnotateParagraph={onAnnotateParagraph}
      />,
    );

    const buttons = screen.getAllByTestId('office-paragraph-annotate');
    expect(buttons).toHaveLength(3);
    expect(buttons[0].dataset.paragraph).toBe('1');
    expect(buttons[2].dataset.paragraph).toBe('3');

    fireEvent.click(buttons[1]);
    expect(onAnnotateParagraph).toHaveBeenCalledWith(1, '第二段方法');
  });

  it('没有回调时不渲染段落批注按钮，正文保持既有的整块呈现（零回归）', () => {
    const { container } = render(
      <OfficePreviewPane
        preview={docPreview('第一段\n\n第二段')}
        onAssetOpen={() => undefined}
      />,
    );
    expect(screen.queryByTestId('office-paragraph-annotate')).toBeNull();
    expect(screen.queryByTestId('office-paragraphs')).toBeNull();
    // 无批注入口时退回原有 TextBlock 形态（pre），不改既有阅读体验。
    expect(container.querySelector('pre')).toBeTruthy();
  });

  it('表格：按数据行给批注按钮，回传 0 起行号与整行摘要', () => {
    const onAnnotateRow = vi.fn();
    render(
      <OfficePreviewPane
        preview={sheetPreview()}
        onAssetOpen={() => undefined}
        onAnnotateRow={onAnnotateRow}
      />,
    );

    const buttons = screen.getAllByTestId('office-row-annotate');
    expect(buttons).toHaveLength(2);
    expect(buttons[1].dataset.row).toBe('2');

    fireEvent.click(buttons[1]);
    expect(onAnnotateRow).toHaveBeenCalledWith(1, 'TP53 | 0.001');
    // 表格形态不出段落按钮
    expect(screen.queryByTestId('office-paragraph-annotate')).toBeNull();
  });
});
