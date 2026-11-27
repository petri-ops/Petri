/**
 * item 83 打磨批 HK-01：图片居中 + 常规操作工具条（复制图片 IPC / 另存为 / 打开所在文件夹 /
 * 系统查看器打开），且明确不做编辑（裁剪/标注/滤镜）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBridge } from '@/lib/desktopBridge';

import { ChatArtifactCard } from './ChatArtifactCard';

vi.mock('@/lib/events', () => ({
  petriEvents: { projectOpenArtifact: 'petri:project-open-artifact', model3dOpen: 'petri:model3d-open' },
  dispatchPetriEvent: vi.fn(),
}));
vi.mock('@/lib/desktopBridge', () => ({ getBridge: vi.fn() }));

const copyImage = vi.fn(() => Promise.resolve({ ok: true }));
const downloadFromUrl = vi.fn(() => Promise.resolve({ ok: true }));
const openPath = vi.fn(() => Promise.resolve({ ok: true }));

beforeEach(() => {
  vi.mocked(getBridge).mockImplementation((name: string) => {
    if (name === 'app') return { copyImage } as never;
    if (name === 'files') return { downloadFromUrl, openPath } as never;
    return null;
  });
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
    ok: true,
    result: {
      outDir: 'generated',
      artifacts: [{
        name: 'image-1.png',
        path: '/data/generated/generate-image/image-1.png',
        url: '/api/generated/file/image/image-1.png',
        mime: 'image/png',
        source: { provider: 'ark', model: 'seedream' },
      }],
    },
  }), { status: 200 }))));
});

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('item 83 产物卡图片工具条', () => {
  it('HK-01 图片在卡片内居中', async () => {
    render(<ChatArtifactCard toolJobId="tj_bar" expanded projectId={null} />);
    const frame = await screen.findByTestId('chat-artifact-image-frame');
    expect(frame.style.display).toBe('flex');
    expect(frame.style.justifyContent).toBe('center');
  });

  it('HK-01 复制图片走主进程 IPC clipboard（image 分支）', async () => {
    render(<ChatArtifactCard toolJobId="tj_bar" expanded projectId={null} />);
    fireEvent.click(await screen.findByTestId('chat-artifact-copy-image'));
    expect(copyImage).toHaveBeenCalledWith({ kind: 'image', filename: 'image-1.png' });
  });

  it('HK-01 导出/打开菜单存在且分别调用既有文件通道', async () => {
    render(<ChatArtifactCard toolJobId="tj_bar" expanded projectId={null} />);
    fireEvent.click(await screen.findByTestId('chat-artifact-export'));
    expect(downloadFromUrl).toHaveBeenCalledWith(
      expect.stringContaining('/api/generated/file/image/image-1.png'),
      'image-1.png',
    );
    fireEvent.click(screen.getByTestId('chat-artifact-open-folder'));
    expect(openPath).toHaveBeenCalledWith('/data/generated/generate-image');
    fireEvent.click(screen.getByTestId('chat-artifact-open-system'));
    expect(openPath).toHaveBeenCalledWith('/data/generated/generate-image/image-1.png');
  });

  it('HK-01 预览不提供人工编辑入口', async () => {
    render(<ChatArtifactCard toolJobId="tj_bar" expanded projectId={null} />);
    await screen.findByTestId('chat-artifact-image-frame');
    expect(screen.queryByText(/裁剪|标注|滤镜/)).toBeNull();
  });
});
