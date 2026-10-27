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
    entryId: null,
    artifactName: 'volcano.png',
    kind: 'region',
    page: 2,
    rect: [0.1, 0.1, 0.2, 0.2],
    path: [],
    anchor: null,
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
    canUndo: false,
    onUndo: vi.fn(),
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it('BLOCK-254 — 绘制态含文字/马赛克两档，选择回传 kind 且输入语义随形状变化', () => {
    const onKindChange = vi.fn();
    const drawing = render(
      <AnnotationBar {...props({ drawing: true, kind: 'region', onKindChange })} />,
    );
    expect(drawing.getByTestId('annotation-kind-text').textContent).toContain('文本');
    expect(drawing.getByTestId('annotation-kind-mosaic').textContent).toContain('马赛克');
    fireEvent.click(drawing.getByTestId('annotation-kind-text'));
    expect(onKindChange).toHaveBeenCalledWith('text');
    drawing.unmount();

    const textPending = render(
      <AnnotationBar {...props({ drawing: true, kind: 'text', pendingRect: true })} />,
    );
    expect((textPending.getByTestId('annotation-comment-input') as HTMLInputElement).placeholder)
      .toContain('要显示在框内的文字');
    textPending.unmount();

    const mosaicPending = render(
      <AnnotationBar {...props({ drawing: true, kind: 'mosaic', pendingRect: true })} />,
    );
    // 马赛克不是脱敏：输入说明必须显式声明「仅屏显遮蔽 / 不改原图」。
    expect((mosaicPending.getByTestId('annotation-comment-input') as HTMLInputElement).placeholder)
      .toContain('仅屏显遮蔽');
  });

  it('BLOCK-254 P5 — 文本面模式：不渲染绘制开关，列表按行号显示且保留撤销/加入任务', () => {
    const { getByTestId, queryByTestId } = render(
      <AnnotationBar
        {...props({
          mode: 'text',
          canUndo: true,
          undoLabel: '撤销刚才的创建',
          annotations: [annotation({
            kind: 'text-selection',
            page: null,
            rect: [],
            anchor: {
              kind: 'text-range',
              startLine: 12,
              endLine: 12,
              startColumn: null,
              endColumn: null,
              quote: '结论：差异基因数目偏低',
              language: 'md',
            },
          })],
        })}
      />,
    );

    expect(getByTestId('annotation-bar').dataset.mode).toBe('text');
    // 文本面没有「拖拽画框」这回事：绘制开关与形状档都不该出现。
    expect(queryByTestId('annotation-toggle')).toBeNull();
    expect(queryByTestId('annotation-kind-region')).toBeNull();
    const item = getByTestId('annotation-item').textContent || '';
    expect(item).toContain('文本批注');
    expect(item).toContain('第 12 行');
    expect(getByTestId('annotation-undo')).toBeTruthy();
    expect(getByTestId('annotation-add-to-task')).toBeTruthy();
  });

  it('BLOCK-254 B-2 — 撤销按钮：栈空不渲染，栈非空带下一步说明并回传', () => {
    const onUndo = vi.fn();
    const empty = render(<AnnotationBar {...props({ canUndo: false, onUndo })} />);
    expect(empty.queryByTestId('annotation-undo')).toBeNull();
    empty.unmount();

    const filled = render(
      <AnnotationBar {...props({ canUndo: true, undoLabel: '撤销刚才的删除（将按原内容重建为新条目）', onUndo })} />,
    );
    const undo = filled.getByTestId('annotation-undo');
    expect(undo.textContent).toContain('撤销');
    expect(undo.getAttribute('title')).toContain('重建为新条目');
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('BLOCK-254 B-1 — 马赛克提示按能力分支：支持模糊 vs 不透明降级', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const supported = render(<AnnotationBar {...props({ drawing: true, kind: 'mosaic' })} />);
    const okHint = supported.getByTestId('annotation-hint');
    expect(okHint.textContent).toContain('仅屏显遮蔽');
    expect(okHint.textContent).toContain('不是脱敏');
    expect(okHint.dataset.mosaicFallback).toBe('false');
    supported.unmount();

    vi.stubGlobal('CSS', { supports: () => false });
    const degraded = render(<AnnotationBar {...props({ drawing: true, kind: 'mosaic' })} />);
    const fallbackHint = degraded.getByTestId('annotation-hint');
    expect(fallbackHint.textContent).toContain('不透明色块');
    expect(fallbackHint.textContent).toContain('不是脱敏');
    expect(fallbackHint.dataset.mosaicFallback).toBe('true');
  });

  it('BLOCK-254 — 列表标出文字/马赛克形状', () => {
    const { getAllByTestId } = render(
      <AnnotationBar
        {...props({
          annotations: [annotation({ annotationId: 'a-text', kind: 'text' }), annotation({ annotationId: 'a-mosaic', kind: 'mosaic' })],
          drawing: true,
        })}
      />,
    );
    const items = getAllByTestId('annotation-item').map((el) => el.textContent || '');
    expect(items[0]).toContain('文本');
    expect(items[1]).toContain('马赛克');
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
