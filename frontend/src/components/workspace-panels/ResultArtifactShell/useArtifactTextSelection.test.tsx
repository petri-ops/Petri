import React, { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArtifactSelection } from '@/lib/artifact-selection';

const setSelectionBusSelection = vi.fn<(selection: ArtifactSelection | null, context?: { idField?: string | null }) => void>();
vi.mock('@/lib/selectionBus', () => ({
  setSelectionBusSelection: (selection: ArtifactSelection | null, context?: { idField?: string | null }) => setSelectionBusSelection(selection, context),
}));

import { useArtifactTextSelection } from './useArtifactTextSelection';
const firstSelection = () => setSelectionBusSelection.mock.calls[0][0] as ArtifactSelection;

function Host({ enabled = true, reader }: { enabled?: boolean; reader?: () => string | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useArtifactTextSelection({ enabled, containerRef: ref, artifactId: 'art-1', revisionId: 'rev-1', getSelectionText: reader });
  return (
    <div>
      <div ref={ref} data-testid="container"><span data-testid="inside">alpha line</span></div>
      <span data-testid="outside">outside text</span>
    </div>
  );
}

function selectNode(node: Node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

const fire = (type: string) => act(() => { document.dispatchEvent(new Event(type, { bubbles: true })); vi.advanceTimersByTime(300); });

beforeEach(() => { vi.useFakeTimers(); setSelectionBusSelection.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); window.getSelection()?.removeAllRanges(); });

describe('BLOCK-334 P2 Slice B useArtifactTextSelection（CodeMirror 统一后的选择总线接线）', () => {
  it('DOM 兜底：容器内选区在 pointerup 后进总线；容器外选区不进', () => {
    const { getByTestId } = render(<Host />);
    selectNode(getByTestId('inside'));
    fire('pointerup');
    expect(setSelectionBusSelection).toHaveBeenCalledTimes(1);
    expect(firstSelection()).toMatchObject({ artifactId: 'art-1', revisionId: 'rev-1', entityType: 'text_select', entityIds: ['alpha line'] });
    setSelectionBusSelection.mockClear();
    selectNode(getByTestId('outside'));
    fire('pointerup');
    expect(setSelectionBusSelection).not.toHaveBeenCalled();
  });

  it('EditorApi 优先：注入读取器返回精确文本时以其为准（长文档虚拟化下 DOM 选区可能不完整）', () => {
    render(<Host reader={() => 'exact from editor\nsecond'} />);
    fire('pointerup');
    expect(setSelectionBusSelection).toHaveBeenCalledTimes(1);
    expect(firstSelection().entityIds).toEqual(['exact from editor', 'second']);
  });

  it('读取器为空时回落 DOM 采样；keyup（Shift+方向键选区）同样触发', () => {
    const { getByTestId } = render(<Host reader={() => null} />);
    selectNode(getByTestId('inside'));
    fire('keyup');
    expect(setSelectionBusSelection).toHaveBeenCalledTimes(1);
    expect(firstSelection().entityIds).toEqual(['alpha line']);
  });

  it('同一选区去重；enabled=false 不采样', () => {
    const { getByTestId, rerender } = render(<Host />);
    selectNode(getByTestId('inside'));
    fire('pointerup');
    fire('pointerup');
    expect(setSelectionBusSelection).toHaveBeenCalledTimes(1);
    rerender(<Host enabled={false} />);
    setSelectionBusSelection.mockClear();
    fire('pointerup');
    expect(setSelectionBusSelection).not.toHaveBeenCalled();
  });
});
