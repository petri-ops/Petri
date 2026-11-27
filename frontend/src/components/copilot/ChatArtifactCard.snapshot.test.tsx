// item 88 第三波——会话区高频区快照测试（产物卡）。
// 快照守护：产物卡三形态（轻量摘要/完整卡图片/完整卡视频+下载出口）的渲染形状。
// 固定 props（durationMs/artifacts 全显式），无时间/随机性漂移面。
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/generatedArtifactActions', () => ({
  copyGeneratedImage: vi.fn(),
  downloadGeneratedArtifact: vi.fn(),
  openGeneratedArtifact: vi.fn(),
  showGeneratedArtifactFolder: vi.fn(),
}));

import { ChatArtifactCard } from './ChatArtifactCard';

afterEach(() => cleanup());

const IMAGE_ARTIFACTS = [
  {
    name: 'poster-1080x1920.png',
    path: '/data/generated/generate-image/poster-1080x1920.png',
    url: '/api/generated/file/image/poster-1080x1920.png',
    sha256: 'abc123',
    source: { provider: 'ark', model: 'seedream-4', taskId: 'demo-task' },
  },
];

const VIDEO_ARTIFACTS = [
  {
    name: 'clip.mp4',
    path: '/data/generated/generate-video/clip.mp4',
    url: '/api/generated/file/video/clip.mp4',
    mime: 'video/mp4',
  },
];

describe('ChatArtifactCard 快照（item 88 第三波）', () => {
  it('轻量摘要形态快照', () => {
    const { asFragment } = render(
      <ChatArtifactCard toolJobId="job_demo" expanded projectId="p1" lightweight durationMs={9600} artifacts={IMAGE_ARTIFACTS as never} />,
    );
    expect(asFragment()).toMatchSnapshot('lightweight-summary');
  });

  it('完整卡图片产物快照', () => {
    const { asFragment } = render(
      <ChatArtifactCard toolJobId="job_demo" expanded projectId="p1" durationMs={9600} artifacts={IMAGE_ARTIFACTS as never} />,
    );
    expect(asFragment()).toMatchSnapshot('full-image-card');
  });

  it('完整卡视频产物快照（下载出口）', () => {
    const { asFragment } = render(
      <ChatArtifactCard toolJobId="job_video" expanded projectId="p1" artifacts={VIDEO_ARTIFACTS as never} />,
    );
    expect(asFragment()).toMatchSnapshot('full-video-card');
  });
});
