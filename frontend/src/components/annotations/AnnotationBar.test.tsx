import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { AnnotationBar, type AnnotationBarProps } from './AnnotationBar';
import type { ArtifactAnnotation } from '@/lib/annotations';

/** BLOCK-219 Q6 — 批注工具条：能力门、评论提交、列表删除、加入任务。 */

function annotation(overrides: Partial<ArtifactAnnotation> = {}): ArtifactAnnotation {
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
    page: 2,
    rect: [0.1, 0.1, 0.2, 0.2],
    comment: '离群点需要复核',
    color: 'amber',
    author: 'user',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

function props(overrides: Partial<AnnotationBarProps> = {}): AnnotationBarProps {
  return {
    annotations: [],
    loading: false,
    error: '',
    limit: 200,
    drawing: false,
    color: 'amber',
    kind: 'region',
    canAnnotate: true,
    pendingRect: false,
    onToggleDrawing: vi.fn(),
    onColorChange: vi.fn(),
    onKindChange: vi.fn(),
    onSubmitComment: vi.fn(() => Promise.resolve(true)),
    onCancelPending: vi.fn(),
    onRemove: vi.fn(),
    onAddToTask: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe('AnnotationBar', () => {
  it('不支持批注的面只显示原因，不渲染工具按钮', () => {
    const { getByTestId, queryByTestId } = render(
      <AnnotationBar {...props({ canAnnotate: false, cannotAnnotateReason: '该格式暂不支持批注' })} />,
    );
    expect(getByTestId('annotation-bar').dataset.annotatable).toBe('false');
    expect(getByTestId('annotation-unavailable').textContent).toContain('该格式暂不支持批注');
    expect(queryByTestId('annotation-toggle')).toBeNull();
    expect(queryByTestId('annotation-add-to-task')).toBeNull();
  });

  it('切换批注模式并显示颜色档位', () => {
    const onToggleDrawing = vi.fn();
    const onColorChange = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <AnnotationBar {...props({ onToggleDrawing, onColorChange })} />,
    );
    expect(queryByTestId('annotation-swatch-amber')).toBeNull();
    fireEvent.click(getByTestId('annotation-toggle'));
    expect(onToggleDrawing).toHaveBeenCalledTimes(1);

    const drawing = render(
      <AnnotationBar {...props({ drawing: true, onColorChange })} />,
    );
    fireEvent.click(drawing.getByTestId('annotation-swatch-rose'));
    expect(onColorChange).toHaveBeenCalledWith('rose');
  });

  it('BLOCK-238 — 绘制态提供三种形状，选择回传 kind', () => {
    const onKindChange = vi.fn();
    const idle = render(<AnnotationBar {...props({ onKindChange })} />);
    expect(idle.queryByTestId('annotation-kind-ellipse')).toBeNull();
    idle.unmount();

    const drawing = render(
      <AnnotationBar {...props({ drawing: true, kind: 'region', onKindChange })} />,
    );
    expect(drawing.getByTestId('annotation-kind-region').dataset.active).toBe('true');
    fireEvent.click(drawing.getByTestId('annotation-kind-arrow'));
    expect(onKindChange).toHaveBeenCalledWith('arrow');
  });

  it('BLOCK-238 — 列表标出批注形状', () => {
    const { getByTestId } = render(
      <AnnotationBar {...props({ annotations: [annotation({ kind: 'ellipse' })], drawing: true })} />,
    );
    expect(getByTestId('annotation-item').textContent).toContain('椭圆');
  });

  it('待填评论时提交文本，空文本不能提交', async () => {
    const onSubmitComment = vi.fn(() => Promise.resolve(true));
    const { getByTestId } = render(
      <AnnotationBar {...props({ drawing: true, pendingRect: true, onSubmitComment })} />,
    );
    const save = getByTestId('annotation-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(getByTestId('annotation-comment-input'), { target: { value: '  这个点异常  ' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(onSubmitComment).toHaveBeenCalledWith('这个点异常'));
  });

  it('列表展示锚点与评论，删除回传 id', () => {
    const onRemove = vi.fn();
    const { getByTestId } = render(
      <AnnotationBar {...props({ annotations: [annotation()], drawing: true, onRemove })} />,
    );
    expect(getByTestId('annotation-item').textContent).toContain('第 2 页');
    expect(getByTestId('annotation-item').textContent).toContain('离群点需要复核');
    fireEvent.click(getByTestId('annotation-remove'));
    expect(onRemove).toHaveBeenCalledWith('ann-1');
  });

  it('无批注时「加入任务」禁用；有批注时触发回调', () => {
    const onAddToTask = vi.fn();
    const empty = render(<AnnotationBar {...props({ onAddToTask })} />);
    expect((empty.getByTestId('annotation-add-to-task') as HTMLButtonElement).disabled).toBe(true);
    empty.unmount();

    const filled = render(
      <AnnotationBar {...props({ annotations: [annotation()], onAddToTask })} />,
    );
    fireEvent.click(filled.getByTestId('annotation-add-to-task'));
    expect(onAddToTask).toHaveBeenCalledTimes(1);
  });

  it('错误如实展示（不吞服务端拒绝）', () => {
    const { getByTestId } = render(
      <AnnotationBar {...props({ error: '同一产物/文件最多 200 条批注' })} />,
    );
    expect(getByTestId('annotation-error').textContent).toContain('最多 200 条');
  });
});
