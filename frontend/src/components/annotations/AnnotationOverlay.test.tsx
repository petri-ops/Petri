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
    entryId: null,
    artifactName: 'volcano.png',
    kind: 'region',
    page: null,
    rect: [0.1, 0.1, 0.2, 0.2],
    path: [],
    anchor: null,
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
  it('BLOCK-238 — 图形批注按 kind 渲染（ellipse / arrow，缺省 region）', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const { getAllByTestId } = render(
      <AnnotationOverlay
        annotations={[
          annotation({ annotationId: 'k-region', kind: 'region' }),
          annotation({ annotationId: 'k-ellipse', kind: 'ellipse' }),
          annotation({ annotationId: 'k-arrow', kind: 'arrow' }),
        ]}
        page={null}
        drawing={false}
        color="amber"
        kind="region"
        onCommit={() => undefined}
        label="批注层：图像"
      />,
    );

    const kinds = getAllByTestId('annotation-box').map((el) => el.dataset.kind);
    expect(kinds).toEqual(['region', 'ellipse', 'arrow']);
  });

  it('BLOCK-254 — 文字批注把正文渲染在框内，马赛克不渲染正文', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const { getAllByTestId } = render(
      <AnnotationOverlay
        annotations={[
          annotation({ annotationId: 'k-text', kind: 'text', comment: '这段结论要复核' }),
          annotation({ annotationId: 'k-mosaic', kind: 'mosaic', comment: '遮住姓名' }),
        ]}
        page={null}
        drawing={false}
        color="amber"
        kind="region"
        onCommit={() => undefined}
        label="批注层：图像"
      />,
    );

    const boxes = getAllByTestId('annotation-box');
    expect(boxes.map((el) => el.dataset.kind)).toEqual(['text', 'mosaic']);
    // 文字批注：正文可见（不是只有编号徽标）。
    expect(boxes[0].textContent).toContain('这段结论要复核');
    // 马赛克：说明文字不进画面，避免在遮挡区上再画字。
    expect(boxes[1].textContent).not.toContain('遮住姓名');
    expect(boxes[1].textContent).toContain('2');
    // BLOCK-254 B-1：悬停必须能看到「仅屏显遮蔽，不是脱敏」的边界声明。
    expect(boxes[1].getAttribute('title')).toContain('不是脱敏');
  });

  it('BLOCK-238 — 绘制中的 draft 按所选形状预览', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const onCommit = vi.fn();
    const { getByTestId, rerender } = render(
      <AnnotationOverlay
        annotations={[]}
        page={null}
        drawing
        color="amber"
        kind="ellipse"
        onCommit={onCommit}
        label="批注层：图像"
      />,
    );
    const overlay = getByTestId('annotation-overlay');
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(overlay, { clientX: 120, clientY: 60 });
    expect(getByTestId('annotation-draft').dataset.kind).toBe('ellipse');

    rerender(
      <AnnotationOverlay
        annotations={[]}
        page={null}
        drawing
        color="amber"
        kind="arrow"
        onCommit={onCommit}
        label="批注层：图像"
      />,
    );
    expect(getByTestId('annotation-draft').dataset.kind).toBe('arrow');
  });

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
        kind="region"
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
        kind="region"
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
        kind="region"
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
        kind="region"
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
        kind="region"
        onCommit={() => undefined}
        onSelect={onSelect}
        label="批注层"
      />,
    );
    fireEvent.click(getAllByTestId('annotation-box')[0]);
    expect(onSelect).toHaveBeenCalledWith('ann-x');
  });

  it('BLOCK-270 — 画笔批注渲染为 SVG polyline（归一化点 → 0..100 viewBox）', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const { getByTestId } = render(
      <AnnotationOverlay
        annotations={[
          annotation({ annotationId: 'k-free', kind: 'freehand', rect: [], path: [[0.1, 0.2], [0.5, 0.6], [0.9, 0.3]] }),
        ]}
        page={null}
        drawing={false}
        color="amber"
        kind="region"
        onCommit={() => undefined}
        label="批注层：图像"
      />,
    );
    const stroke = getByTestId('annotation-freehand-stroke');
    // BLOCK-288 — 渲染面平滑：path d（二次中点），曲线不逐点连线
    expect(stroke.getAttribute('d')).toBe(
      'M 10,20 Q 50,60 70,45 L 90,30',
    );
    expect(stroke.getAttribute('data-annotation-id')).toBe('k-free');
  });

  it('BLOCK-270 — 画笔模式采点提交：pointer 序列 → onCommitPath 收抽稀后归一化路径', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const onCommit = vi.fn();
    const onCommitPath = vi.fn();
    const { getByTestId } = render(
      <AnnotationOverlay
        annotations={[]}
        page={null}
        drawing
        color="sky"
        kind="freehand"
        onCommit={onCommit}
        onCommitPath={onCommitPath}
        label="批注层：图像"
      />,
    );
    const overlay = getByTestId('annotation-overlay');
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(overlay, { clientX: 60, clientY: 50 });
    fireEvent.pointerMove(overlay, { clientX: 100, clientY: 90 });
    fireEvent.pointerUp(overlay, { clientX: 100, clientY: 90 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCommitPath).toHaveBeenCalledWith([
      [0.1, 0.1],
      [0.3, 0.5],
      [0.5, 0.9],
    ]);
  });

  it('BLOCK-288 — 触屏防误触：第二 pointerId 的移动不篡改当前笔画（手掌拒识）', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const onCommitPath = vi.fn();
    const { getByTestId } = render(
      <AnnotationOverlay
        annotations={[]}
        page={null}
        drawing
        color="sky"
        kind="freehand"
        onCommit={() => undefined}
        onCommitPath={onCommitPath}
        label="批注层：图像"
      />,
    );
    const overlay = getByTestId('annotation-overlay');
    fireEvent.pointerDown(overlay, { pointerId: 1, clientX: 20, clientY: 10 });
    // 手掌/第二指落屏（pointerId=2）——不得进当前笔画
    fireEvent.pointerMove(overlay, { pointerId: 2, clientX: 200, clientY: 300 });
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 100, clientY: 90 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 100, clientY: 90 });
    expect(onCommitPath).toHaveBeenCalledTimes(1);
    const path = onCommitPath.mock.calls[0][0] as [number, number][];
    // 掌点（clientX 200→clamp 1.0，clientY 300→clamp 1.0）不得出现在路径
    expect(path.some(([x, y]) => x >= 0.99 && y >= 0.99)).toBe(false);
    expect(path).toEqual([[0.1, 0.1], [0.5, 0.9]]);
  });

  it('BLOCK-270 — 画笔模式单点（<2 点）不提交', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const onCommitPath = vi.fn();
    const { getByTestId } = render(
      <AnnotationOverlay
        annotations={[]}
        page={null}
        drawing
        color="amber"
        kind="freehand"
        onCommit={() => undefined}
        onCommitPath={onCommitPath}
        label="批注层：图像"
      />,
    );
    const overlay = getByTestId('annotation-overlay');
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 10 });
    fireEvent.pointerUp(overlay, { clientX: 20, clientY: 10 });
    expect(onCommitPath).not.toHaveBeenCalled();
  });

  it('BLOCK-292 — pending 批注在保存前保持可见（矩形与画笔路径预览，取消后消失）', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const { getByTestId, queryByTestId, rerender } = render(
      <AnnotationOverlay
        annotations={[]}
        page={null}
        drawing={false}
        color="amber"
        kind="arrow"
        pendingRect={[0.1, 0.1, 0.5, 0.5]}
        onCommit={() => undefined}
        label="批注层：图像"
      />,
    );
    const preview = getByTestId('annotation-pending-rect');
    expect(preview.style.left).toBe('10.00%');
    expect(preview.style.width).toBe('50.00%');

    rerender(
      <AnnotationOverlay
        annotations={[]}
        page={null}
        drawing={false}
        color="amber"
        kind="freehand"
        pendingPath={[[0.1, 0.1], [0.5, 0.5], [0.9, 0.2]]}
        onCommit={() => undefined}
        label="批注层：图像"
      />,
    );
    expect(queryByTestId('annotation-pending-rect')).toBeNull();
    expect(getByTestId('annotation-pending-path').querySelector('path')?.getAttribute('d')).toContain('M 10,10');

    // 保存（pending 清空）后预览退场——批注转入 annotations 渲染面。
    rerender(
      <AnnotationOverlay
        annotations={[annotation({ annotationId: 'saved', kind: 'arrow', rect: [0.1, 0.1, 0.5, 0.5] })]}
        page={null}
        drawing={false}
        color="amber"
        kind="arrow"
        pendingRect={null}
        onCommit={() => undefined}
        label="批注层：图像"
      />,
    );
    expect(queryByTestId('annotation-pending-rect')).toBeNull();
    expect(queryByTestId('annotation-pending-path')).toBeNull();
    expect(getByTestId('annotation-box').dataset.annotationId).toBe('saved');
  });

  it('BLOCK-300 — 就地输入框锚在形状终点，Esc 取消 / blur 确认（允许不填）', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const onSubmitPending = vi.fn(() => Promise.resolve(true));
    const onCancelPending = vi.fn();
    const { getByTestId, queryByTestId, rerender } = render(
      <AnnotationOverlay
        annotations={[]}
        page={null}
        drawing={false}
        color="amber"
        kind="arrow"
        pendingRect={[0.1, 0.1, 0.4, 0.4]}
        pendingTextPoint={null}
        onSubmitPending={onSubmitPending}
        onCancelPending={onCancelPending}
        onCommit={() => undefined}
        label="批注层：图像"
      />,
    );
    // 锚点=拖拽终点（0.5, 0.5）→ 55%/72% clamp 内
    const composer = getByTestId('annotation-inline-composer');
    expect(composer.style.left).toBe('50%');
    expect(composer.style.top).toBe('50%');
    expect(getByTestId('annotation-inline-input').getAttribute('placeholder')).toContain('可不填');

    // Esc → 取消，不提交
    fireEvent.keyDown(getByTestId('annotation-inline-input'), { key: 'Escape' });
    expect(onCancelPending).toHaveBeenCalledTimes(1);
    expect(onSubmitPending).not.toHaveBeenCalled();

    // 重挂（取消后 pending 已清）→ blur 直接确认空串（「允许不填写」由会话层落默认文案）
    rerender(
      <AnnotationOverlay
        annotations={[]}
        page={null}
        drawing={false}
        color="amber"
        kind="freehand"
        pendingPath={[[0.1, 0.1], [0.5, 0.5], [0.9, 0.2]]}
        pendingTextPoint={null}
        onSubmitPending={onSubmitPending}
        onCancelPending={onCancelPending}
        onCommit={() => undefined}
        label="批注层：图像"
      />,
    );
    expect(queryByTestId('annotation-pending-rect')).toBeNull();
    // 锚点=路径尾点（0.9, 0.2）→ left clamp 到 55%
    expect(getByTestId('annotation-inline-composer').style.left).toBe('55%');
    fireEvent.blur(getByTestId('annotation-inline-input'));
    expect(onSubmitPending).toHaveBeenCalledWith('', undefined);
  });

  it('BLOCK-300 — text 工具点击图面即上报点击点（不采点不拖拽）', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const onCommitClick = vi.fn();
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <AnnotationOverlay
        annotations={[]}
        page={null}
        drawing
        color="amber"
        kind="text"
        onCommitClick={onCommitClick}
        onCommit={onCommit}
        label="批注层：图像"
      />,
    );
    const overlay = getByTestId('annotation-overlay');
    fireEvent.pointerDown(overlay, { clientX: 60, clientY: 30 });
    fireEvent.pointerUp(overlay, { clientX: 60, clientY: 30 });
    expect(onCommitClick).toHaveBeenCalledWith([0.3, 0.3]);
    expect(onCommit).not.toHaveBeenCalled();
    expect(getByTestId('annotation-overlay').getAttribute('data-drawing')).toBe('true');
  });

  it('BLOCK-303 — 箭头真形态：拖拽起点→终点提交两点，绘制中即最终形态（SVG 线+头）', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    const onCommitArrow = vi.fn();
    const onCommit = vi.fn();
    const { getByTestId, queryByTestId, getAllByTestId, rerender } = render(
      <AnnotationOverlay
        annotations={[]}
        page={null}
        drawing
        color="amber"
        kind="arrow"
        onCommit={onCommit}
        onCommitArrow={onCommitArrow}
        label="批注层：图像"
      />,
    );
    const overlay = getByTestId('annotation-overlay');
    // 拖拽中：draft SVG 在场（线+头），无外部虚线框
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(overlay, { clientX: 100, clientY: 30 });
    expect(getByTestId('annotation-arrow-draft')).toBeTruthy();
    expect(queryByTestId('annotation-draft')).toBeNull();
    fireEvent.pointerUp(overlay, { clientX: 100, clientY: 30 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCommitArrow).toHaveBeenCalledWith([0.05, 0.1], [0.5, 0.3]);
    expect(queryByTestId('annotation-arrow-draft')).toBeNull();

    // 误触（微动 <1%）不成箭头
    fireEvent.pointerDown(overlay, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(overlay, { clientX: 51, clientY: 50.5 });
    expect(onCommitArrow).toHaveBeenCalledTimes(1);

    // 待填预览：两点 SVG 保持可见（BLOCK-292「批注不要隐藏」）
    rerender(
      <AnnotationOverlay
        annotations={[]}
        page={null}
        drawing={false}
        color="sky"
        kind="arrow"
        pendingArrow={[[0.2, 0.2], [0.8, 0.7]]}
        onSubmitPending={() => Promise.resolve(true)}
        onCommit={() => undefined}
        onCommitArrow={onCommitArrow}
        label="批注层：图像"
      />,
    );
    expect(getByTestId('annotation-pending-arrow')).toBeTruthy();
    // 就地框锚在箭头终点 (0.8, 0.7) → left clamp 到 55%
    expect(getByTestId('annotation-inline-composer').style.left).toBe('55%');

    // 保存后：两点 path → arrow-stroke（line+polygon）；rect-only 旧数据仍走 box 对角线
    rerender(
      <AnnotationOverlay
        annotations={[
          annotation({ annotationId: 'a-new', kind: 'arrow', rect: [], path: [[0.2, 0.2], [0.8, 0.7]] }),
          annotation({ annotationId: 'a-legacy', kind: 'arrow', path: [] }),
        ]}
        page={null}
        drawing={false}
        color="amber"
        kind="arrow"
        pendingArrow={null}
        onCommit={() => undefined}
        onCommitArrow={onCommitArrow}
        label="批注层：图像"
      />,
    );
    expect(queryByTestId('annotation-pending-arrow')).toBeNull();
    const stroke = getByTestId('annotation-arrow-stroke');
    expect(stroke.querySelector('line')).toBeTruthy();
    expect(stroke.querySelector('polygon')).toBeTruthy();
    expect(getAllByTestId('annotation-box').map((el) => el.dataset.kind)).toEqual(['arrow']);
  });
});
