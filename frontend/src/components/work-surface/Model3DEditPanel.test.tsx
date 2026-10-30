import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Model3DEditPanel } from './Model3DEditPanel';
import {
  applySceneOperations,
  diffSceneSpecs,
  listSceneRevisions,
  readSceneFile,
  restoreSceneRevision,
} from '@/lib/sceneEditClient';
import type { Scene3DSpec } from '@/lib/scene3d';

vi.mock('@/lib/sceneEditClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sceneEditClient')>();
  return {
    ...actual,
    readSceneFile: vi.fn(),
    listSceneRevisions: vi.fn(),
    diffSceneSpecs: vi.fn(),
    applySceneOperations: vi.fn(),
    restoreSceneRevision: vi.fn(),
  };
});

const readMock = vi.mocked(readSceneFile);
const revisionsMock = vi.mocked(listSceneRevisions);
const diffMock = vi.mocked(diffSceneSpecs);
const applyMock = vi.mocked(applySceneOperations);
const restoreMock = vi.mocked(restoreSceneRevision);

const scene: Scene3DSpec = {
  version: 'scene3d/v1',
  units: 'mm',
  coordinateSystem: 'z-up-right-handed',
  parameters: { width: 120, height: 40 },
  nodes: [{ id: 'box', type: 'box', dimensions: { width: 120, height: 40, depth: 80 } }],
};

const diff = {
  beforeHash: 'a'.repeat(64),
  afterHash: 'b'.repeat(64),
  parameters: [{ name: 'width', before: 120, after: 130, status: 'changed' as const }],
  nodes: [],
  constraints: { added: [], removed: [] },
  changed: true,
};

describe('Model3DEditPanel (NEXT-05)', () => {
  beforeEach(() => {
    readMock.mockReset().mockResolvedValue({ scene, hash: 'a'.repeat(64) });
    revisionsMock.mockReset().mockResolvedValue([]);
    diffMock.mockReset().mockResolvedValue(diff);
    applyMock.mockReset().mockResolvedValue({
      ok: true,
      path: 'model3d/scene.scene3d.json',
      beforeHash: 'a'.repeat(64),
      afterHash: 'b'.repeat(64),
      revision: { revisionId: 'rev-000001', ordinal: 1, hash: 'a'.repeat(64), reason: 'user_parameter_edit', createdAt: '2026-10-30T00:00:00.000Z' },
      diff,
      scene,
    });
    restoreMock.mockReset().mockResolvedValue({ beforeHash: 'b'.repeat(64), afterHash: 'a'.repeat(64), diff });
  });
  afterEach(cleanup);

  it('预览参数 diff 后应用并刷新修订历史', async () => {
    const onSceneUpdated = vi.fn();
    render(<Model3DEditPanel projectId="p_1" scene={scene} onSceneUpdated={onSceneUpdated} />);
    const widthInput = await screen.findByDisplayValue('120');
    fireEvent.change(widthInput, { target: { value: '130' } });
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    await waitFor(() => expect(diffMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('model3d-edit-diff')).toBeTruthy();
    expect(screen.getByText('参数 width：120 → 130')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '应用参数' }));
    await waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));
    expect(applyMock.mock.calls[0][0]).toMatchObject({
      projectId: 'p_1',
      path: 'model3d/scene.scene3d.json',
      scene,
      expectedHash: 'a'.repeat(64),
      operations: [{ op: 'set_parameter', name: 'width', value: 130 }],
    });
    expect(onSceneUpdated).toHaveBeenCalledWith(scene);
    expect(await screen.findByText(/已写入 model3d\/scene.scene3d.json/)).toBeTruthy();
  });

  it('显示修订历史并恢复', async () => {
    revisionsMock.mockResolvedValue([
      { revisionId: 'rev-000001', ordinal: 1, hash: 'a'.repeat(64), reason: 'user_parameter_edit', createdAt: '2026-10-30T00:00:00.000Z' },
    ]);
    const onSceneUpdated = vi.fn();
    render(<Model3DEditPanel projectId="p_1" scene={scene} onSceneUpdated={onSceneUpdated} />);
    expect(await screen.findByText('rev-000001')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(restoreMock).toHaveBeenCalledWith({
      projectId: 'p_1',
      path: 'model3d/scene.scene3d.json',
      revisionId: 'rev-000001',
    }));
    expect(await screen.findByText(/已恢复 rev-000001/)).toBeTruthy();
  });

  it('无项目时明确禁用编辑边界', async () => {
    render(<Model3DEditPanel projectId={null} scene={scene} onSceneUpdated={() => {}} />);
    expect((await screen.findAllByText('需要项目工作区')).length > 0).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '应用参数' }));
    expect((await screen.findByRole('alert')).textContent).toContain('需要已打开的项目工作区');
  });
});
