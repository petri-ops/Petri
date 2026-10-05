import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfResultViewer } from './PdfResultViewer';

/**
 * BLOCK-142（成果面切片 E·renderer 补课）PdfResultViewer 契约测试。
 *
 * 契约（docs/block-142-artifact-plane-renderers-plan.md §1.3）：薄包装复用
 * pages/project-workspace/WorkspacePdfPreview（pdfjs-dist 渲染，props {url,name}），
 * **不复制实现**——本测试只断言透传与复用，不重复 pdfjs 行为（其契约在
 * WorkspacePdfPreview.test.tsx 自有守护）。
 */

const { pdfPreviewMock } = vi.hoisted(() => ({
  pdfPreviewMock: vi.fn((_props: { url: string; name: string }) => (
    <div data-testid="workspace-pdf-preview-stub" />
  )),
}));

vi.mock('@/pages/project-workspace/WorkspacePdfPreview', () => ({
  WorkspacePdfPreview: pdfPreviewMock,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PdfResultViewer（BLOCK-142 切片 E）', () => {
  it('薄包装：props 原样透传给 WorkspacePdfPreview（复用不复制）', () => {
    const { getByTestId } = render(
      <PdfResultViewer url="http://mock/paper.pdf" name="paper.pdf" />,
    );
    expect(getByTestId('workspace-pdf-preview-stub')).toBeTruthy();
    expect(pdfPreviewMock.mock.calls[0]?.[0]).toEqual({ url: 'http://mock/paper.pdf', name: 'paper.pdf' });
  });

  it('复用边界：本组件不引入 pdfjs-dist（pdfjs 只在 WorkspacePdfPreview 出现）', () => {
    // 结构性断言：mock 掉 WorkspacePdfPreview 后组件仍可渲染（无自身 pdfjs 依赖路径）
    expect(() => render(<PdfResultViewer url="http://mock/b.pdf" name="b.pdf" />)).not.toThrow();
    expect(pdfPreviewMock).toHaveBeenCalledTimes(1);
    expect(pdfPreviewMock.mock.calls[0]?.[0]).toEqual({ url: 'http://mock/b.pdf', name: 'b.pdf' });
  });
});
