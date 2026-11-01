import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatArtifactCard } from './ChatArtifactCard';

const { dispatchPetriEvent } = vi.hoisted(() => ({ dispatchPetriEvent: vi.fn() }));

vi.mock('@/lib/events', () => ({
  petriEvents: {
    projectOpenArtifact: 'petri:project-open-artifact',
    model3dOpen: 'petri:model3d-open',
  },
  dispatchPetriEvent,
}));

function stubStatus(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))));
}

const statusPayload = {
  ok: true,
  result: {
    outDir: 'model3d/runs/run_1',
    artifacts: [
      { name: 'front.png', path: 'model3d/runs/run_1/front.png', url: '/api/workspaces/p1/file?path=front.png' },
      { name: 'scene.glb', path: 'model3d/runs/run_1/scene.glb', url: '/api/workspaces/p1/file?path=scene.glb' },
    ],
  },
};

describe('BLOCK-322 UI-653 产物卡落地动作', () => {
  beforeEach(() => {
    dispatchPetriEvent.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('3D 产物提供「在结果中查看」与「在 3D 工作台打开」，分别派发结果/工作面事件', async () => {
    stubStatus(statusPayload);
    render(<ChatArtifactCard toolJobId="tj_1" expanded projectId="p1" />);

    const row = await screen.findByTestId('chat-artifact-3d-actions');
    fireEvent.click(within(row).getByRole('button', { name: '在结果中查看' }));
    expect(dispatchPetriEvent).toHaveBeenCalledWith('petri:project-open-artifact', {
      jobId: 'tj_1',
      artifactName: 'scene.glb',
      projectId: 'p1',
      switchToResult: true,
    });

    fireEvent.click(within(row).getByRole('button', { name: '在 3D 工作台打开' }));
    expect(dispatchPetriEvent).toHaveBeenCalledWith('petri:model3d-open', {
      projectId: 'p1',
      scenePath: 'model3d/runs/run_1/scene.json',
      jobId: 'tj_1',
      label: 'scene.glb',
    });
  });

  it('没有项目工作区时工作台按钮禁用（不猜场景来源）', async () => {
    stubStatus(statusPayload);
    render(<ChatArtifactCard toolJobId="tj_1" expanded projectId={null} />);

    const row = await screen.findByTestId('chat-artifact-3d-actions');
    expect(within(row).getByRole('button', { name: '在 3D 工作台打开' }).hasAttribute('disabled')).toBe(true);
  });

  it('结果里没有 outDir 时从产物路径推导快照目录', async () => {
    stubStatus({
      ok: true,
      result: {
        artifacts: [{ name: 'scene.glb', path: 'model3d/runs/run_2/scene.glb', url: '/api/workspaces/p1/file?path=scene.glb' }],
      },
    });
    render(<ChatArtifactCard toolJobId="tj_2" expanded projectId="p1" />);

    const row = await screen.findByTestId('chat-artifact-3d-actions');
    fireEvent.click(within(row).getByRole('button', { name: '在 3D 工作台打开' }));
    expect(dispatchPetriEvent).toHaveBeenCalledWith('petri:model3d-open', expect.objectContaining({
      scenePath: 'model3d/runs/run_2/scene.json',
    }));
  });
});
