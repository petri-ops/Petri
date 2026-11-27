/**
 * item 83 UX 补充 HK-01（owner 实机截图反馈）：
 * ①默认缩略（max-height ≤400）且可放大/还原 ②手动缩放 +/- 且本次会话内记忆
 * ③一轮多产物按编号 tabs 切换，不垂直堆一长串。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatArtifactCard } from './ChatArtifactCard';

vi.mock('@/lib/events', () => ({
  petriEvents: { projectOpenArtifact: 'petri:project-open-artifact', model3dOpen: 'petri:model3d-open' },
  dispatchPetriEvent: vi.fn(),
}));

const payload = (count: number) => ({
  ok: true,
  result: {
    outDir: 'generated',
    artifacts: Array.from({ length: count }, (_, i) => ({
      name: `image-${i + 1}.png`,
      path: `/data/generated/generate-image/image-${i + 1}.png`,
      url: `/api/generated/file/image/image-${i + 1}.png`,
      mime: 'image/png',
      source: { provider: 'ark', model: 'seedream' },
    })),
  },
});

function stubStatus(count: number) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload(count)), { status: 200 }))));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('item 83 结果卡片 UX', () => {
  beforeEach(() => { stubStatus(3); });

  it('HK-01 默认缩略 max-height ≤400，且可放大/还原', async () => {
    render(<ChatArtifactCard toolJobId="tj_ux" expanded projectId={null} />);
    const img = await screen.findByRole('img', { name: 'image-1.png' });
    expect(parseInt(img.style.maxHeight, 10)).toBeLessThanOrEqual(400);
    fireEvent.click(screen.getByTestId('chat-artifact-zoom-toggle'));
    expect(await screen.findByTestId('chat-artifact-lightbox')).toBeTruthy();
    expect(screen.getByTestId('chat-artifact-zoom-toggle').textContent).toBe('还原');
    fireEvent.click(screen.getByTestId('chat-artifact-zoom-toggle'));
    expect(screen.queryByTestId('chat-artifact-lightbox')).toBeNull();
  });

  it('HK-01 手动缩放 +/-，偏好在本次会话内记忆', async () => {
    const first = render(<ChatArtifactCard toolJobId="tj_ux" expanded projectId={null} />);
    let img = await first.findByRole('img', { name: 'image-1.png' });
    const base = parseInt(img.style.maxHeight, 10);
    fireEvent.click(screen.getByTestId('chat-artifact-zoom-in'));
    img = await screen.findByRole('img', { name: 'image-1.png' });
    expect(parseInt(img.style.maxHeight, 10)).toBeGreaterThan(base);
    first.unmount();
    render(<ChatArtifactCard toolJobId="tj_ux" expanded projectId={null} />);
    img = await screen.findByRole('img', { name: 'image-1.png' });
    expect(parseInt(img.style.maxHeight, 10)).toBeGreaterThan(base);
  });

  it('HK-01 多产物按 1/3 2/3 3/3 tabs 切换，不垂直堆一长串', async () => {
    render(<ChatArtifactCard toolJobId="tj_ux" expanded projectId={null} />);
    const tabs = await screen.findAllByTestId('chat-artifact-tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['1/3', '2/3', '3/3']);
    expect((await screen.findByRole('img', { name: 'image-1.png' })).getAttribute('src')).toContain('image-1.png');
    fireEvent.click(tabs[1]);
    const visible = await screen.findAllByRole('img');
    expect(visible.length).toBe(1);
    expect(visible[0].getAttribute('src')).toContain('image-2.png');
  });
});
