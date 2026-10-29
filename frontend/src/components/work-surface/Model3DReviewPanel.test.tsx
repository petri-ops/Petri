import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Model3DReviewPanel } from './Model3DReviewPanel';
import { reviewModel3D, type Model3DReviewResult } from '@/lib/model3dClient';
import { createAnnotation } from '@/lib/annotation-client';
import { dispatchPetriEvent, petriEvents } from '@/lib/events';
import type { Scene3DSpec } from '@/lib/scene3d';

vi.mock('@/lib/model3dClient', () => ({ reviewModel3D: vi.fn() }));
vi.mock('@/lib/annotation-client', () => ({ createAnnotation: vi.fn() }));
vi.mock('@/lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events')>();
  return { ...actual, dispatchPetriEvent: vi.fn() };
});

const reviewMock = vi.mocked(reviewModel3D);
const annotationMock = vi.mocked(createAnnotation);
const dispatchMock = vi.mocked(dispatchPetriEvent);

const scene: Scene3DSpec = {
  version: 'scene3d/v1',
  units: 'mm',
  coordinateSystem: 'z-up-right-handed',
  parameters: { width: 120 },
  nodes: [{ id: 'enclosure', type: 'box', dimensions: { width: 'width', height: 40, depth: 80 } }],
};

function result(overrides: Partial<Model3DReviewResult['vision']> = {}): Model3DReviewResult {
  return {
    ok: true,
    schema: 'model3d-review/v1',
    sceneHash: 'a'.repeat(64),
    provider: { name: 'blender', version: 'Blender 4.5.10 LTS' },
    render: {
      outDir: 'model3d/runs/m3d-test',
      report: {
        ok: true,
        renders: {
          front: 'model3d/runs/m3d-test/front.png',
          iso: 'model3d/runs/m3d-test/iso.png',
        },
        exports: {},
        mesh: { objects: 2, vertices: 72, triangles: 136, nonManifoldEdges: 0, watertight: true, volumesMm3: { enclosure: 384000 } },
      },
      outputs: [],
    },
    vision: {
      status: 'ready',
      model: 'vision-model',
      parseStatus: 'structured',
      views: [
        { view: 'front', observations: ['正面开孔可见'], suspectedIssues: ['开孔边缘偏薄'], uncertain: [] },
        { view: 'iso', observations: ['等轴视图可见端口'], suspectedIssues: [], uncertain: [] },
      ],
      ...overrides,
    },
  };
}

describe('Model3DReviewPanel (NEXT-04B)', () => {
  beforeEach(() => {
    reviewMock.mockReset();
    annotationMock.mockReset();
    dispatchMock.mockClear();
  });
  afterEach(cleanup);

  it('渲染多视图并把疑似问题默认选中后加入对话', async () => {
    reviewMock.mockResolvedValue(result());
    render(<Model3DReviewPanel projectId="p_1" scene={scene} selectedNodeId="enclosure" viewAngle="front" onClose={() => {}} />);
    expect(await screen.findByText('开孔边缘偏薄')).toBeTruthy();
    expect(screen.getByAltText('前视图渲染')).toBeTruthy();
    expect(screen.getByAltText('等轴视图渲染')).toBeTruthy();
    expect(screen.queryByAltText('顶视图渲染')).toBeNull();
    expect(screen.getByTestId('model3d-review-geometry').textContent).toContain('水密');
    fireEvent.click(screen.getByRole('button', { name: '加入对话（1）' }));
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const [name, detail] = dispatchMock.mock.calls[0];
    expect(name).toBe(petriEvents.copilotAsk);
    expect(detail).toMatchObject({ compose: true });
    expect(String(detail && 'prompt' in detail ? detail.prompt : '')).toContain('model3d/runs/m3d-test/front.png');
    expect(String(detail && 'prompt' in detail ? detail.prompt : '')).toContain('开孔边缘偏薄');
    expect(String(detail && 'prompt' in detail ? detail.prompt : '')).toContain('nodeId=enclosure');
    expect(String(detail && 'prompt' in detail ? detail.prompt : '')).toContain('viewCamera=front');
    expect(await screen.findByText('已加入输入框')).toBeTruthy();
  });

  it('保存批注并引用：批注带 sceneRevision/nodeId/viewCamera，Composer 带 annotationId', async () => {
    reviewMock.mockResolvedValue(result());
    annotationMock.mockResolvedValue({
      annotation: { annotationId: 'ann_1' },
      count: 1,
    } as Awaited<ReturnType<typeof createAnnotation>>);
    render(<Model3DReviewPanel projectId="p_1" scene={scene} selectedNodeId="enclosure" viewAngle="front" onClose={() => {}} />);
    const button = await screen.findByRole('button', { name: '保存批注并引用' });
    fireEvent.click(button);
    await screen.findByRole('button', { name: '已保存批注并加入' });
    expect(annotationMock).toHaveBeenCalledTimes(1);
    const input = annotationMock.mock.calls[0][0];
    expect(input.surface).toBe('workspace-file');
    expect(input.filePath).toBe('model3d/runs/m3d-test/front.png');
    expect(input.rect).toEqual([0, 0, 1, 1]);
    expect(String(input.comment)).toContain('"nodeId":"enclosure"');
    expect(String(input.comment)).toContain(`"sceneRevision":"${'a'.repeat(64)}"`);
    const lastDetail = dispatchMock.mock.calls.at(-1)?.[1] as { prompt?: string } | undefined;
    expect(lastDetail?.prompt).toContain('annotationId=ann_1');
    expect(lastDetail?.prompt).toContain('filePath=model3d/runs/m3d-test/front.png');
  });

  it('视觉不可用时如实降级但仍保留渲染事实', async () => {
    reviewMock.mockResolvedValue(result({ status: 'unavailable', reason: 'not_configured', views: [], parseStatus: undefined }));
    render(<Model3DReviewPanel projectId="p_1" scene={scene} onClose={() => {}} />);
    const warning = await screen.findByTestId('model3d-review-vision-unavailable');
    expect(warning.textContent).toContain('not_configured');
    expect(screen.getByAltText('前视图渲染')).toBeTruthy();
    const addButton = screen.getByRole<HTMLButtonElement>('button', { name: '加入对话（0）' });
    expect(addButton.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '引用渲染视图' }));
    const [, detail] = dispatchMock.mock.calls.at(-1) || [];
    expect(detail).toMatchObject({ compose: true });
    expect(String(detail && 'prompt' in detail ? detail.prompt : '')).toContain('model3d/runs/m3d-test/iso.png');
  });

  it('缺少项目或 SceneSpec 时给出诚实边界', async () => {
    render(<Model3DReviewPanel projectId={null} scene={null} onClose={() => {}} />);
    expect((await screen.findByRole('alert')).textContent).toContain('需要已打开的项目与 SceneSpec');
    expect(reviewMock).not.toHaveBeenCalled();
  });
});
