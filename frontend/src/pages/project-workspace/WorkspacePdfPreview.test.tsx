import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// pdfjs mock：两页文档，getPage/getViewport/render 全假
const fakePage = {
  getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
  render: vi.fn(() => ({ promise: Promise.resolve() })),
};
const fakeDoc = {
  numPages: 2,
  getPage: vi.fn(async () => fakePage),
  destroy: vi.fn(async () => {}),
};

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => ({ promise: Promise.resolve(fakeDoc) })),
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'mock-worker-url' }));

import { WorkspacePdfPreview } from './WorkspacePdfPreview';

// happy-dom 无 2d 上下文：render 已被 mock，桩掉 getContext 让组件走到渲染分支
beforeAll(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext =
    vi.fn(() => ({} as unknown as CanvasRenderingContext2D));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WorkspacePdfPreview (UI-400-1 pdfjs 渲染)', () => {
  it('加载文档并逐页渲染 canvas，进度显示总页数', async () => {
    const { container, getByTestId } = render(<WorkspacePdfPreview url="http://mock/file.pdf" name="样例.pdf" />);
    await waitFor(() => expect(getByTestId('pdf-progress').textContent).toContain('共 2 页'));
    expect(container.querySelectorAll('canvas').length).toBe(2);
    expect(fakeDoc.getPage).toHaveBeenCalledTimes(2);
  });

  it('加载失败显示错误态', async () => {
    vi.mocked(fakeDoc.getPage).mockRejectedValueOnce(new Error('bad pdf'));
    const { getByTestId } = render(<WorkspacePdfPreview url="http://mock/bad.pdf" name="坏.pdf" />);
    await waitFor(() => expect(getByTestId('pdf-preview').textContent).toContain('PDF 渲染失败'));
  });

  // BLOCK-219 Q6：逐页定位盒子 + 注入的批注覆盖层（portal 挂进页盒子）
  it('每页套一层 data-page 定位盒子，并按页挂载覆盖层', async () => {
    const { container, getByTestId } = render(
      <WorkspacePdfPreview
        url="http://mock/annotated.pdf"
        name="带批注.pdf"
        renderPageOverlay={(page) => <span data-testid={`page-overlay-${page}`}>第 {page} 页批注层</span>}
      />,
    );
    await waitFor(() => expect(container.querySelectorAll('canvas').length).toBe(2));
    const boxes = Array.from(container.querySelectorAll('[data-page]'));
    expect(boxes.map((node) => (node as HTMLElement).dataset.page)).toEqual(['1', '2']);
    await waitFor(() => expect(getByTestId('page-overlay-1')).toBeTruthy());
    expect(getByTestId('page-overlay-2')).toBeTruthy();
    // 覆盖层必须在自己的页盒子内（坐标参照系不能串页）
    expect(boxes[0].contains(getByTestId('page-overlay-1'))).toBe(true);
    expect(boxes[1].contains(getByTestId('page-overlay-1'))).toBe(false);
  });
});
