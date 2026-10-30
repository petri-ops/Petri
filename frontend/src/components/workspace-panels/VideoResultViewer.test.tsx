/**
 * BLOCK-322 P2-05 — 结果面视频 viewer 契约。
 *
 * happy-dom 不实现媒体加载，因此字节侧用 fetch 桩、解码侧用事件与属性桩驱动：
 * 本测只验薄壳契约——**先取字节再喂 blob: 源**（跨源直连会被 Chromium 的 media URL
 * safety check 拒，实测见 flow 证据）、不自动播放、读数只在真拿到 metadata 时出现、
 * 取字节失败/超限/解码失败各自如实降级并保留原文件出口、换产物时状态与 objectURL 都重置。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { VideoResultViewer } from './VideoResultViewer';

const MB = 1024 * 1024;

function stubFetch({ status = 200, contentType = 'video/mp4', contentLength = 16 * 1024, bytes = 16 * 1024 } = {}) {
  const arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(bytes));
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => (key === 'content-type' ? contentType : key === 'content-length' ? String(contentLength) : null) },
    arrayBuffer,
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, arrayBuffer };
}

function stubObjectUrl() {
  let counter = 0;
  const created: string[] = [];
  const revoked: string[] = [];
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: () => {
      counter += 1;
      const href = `blob:test/${counter}`;
      created.push(href);
      return href;
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: (href: string) => { revoked.push(href); } });
  return { created, revoked };
}

async function waitForVideo(container: HTMLElement): Promise<HTMLVideoElement> {
  await waitFor(() => {
    expect(container.querySelector('video')).not.toBeNull();
  });
  const element = container.querySelector<HTMLVideoElement>('video');
  if (!element) throw new Error('video_not_mounted');
  return element;
}

function stubMetadata(element: HTMLVideoElement, values: { duration: number; videoWidth: number; videoHeight: number }) {
  Object.defineProperty(element, 'duration', { value: values.duration, configurable: true });
  Object.defineProperty(element, 'videoWidth', { value: values.videoWidth, configurable: true });
  Object.defineProperty(element, 'videoHeight', { value: values.videoHeight, configurable: true });
}

describe('VideoResultViewer (BLOCK-322 P2-05)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('先取字节再喂 blob: 源，且默认不自动播放', async () => {
    const { fetchMock, arrayBuffer } = stubFetch();
    const { created } = stubObjectUrl();
    const { container } = render(<VideoResultViewer url="/api/workspaces/p1/file?path=a.mp4" name="转盘.mp4" />);
    const element = await waitForVideo(container);
    expect(element).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(element?.src).toBe('blob:test/1');
    expect(element?.getAttribute('controls')).not.toBeNull();
    expect(element?.getAttribute('preload')).toBe('metadata');
    expect(element?.autoplay).toBe(false);
    expect(screen.getByTestId('video-result-viewer-state').textContent).toContain('未自动播放');
  });

  it('拿到 metadata 才显示读数，读不到不猜', async () => {
    stubFetch();
    stubObjectUrl();
    const { container } = render(<VideoResultViewer url="/a.mp4" name="转盘.mp4" />);
    const element = await waitForVideo(container);
    stubMetadata(element, { duration: 0.666, videoWidth: 800, videoHeight: 600 });
    fireEvent.loadedMetadata(element);
    expect(screen.queryByTestId('video-result-viewer-state')).toBeNull();
    expect(screen.getByText('时长 0.67s · 800×600').textContent).toBe('时长 0.67s · 800×600');
  });

  it('duration 为 Infinity/0 时不显示时长（流式媒体不把 Infinity 写成 0 秒）', async () => {
    stubFetch();
    stubObjectUrl();
    const { container } = render(<VideoResultViewer url="/s.webm" name="转盘.webm" />);
    const element = await waitForVideo(container);
    stubMetadata(element, { duration: Infinity, videoWidth: 0, videoHeight: 0 });
    fireEvent.loadedMetadata(element);
    const shell = screen.getByTestId('video-result-viewer');
    expect(shell.textContent).not.toContain('时长');
    expect(shell.textContent).not.toContain('0s');
  });

  it('解码失败如实说明为「字节已取回但无法解码」，并保留原文件出口', async () => {
    stubFetch();
    stubObjectUrl();
    const { container } = render(<VideoResultViewer url="/a.mp4" name="转盘.mp4" />);
    const element = await waitForVideo(container);
    fireEvent.error(element);
    const state = screen.getByTestId('video-result-viewer-state');
    expect(state.textContent).toContain('视频预览不可用');
    expect(state.textContent).toContain('无法解码');
    expect(state.querySelector('a')?.getAttribute('href')).toBe('/a.mp4');
  });

  it('取字节失败（HTTP 非 2xx）说成读取失败而不是「解码不支持」', async () => {
    stubFetch({ status: 500 });
    stubObjectUrl();
    render(<VideoResultViewer url="/b.mp4" name="b" />);
    await waitFor(() => {
      expect(screen.getByTestId('video-result-viewer-state').textContent).toContain('HTTP 500');
    });
    const state = screen.getByTestId('video-result-viewer-state');
    expect(state.textContent).not.toContain('无法解码');
  });

  it('超上限直接拒绝且不读入内存（有界加载）', async () => {
    const { arrayBuffer } = stubFetch({ contentLength: 120 * MB, bytes: 0 });
    stubObjectUrl();
    const { container } = render(<VideoResultViewer url="/big.mp4" name="big.mp4" />);
    await waitFor(() => {
      expect(screen.getByTestId('video-result-viewer-state').textContent).toContain('超过结果面内嵌播放上限');
    });
    expect(container.querySelector('video')).toBeNull();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('换产物时状态与 objectURL 都重置，不把上一条的失败或读数留下', async () => {
    stubFetch();
    const { revoked } = stubObjectUrl();
    const { container, rerender } = render(<VideoResultViewer url="/a.mp4" name="a" />);
    const element = await waitForVideo(container);
    fireEvent.error(element);
    expect(screen.getByTestId('video-result-viewer-state').textContent).toContain('不可用');
    rerender(<VideoResultViewer url="/b.mp4" name="b" />);
    expect(screen.getByTestId('video-result-viewer-state').textContent).toContain('读取视频字节中');
    await waitFor(() => {
      expect(revoked.length).toBeGreaterThan(0);
    });
  });
});
