import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { AnnotationOverlay } from './AnnotationOverlay';
import type { ArtifactAnnotation } from '@/lib/annotations';

/** BLOCK-219 Q6 — 覆盖层的渲染与拖拽契约（坐标归一化是批注可复现的前提）。 */

const BOX = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0 } as DOMRect;

function annotation(overrides: Partial<ArtifactAnnotation>): ArtifactAnnotation {
  return {
    annotationId: 'ann-1',
    contractVersion: 1,
    projectId: 'p1',
    conversationId: null,
    surface: 'result-artifact',
    artifactId: 'a1',
    revisionId: 'r1',
    filePath: null,
    artifactName: 'volcano.png',
    kind: 'region',
    page: null,
    rect: [0.1, 0.1, 0.2, 0.2],
    comment: '离群点',
    color: 'amber',
    author: 'user',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AnnotationOverlay', () => {
  it('只渲染当前页的批注，并按百分比定位', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const { getAllByTestId, getByTestId } = render(
      <AnnotationOverlay
        annotations={[
          annotation({ annotationId: 'p1-a', page: 1 }),
          annotation({ annotationId: 'p1-b', page: 1 }),
          annotation({ annotationId: 'p2-a', page: 2 }),
        ]}
        page={1}
        drawing={false}
        color="amber"
        onCommit={() => undefined}
        label="批注层：第 1 页"
      />,
    );

    expect(getAllByTestId('annotation-box')).toHaveLength(2);
    expect(getByTestId('annotation-overlay').dataset.annotationCount).toBe('2');
    const first = getAllByTestId('annotation-box')[0];
    expect(first.style.left).toBe('10.00%');
    expect(first.style.width).toBe('20.00%');
  });

  it('非绘制模式不产生新批注（不抢查看器交互）', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <AnnotationOverlay
        annotations={[]}
        page={null}
        drawing={false}
        color="amber"
        onCommit={onCommit}
        label="批注层"
      />,
    );
    const overlay = getByTestId('annotation-overlay');
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(overlay, { clientX: 120, clientY: 60 });
    fireEvent.pointerUp(overlay, { clientX: 120, clientY: 60 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('绘制模式把拖拽归一成页内矩形并提交', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <AnnotationOverlay
        annotations={[]}
        page={2}
        drawing
        color="sky"
        onCommit={onCommit}
        label="批注层：第 2 页"
      />,
    );
    const overlay = getByTestId('annotation-overlay');
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(overlay, { clientX: 120, clientY: 60 });
    fireEvent.pointerUp(overlay, { clientX: 120, clientY: 60 });
    expect(onCommit).toHaveBeenCalledWith([0.1, 0.1, 0.5, 0.5]);
  });

  it('误触（过小拖拽）不提交批注', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <AnnotationOverlay
        annotations={[]}
        page={null}
        drawing
        color="amber"
        onCommit={onCommit}
        label="批注层"
      />,
    );
    const overlay = getByTestId('annotation-overlay');
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 10 });
    fireEvent.pointerUp(overlay, { clientX: 20.2, clientY: 10.1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('点击既有批注回传 id（供列表定位）', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const onSelect = vi.fn();
    const { getAllByTestId } = render(
      <AnnotationOverlay
        annotations={[annotation({ annotationId: 'ann-x', page: null })]}
        page={null}
        drawing={false}
        color="rose"
        onCommit={() => undefined}
        onSelect={onSelect}
        label="批注层"
      />,
    );
    fireEvent.click(getAllByTestId('annotation-box')[0]);
    expect(onSelect).toHaveBeenCalledWith('ann-x');
  });
});
