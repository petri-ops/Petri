/**
 * UI-654 — 文件预览不再要求「去 3D 页手动导入」：
 * SceneSpec（.scene3d.json）与工作区网格（.glb/.gltf/.stl/.obj）预览顶部直接给出
 * 「在 3D 模型打开/预览」，派发统一的 model3dOpen 事件。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActiveWorkspaceFile } from './types';
import { ThemeProvider } from '@/themes/ThemeProvider';

const { dispatchPetriEvent } = vi.hoisted(() => ({ dispatchPetriEvent: vi.fn() }));

vi.mock('@/lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events')>();
  return { ...actual, dispatchPetriEvent };
});

vi.mock('@/lib/desktopBridge', () => ({
  getBridge: () => ({ writeTextFile: vi.fn() }),
}));

vi.mock('@/components/editor', () => ({
  WorkspaceFilePreviewBridge: (props: { value: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="mock-editor"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

import { WorkspaceFilePreview } from './WorkspaceFilePreview';

function workspaceFile(name: string, path: string): ActiveWorkspaceFile {
  return {
    name,
    path,
    url: `http://localhost:3001/api/workspaces/p_x/file?path=${encodeURIComponent(path)}`,
    workspaceKind: 'local',
    workspaceDir: '/ws',
    modifiedAt: 1,
  } as unknown as ActiveWorkspaceFile;
}

function stubFetch(body: string) {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/annotations')) {
      return Promise.resolve(new Response(JSON.stringify({ annotations: [], count: 0, limit: 200 }), { status: 200 }));
    }
    return Promise.resolve(new Response(body, { status: 200 }));
  }));
}

function renderPreview(file: ActiveWorkspaceFile) {
  return render(
    <ThemeProvider>
      <WorkspaceFilePreview
        file={file}
        refreshVersion={0}
        openError=""
        opening={false}
        onOpen={() => undefined}
        onDownload={() => undefined}
        projectId="p_x"
      />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  dispatchPetriEvent.mockClear();
});

describe('UI-654 文件预览一键转 3D 模型', () => {
  it('SceneSpec 预览提供「在 3D 模型打开」并派发 scenePath', async () => {
    stubFetch(JSON.stringify({ version: 'scene3d/v1', units: 'mm', coordinateSystem: 'z-up-right-handed', parameters: {}, nodes: [] }));
    renderPreview(workspaceFile('demo.scene3d.json', 'model3d/demo.scene3d.json'));

    const strip = await screen.findByTestId('workspace-preview-3d-actions');
    fireEvent.click(within(strip).getByRole('button', { name: /在 3D 模型打开/ }));
    expect(dispatchPetriEvent).toHaveBeenCalledWith('petri:model3d-open', {
      projectId: 'p_x',
      scenePath: 'model3d/demo.scene3d.json',
      label: 'demo.scene3d.json',
    });
  });

  it('工作区网格预览提供「在 3D 模型预览」并派发 meshPath', async () => {
    stubFetch('glb-bytes');
    renderPreview(workspaceFile('part.glb', 'model3d/assets/part.glb'));

    const strip = await screen.findByTestId('workspace-preview-3d-actions');
    fireEvent.click(within(strip).getByRole('button', { name: /在 3D 模型预览/ }));
    expect(dispatchPetriEvent).toHaveBeenCalledWith('petri:model3d-open', {
      projectId: 'p_x',
      meshPath: 'model3d/assets/part.glb',
      label: 'part.glb',
    });
  });
});
