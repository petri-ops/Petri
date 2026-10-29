import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SketchSpecDialog } from './SketchSpecDialog';
import { sketchToTaskSpec, type SketchTaskSpecResult } from '@/lib/sketchSpecClient';
import { dispatchPetriEvent, petriEvents } from '@/lib/events';

vi.mock('@/lib/sketchSpecClient', () => ({ sketchToTaskSpec: vi.fn() }));
vi.mock('@/lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events')>();
  return { ...actual, dispatchPetriEvent: vi.fn() };
});

const sketchMock = vi.mocked(sketchToTaskSpec);
const dispatchMock = vi.mocked(dispatchPetriEvent);

const result: SketchTaskSpecResult = {
  ok: true,
  optimizedPrompt: '设计一个 120×80×40mm 的 ABS 外壳',
  taskSpec: {
    version: 'task-spec/v1',
    taskType: 'modeling',
    goal: '设计带 USB 口的外壳',
    deliverables: ['SceneSpec 与 GLB'],
    constraints: [],
    assumptions: ['材料为 ABS'],
    acceptance: ['端口尺寸一致'],
    missingInfo: ['壁厚未给出'],
  },
  changeSummary: [],
  model: 'mock-vl',
  usage: null,
};

function uploadSketch(container: HTMLElement): void {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'sketch.png', { type: 'image/png' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('SketchSpecDialog (NEXT-04B P3-1)', () => {
  beforeEach(() => {
    sketchMock.mockReset();
    dispatchMock.mockClear();
  });
  afterEach(cleanup);

  it('草图 + 已知尺寸生成 modeling TaskSpec，缺失信息可见并加入对话', async () => {
    sketchMock.mockResolvedValue(result);
    const { container } = render(<SketchSpecDialog onClose={() => {}} />);
    uploadSketch(container);
    expect(await screen.findByText('sketch.png')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/例如 120 × 80 × 40 mm/), { target: { value: '120 × 80 × 40 mm' } });
    fireEvent.click(screen.getByRole('button', { name: '生成 TaskSpec' }));
    await waitFor(() => expect(sketchMock).toHaveBeenCalledTimes(1));
    expect(sketchMock.mock.calls[0][0].dimensions).toContain('120');
    expect(await screen.findByText('设计带 USB 口的外壳')).toBeTruthy();
    expect(screen.getByText('壁厚未给出')).toBeTruthy();
    expect(screen.getByText('task-spec/v1 · modeling')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '加入对话' }));
    const detail = dispatchMock.mock.calls.at(-1)?.[1] as { prompt?: string; compose?: boolean } | undefined;
    expect(detail?.compose).toBe(true);
    expect(detail?.prompt).toContain('壁厚未给出');
    expect(dispatchMock.mock.calls.at(-1)?.[0]).toBe(petriEvents.copilotAsk);
  });

  it('视觉不可用时如实报错，不伪造 TaskSpec', async () => {
    sketchMock.mockRejectedValue(new Error('no_api_key'));
    const { container } = render(<SketchSpecDialog onClose={() => {}} />);
    uploadSketch(container);
    await screen.findByText('sketch.png');
    fireEvent.click(screen.getByRole('button', { name: '生成 TaskSpec' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('no_api_key');
    expect(screen.queryByText('task-spec/v1 · modeling')).toBeNull();
  });

  it('Escape 关闭对话框', () => {
    const onClose = vi.fn();
    render(<SketchSpecDialog onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
