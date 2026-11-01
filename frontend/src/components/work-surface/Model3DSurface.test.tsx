/**
 * UI-654 — 3D 工作面「不再手动导入才能预览」契约：
 * 1. 无外部请求时自动恢复：上次打开 → 项目 model3d/ 下最新 SceneSpec；
 * 2. 外部请求（文件预览/结果快照）按路径载入并标来源；
 * 3. StrictMode 双挂载下也必须真正载入（不能只发请求、结果被丢弃）。
 *
 * Model3DScene 以 stub 代入（three.js/WebGL 在 happy-dom 无渲染上下文）；
 * 场景真伪由 readSceneFile mock 提供合法 sampleScene3D。
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sampleScene3D } from '@/lib/scene3d';
import { readSceneFile } from '@/lib/sceneEditClient';
import { Model3DSurface } from './Model3DSurface';

vi.mock('@/components/work-surface/Model3DScene', () => ({
  Model3DScene: () => <div data-testid="model3d-scene-stub" />,
}));

vi.mock('@/lib/model3dClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/model3dClient')>();
  return {
    ...actual,
    fetchModel3DCapability: vi.fn().mockResolvedValue({
      status: 'unavailable',
      reason: 'test',
      version: null,
      cad: null,
      generation: null,
    }),
    resolveModel3DScene: vi.fn((scene: unknown) => Promise.resolve({ ok: true, scene, appliedConstraints: [] })),
  };
});

vi.mock('@/lib/sceneEditClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sceneEditClient')>();
  return { ...actual, readSceneFile: vi.fn() };
});

const readMock = vi.mocked(readSceneFile);

function stubFetch(entries: Array<{ name: string; modifiedAt: number }>) {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/tree')) {
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        entries: entries.map((entry) => ({ ...entry, type: 'file' })),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  readMock.mockReset();
  readMock.mockResolvedValue({ scene: sampleScene3D(), hash: 'a'.repeat(64) });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('UI-654 3D 工作面自动恢复与外部打开', () => {
  it('无外部请求时自动打开项目最新 SceneSpec（StrictMode 双挂载也生效）', async () => {
    stubFetch([
      { name: 'old.scene3d.json', modifiedAt: 1 },
      { name: 'new.scene3d.json', modifiedAt: 2 },
    ]);
    render(
      <React.StrictMode>
        <Model3DSurface projectId="p1" />
      </React.StrictMode>,
    );
    await waitFor(() => expect(readMock).toHaveBeenCalledWith('p1', 'model3d/new.scene3d.json'));
    expect(await screen.findByTestId('model3d-scene-source')).toBeTruthy();
    expect(screen.getByTestId('model3d-scene-source').textContent).toContain('model3d/new.scene3d.json');
    expect(JSON.parse(window.localStorage.getItem('petri.model3d.lastOpen.p1') || '{}'))
      .toEqual({ scenePath: 'model3d/new.scene3d.json' });
  });

  it('优先恢复上次打开的场景，而不是重新发现', async () => {
    window.localStorage.setItem('petri.model3d.lastOpen.p1', JSON.stringify({ scenePath: 'model3d/last.scene3d.json' }));
    stubFetch([{ name: 'new.scene3d.json', modifiedAt: 2 }]);
    render(<Model3DSurface projectId="p1" />);
    await waitFor(() => expect(readMock).toHaveBeenCalledWith('p1', 'model3d/last.scene3d.json'));
    expect(screen.getByTestId('model3d-scene-source').textContent).toContain('model3d/last.scene3d.json');
  });

  it('外部请求打开导出快照：标来源为只读快照', async () => {
    stubFetch([]);
    render(
      <Model3DSurface
        projectId="p1"
        initialOpen={{ scenePath: 'model3d/runs/run_1/scene.json', nonce: 1 }}
      />,
    );
    await waitFor(() => expect(readMock).toHaveBeenCalledWith('p1', 'model3d/runs/run_1/scene.json'));
    const source = await screen.findByTestId('model3d-scene-source');
    expect(source.textContent).toContain('model3d/runs/run_1/scene.json');
    expect(source.textContent).toContain('只读');
  });

  it('外部请求打开工作区网格：标网格来源（仅几何预览）', async () => {
    stubFetch([]);
    render(
      <Model3DSurface
        projectId="p1"
        initialOpen={{ meshPath: 'model3d/assets/part.glb', nonce: 2 }}
      />,
    );
    const source = await screen.findByTestId('model3d-mesh-source');
    expect(source.textContent).toContain('model3d/assets/part.glb');
    expect(readMock).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem('petri.model3d.lastOpen.p1') || '{}'))
      .toEqual({ meshPath: 'model3d/assets/part.glb' });
  });
});
