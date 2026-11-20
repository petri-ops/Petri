import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatArtifactCard } from './ChatArtifactCard';

vi.mock('@/lib/events', () => ({
  petriEvents: { projectOpenArtifact: 'petri:project-open-artifact', model3dOpen: 'petri:model3d-open' },
  dispatchPetriEvent: vi.fn(),
}));

const payload = {
  ok: true,
  result: {
    outDir: '.petri/video/run_1',
    artifacts: [
      { name: 'video.mp4', path: '.petri/video/run_1/video.mp4', url: '/api/workspaces/p1/file?path=video.mp4' },
      { name: 'script.md', path: '.petri/video/run_1/script.md', url: '/api/workspaces/p1/file?path=script.md' },
    ],
  },
};

describe('BLOCK-509 视频产物卡', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('BLOCK-509 轻量摘要默认折叠，展开后 mp4 内联播放且其它产物仍可下载', async () => {
    render(<ChatArtifactCard toolJobId="tj_video" expanded projectId="p1" lightweight />);
    const summary = await screen.findByTestId('chat-artifact-summary');
    expect(summary.textContent).toContain('已生成 2 个产物');
    expect(screen.queryByTestId('chat-artifact-video')).toBeNull();

    fireEvent.click(screen.getByTestId('chat-artifact-open-detail'));
    const video = await screen.findByTestId('chat-artifact-video') as HTMLVideoElement;
    expect(video.tagName).toBe('VIDEO');
    expect(video.controls).toBe(true);
    expect(video.getAttribute('preload')).toBe('metadata');
    expect(screen.getByTestId('chat-artifact-video-download').textContent).toContain('下载视频');
    expect(screen.getAllByText('下载').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('chat-artifact-close-detail'));
    expect(screen.getByTestId('chat-artifact-summary')).toBeTruthy();
    expect(screen.queryByTestId('chat-artifact-video')).toBeNull();
  });
});
