/**
 * item 83 补测（owner 实机反馈：generate.video 成功但会话区只有路径、无卡且不能播）。
 * 真因：①generate.* 活动无 toolJobId → 产物卡不挂载 ②跨源 media 被 Chromium 拒，
 * 必须 fetch 字节 → blob: URL（与 VideoResultViewer 同方案）。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatArtifactCard, generatedArtifactsFromResult } from './ChatArtifactCard';
import { ToolActivityList } from './ToolActivityList';
import type { ToolActivityItem } from './toolActivity';

vi.mock('@/lib/events', () => ({
  petriEvents: { projectOpenArtifact: 'petri:project-open-artifact', model3dOpen: 'petri:model3d-open' },
  dispatchPetriEvent: vi.fn(),
}));

const descriptor = {
  path: '/data/generated/generate-video/video-1.mp4',
  sha256: 'abc123',
  mime: 'video/mp4',
  url: '/api/generated/file/video/video-1.mp4',
  source: { provider: 'ark', model: 'seedance', taskId: 'task_v1' },
};

function stubVideoBytes() {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: { 'Content-Type': 'video/mp4' },
  }))));
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:generated-video'),
  });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('item 83 generate.video 会话区可播卡', () => {
  it('HK-01 无 toolJobId 时也能从 resultData 描述符生成产物', () => {
    const artifacts = generatedArtifactsFromResult(descriptor);
    expect(artifacts).not.toBeNull();
    expect(artifacts?.[0]?.url).toBe('/api/generated/file/video/video-1.mp4');
    expect(artifacts?.[0]?.name).toBe('video-1.mp4');
  });

  it('HK-01 视频 card 的 src 走 blob:（跨源 media 会被 Chromium 拒）', async () => {
    stubVideoBytes();
    const artifacts = generatedArtifactsFromResult(descriptor) || [];
    render(<ChatArtifactCard toolJobId="" expanded projectId={null} artifacts={artifacts} />);
    const video = await screen.findByTestId('chat-artifact-video');
    expect(video.getAttribute('src')).toBe('blob:generated-video');
  });

  it('HK-01 generate.video 活动（无 toolJobId）在会话流里渲染产物卡', async () => {
    stubVideoBytes();
    const activity: ToolActivityItem = {
      key: 'gen-video-1',
      name: 'generate.video',
      status: 'success',
      actionLabel: '已生成视频',
      actionDetail: 'video-1.mp4',
      resultData: descriptor,
    };
    render(<ToolActivityList activities={[activity]} forceOpen projectId={null} />);
    expect(await screen.findByTestId('chat-artifact-video')).toBeTruthy();
  });
});
