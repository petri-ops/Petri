// BLOCK-245 P2 — 引用条渲染面（从 SimpleChat 内联 JSX 平移）的锚点：
// 两类载荷各自渲染、移除回调带上被点条目的 id、空列表零渲染。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ComposerContextChips } from './ComposerContextChips';
import type { ComposerContextItem } from './contextItems';
import type { ImageReference } from './imageReferences';
import type { SelectionReference } from './selectionReferences';

afterEach(cleanup);

const selection: SelectionReference = {
  id: 'selref-1',
  path: 'analysis/plots.R',
  name: 'plots.R',
  startLine: 42,
  endLine: 48,
  text: 'ggplot(d, aes(x, y))',
};

const image: ImageReference = {
  id: 'imgref-1',
  kind: 'workspace-file',
  name: 'umap.png',
  path: 'figures/umap.png',
  url: 'file:///ws/figures/umap.png',
};

describe('ComposerContextChips（BLOCK-245 P2）', () => {
  it('两类引用同时在场 → 各自渲染位置标签与来源标签', () => {
    render(<ComposerContextChips selections={[selection]} images={[image]} onRemove={vi.fn()} />);
    expect(screen.getByText('analysis/plots.R:L42-L48')).toBeTruthy();
    expect(screen.getByText('figures/umap.png')).toBeTruthy();
    expect(screen.getByRole('button', { name: '移除引用' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '移除图片引用' })).toBeTruthy();
  });

  it('移除回调带上被点条目的 id（两簇互不串）', () => {
    const onRemove = vi.fn();
    render(<ComposerContextChips selections={[selection]} images={[image]} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: '移除引用' }));
    fireEvent.click(screen.getByRole('button', { name: '移除图片引用' }));
    expect(onRemove).toHaveBeenNthCalledWith(1, 'selref-1');
    expect(onRemove).toHaveBeenNthCalledWith(2, 'imgref-1');
  });

  it('空列表零渲染（不占 composer 空间）', () => {
    const { container } = render(<ComposerContextChips selections={[]} images={[]} onRemove={vi.fn()} />);
    expect(container.querySelector('.sc-selection-refs')).toBeNull();
    expect(container.querySelector('.sc-image-refs')).toBeNull();
  });

  it('BLOCK-245 P4 — `@` 产出的其余引用在 composer 可见且可逐项移除', () => {
    const onRemove = vi.fn();
    const other: ComposerContextItem = {
      id: 'ctx-file-src/a.R',
      kind: 'file',
      group: 'reference',
      label: 'src/a.R',
      source: '文件',
      lines: ['【引用文件】', '> path：src/a.R'],
      dedupeKey: 'file|src/a.R',
      payload: {},
    };
    const { container } = render(
      <ComposerContextChips selections={[]} images={[]} others={[other]} onRemove={onRemove} />,
    );
    expect(screen.getByText('src/a.R')).toBeTruthy();
    expect(screen.getByText('文件')).toBeTruthy();
    expect(container.querySelector('[data-context-kind="file"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '移除上下文引用' }));
    expect(onRemove).toHaveBeenCalledWith('ctx-file-src/a.R');
  });
});
