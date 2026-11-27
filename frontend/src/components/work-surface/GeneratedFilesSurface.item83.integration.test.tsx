/**
 * item83 第三轮：真实渲染路径验证（等价 CDP）——用 owner 实测同形描述符
 * （同 traceId / 不同 iteration / workspace URL）渲染文件面板，断言四类可见且视频可播。
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const TRACE = 'trace_77e5c0a5-074d-4da0-acf6-554575d2093a';
const wsUrl = (p: string) => `/api/workspaces/p1/file?path=${encodeURIComponent(p)}`;
const activities = [
  { key: 'a1', name: 'generate.image', status: 'success', traceId: TRACE, iteration: 2, resultData: { path: 'generated/image/a.png', url: wsUrl('generated/image/a.png'), mime: 'image/png' } },
  { key: 'a2', name: 'generate.model3d', status: 'success', traceId: TRACE, iteration: 4, resultData: { path: 'generated/model3d/s.glb', url: wsUrl('generated/model3d/s.glb'), mime: 'model/gltf-binary' } },
  { key: 'a3', name: 'generate.html', status: 'success', traceId: TRACE, iteration: 5, resultData: { path: 'generated/html/p.html', url: wsUrl('generated/html/p.html'), mime: 'text/html' } },
  { key: 'a4', name: 'generate.video', status: 'success', traceId: TRACE, iteration: 6, resultData: { path: 'generated/video/v.mp4', url: wsUrl('generated/video/v.mp4'), mime: 'video/mp4' } },
];

vi.mock('@/components/copilot/conversationRunStore', () => ({
  useConversationRun: () => ({ toolActivities: activities }),
}));
vi.mock('@/components/copilot/conversationChangesStore', () => ({
  useConversationFileChanges: () => [],
  hydrateConversationFileChanges: () => Promise.resolve(),
}));
vi.mock('@/lib/authClient', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApiPrefix: () => 'http://localhost:3001/api',
}));
vi.mock('@/lib/desktopBridge', () => ({ getBridge: () => ({ openPath: vi.fn(), downloadFromUrl: vi.fn() }) }));
vi.mock('@/components/icons/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));
vi.mock('@/components/workspace-panels/VideoResultViewer', () => ({
  VideoResultViewer: ({ url }: { url: string }) => <video data-testid="panel-video" src={url} />,
}));

import { GeneratedFilesSurface } from './GeneratedFilesSurface';

afterEach(cleanup);

describe('item83 文件面板真实渲染', () => {
  it('HK-01 四类产物可见且视频以 workspace URL 直接内嵌播放', async () => {
    render(
      <GeneratedFilesSurface
        project={{ id: 'p1', name: 'P1' } as never}
        conversationId="c1"
        onOpenFile={() => undefined}
      />,
    );
    const video = await screen.findByTestId('panel-video');
    expect(video.getAttribute('src')).toContain('http://localhost:3001/api/workspaces/p1/file?path=generated%2Fvideo%2Fv.mp4');
    const artifacts = await screen.findAllByTestId('generated-artifact');
    expect(artifacts.length).toBe(3); // image + model3d + html（视频走独立预览）
    expect(screen.getByTestId('generated-video-artifacts')).toBeTruthy();
  });
});
