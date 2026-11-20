import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatArtifactCard } from './ChatArtifactCard';

vi.mock('@/lib/events', () => ({
  petriEvents: { projectOpenArtifact: 'petri:project-open-artifact', model3dOpen: 'petri:model3d-open' },
  dispatchPetriEvent: vi.fn(),
}));
vi.mock('@/components/work-surface/Model3DScene', () => ({
  Model3DScene: () => <div data-testid="model3d-scene-stub" />,
}));

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

describe('UI-713 结果卡轻量态', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(statusPayload), { status: 200 }))));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('轻量态默认只显示摘要与打开详情，具体产物点击后才出现', async () => {
    render(<ChatArtifactCard toolJobId="tj_light" expanded projectId="p1" lightweight />);
    const summary = await screen.findByTestId('chat-artifact-summary');
    expect(summary.textContent).toContain('已生成 2 个产物');
    expect(screen.queryByTestId('chat-artifact-3d-actions')).toBeNull();
    expect(screen.queryByTestId('model3d-scene-stub')).toBeNull();

    fireEvent.click(screen.getByTestId('chat-artifact-open-detail'));
    expect(await screen.findByTestId('chat-artifact-3d-actions')).toBeTruthy();
  });
});
