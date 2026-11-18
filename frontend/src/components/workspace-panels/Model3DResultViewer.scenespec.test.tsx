/**
 * BLOCK-463 — Model3DResultViewer SceneSpec 证据面板契约（HK-01 红绿先行）。
 *
 * 3D 造物域管线（sand3d → GLB → SceneSpec(+joints) → three-live verifierResults）
 * 的证据链上屏：配对 scene snapshot（沿 UI-654 sceneSnapshotFromUrl 既有 pairing）在册时
 * 呈现 joints 清单 / provenance digest / verifierResults verdict——证据自证（charter §1.5）；
 * 无配对 / 取数失败 → 零行为变化（不冒充）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const dispatchSpy = vi.hoisted(() => vi.fn());

vi.mock('@/lib/events', () => ({
  petriEvents: { model3dOpen: 'petri:model3d-open' },
  dispatchPetriEvent: dispatchSpy,
}));

vi.mock('@/components/work-surface/Model3DScene', () => ({
  Model3DScene: () => <div data-testid="model3d-scene-stub" />,
}));

import Model3DResultViewer from './Model3DResultViewer';

const RUN_URL = 'http://local.test/artifact?path=model3d/runs/r1/model.glb';
const SCENE_PATH = 'model3d/runs/r1/scene.json';

function sceneSpec(overrides: Record<string, unknown> = {}) {
  return {
    version: 'scene3d/v1',
    joints: [
      { id: 'hinge_arm', kind: 'revolute', axis: [0, 0, 1], range: { min: 0, max: 100 } },
      { id: 'drawer_slide', kind: 'prismatic', axis: [0, -1, 0], range: { min: 0, max: 80 } },
    ],
    metadata: {
      provenance: {
        producer: 'sand3d',
        producerVersion: '1.6.3',
        programDigest: 'fee4e403d8206135',
        glbSha256: '2e803be355e92866d276357311fba73d60f7092b5533764771b6e4d3bbf4434e',
        verifierResults: [
          { tool: 'three-live@1.4.0', verdict: 'pass', diagnosticsRef: 'verify/diagnostics.json', digest: '8a7500d4', at: '2026-11-18T00:00:00Z' },
        ],
      },
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SceneSpec 证据面板（BLOCK-463）', () => {
  it('配对 scene.json → 呈现 joints 数 / 关节 kind / provenance digest / verifier verdict', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(sceneSpec()), { status: 200 }))));
    render(<Model3DResultViewer url={RUN_URL} name="probe.glb" artifactId="a1" revisionId={null} projectId="p1" />);
    await waitFor(() => expect(screen.getByTestId('scenespec-panel')).toBeTruthy());
    expect(screen.getByText(/2 个关节/)).toBeTruthy();
    expect(screen.getByText(/hinge_arm/)).toBeTruthy();
    expect(screen.getByText(/revolute/)).toBeTruthy();
    expect(screen.getByText(/sand3d/)).toBeTruthy();
    expect(screen.getByText(/fee4e403d8206135/)).toBeTruthy();
    expect(screen.getByText(/three-live@1\.4\.0/)).toBeTruthy();
    expect(screen.getByText(/pass/)).toBeTruthy();
  });

  it('无 runs 配对（普通 url）→ 零行为变化（不发 fetch、不渲染面板）', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<Model3DResultViewer url="http://local.test/a?path=other/thing.glb" name="x.glb" artifactId="a2" revisionId={null} />);
    expect(screen.queryByTestId('scenespec-panel')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('scene.json 取数失败 → 面板缺席 + 不炸穿 viewer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net down')));
    render(<Model3DResultViewer url={RUN_URL} name="probe.glb" artifactId="a3" revisionId={null} />);
    await waitFor(() => expect(screen.getByTestId('model3d-result-viewer-surface')).toBeTruthy());
    expect(screen.queryByTestId('scenespec-panel')).toBeNull();
  });
});
