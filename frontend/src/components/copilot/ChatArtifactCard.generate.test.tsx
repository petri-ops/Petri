/**
 * item 83 HK-01：生成产物（image/model3d/video/html）在会话流内直接预览；
 * HTML 必须 sandbox iframe 且不含 allow-same-origin（opaque origin）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatArtifactCard } from './ChatArtifactCard';

vi.mock('@/lib/events', () => ({
  petriEvents: { projectOpenArtifact: 'petri:project-open-artifact', model3dOpen: 'petri:model3d-open' },
  dispatchPetriEvent: vi.fn(),
}));

const generatedPayload = {
  ok: true,
  result: {
    outDir: 'generated',
    artifacts: [
      { name: 'image-1.png', path: '/data/generated/generate-image/image-1.png', url: '/api/generated/file/image/image-1.png', mime: 'image/png', source: { provider: 'ark', model: 'seedream' } },
      { name: 'video-1.mp4', path: '/data/generated/generate-video/video-1.mp4', url: '/api/generated/file/video/video-1.mp4', mime: 'video/mp4', source: { provider: 'ark', model: 'seedance', taskId: 'task_v1' } },
      { name: 'scene.glb', path: '/data/generated/generate-model3d/scene.glb', url: '/api/generated/file/model3d/scene.glb', mime: 'model/gltf-binary', source: { provider: 'ark', model: 'seed3d', mode: 'image-to-3d' } },
      { name: 'page.html', path: '/data/generated/generate-html/page.html', url: '/api/generated/file/html/page.html', mime: 'text/html', source: { provider: 'local', model: 'html' } },
    ],
  },
};

describe('item 83 生成产物会话区富媒体预览', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(generatedPayload), { status: 200 }))));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('HK-01 图：内联 img 指向受控读面', async () => {
    render(<ChatArtifactCard toolJobId="tj_gen" expanded projectId={null} />);
    const img = await screen.findByRole('img', { name: 'image-1.png' });
    expect(img.getAttribute('src')).toContain('/api/generated/file/image/image-1.png');
  });

  it('HK-01 视频：内联 video 指向受控读面', async () => {
    render(<ChatArtifactCard toolJobId="tj_gen" expanded projectId={null} />);
    const video = await screen.findByTestId('chat-artifact-video');
    expect(video.tagName).toBe('VIDEO');
    expect(video.getAttribute('src')).toContain('/api/generated/file/video/video-1.mp4');
  });

  it('HK-01 3D：展开后渲染内联 3D 预览', async () => {
    render(<ChatArtifactCard toolJobId="tj_gen" expanded projectId={null} />);
    fireEvent.click(await screen.findByRole('button', { name: '展开 3D 预览' }));
    expect(await screen.findByTestId('chat-artifact-3d-preview')).toBeTruthy();
  });

  it('HK-01 HTML：sandbox iframe，allow-scripts 且不含 allow-same-origin', async () => {
    render(<ChatArtifactCard toolJobId="tj_gen" expanded projectId={null} />);
    const iframe = await screen.findByTestId('chat-artifact-html');
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.getAttribute('src')).toContain('/api/generated/file/html/page.html');
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.getAttribute('sandbox') || '').not.toContain('allow-same-origin');
  });

  it('HK-01 元信息：model/taskId 在详情可见，费用缺值不伪造', async () => {
    render(<ChatArtifactCard toolJobId="tj_gen" expanded projectId={null} />);
    expect(await screen.findByText(/seedream/)).toBeTruthy();
    expect(screen.getByText(/task_v1/)).toBeTruthy();
    expect(screen.queryByText(/¥/)).toBeNull();
  });
});
