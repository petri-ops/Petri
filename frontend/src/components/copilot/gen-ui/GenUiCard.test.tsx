// BLOCK-166 P2 — 放大预览锚点迁移契约：同一 iframe DOM 节点在卡片锚点与覆盖层间
// 搬移，src 不变（不重载）、节点身份不变（交互状态保留）；还原回到锚点。
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenUiCard } from './GenUiCard';

const prepare = vi.fn(() => Promise.resolve({ ok: true, url: 'petri-genui://gen-test123/index.html' }));
const copyImage = vi.fn((_payload: { sessionId: string; rect: { x: number; y: number; width: number; height: number } }) => Promise.resolve({ ok: true }));

vi.mock('@/lib/desktopBridge', () => ({
  getBridge: () => (window as unknown as { petri?: { genUi?: unknown } }).petri?.genUi ?? null,
}));

function mountCard() {
  return render(
    <GenUiCard
      reference={{ path: 'C:/ws/.petri/gen-ui/conv1/demo.html', title: 'P2 预览' }}
      projectId="p1"
      conversationId="conv-1"
      cardKey="k1"
    />,
  );
}

describe('GenUiCard P2 放大预览（锚点迁移不重载）', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as unknown as { petri?: unknown }).petri;
  });

  it('prepare 成功后 iframe 在场；放大 → 节点迁入覆盖层且 src 不变；还原 → 迁回锚点', async () => {
    (window as unknown as { petri?: unknown }).petri = { genUi: { prepare, copyImage } };
    const { container } = mountCard();

    const frame = await waitFor(() => {
      const el = container.querySelector('iframe');
      expect(el).not.toBeNull();
      return el as HTMLIFrameElement;
    });
    expect(frame.getAttribute('src')).toBe('petri-genui://gen-test123/index.html');
    const anchor = frame.parentElement as HTMLElement;
    expect(anchor.querySelector('[data-testid="gen-ui-overlay"]')).toBeNull();

    // 放大：iframe 节点被搬进覆盖层，身份与 src 不变
    const zoomBtn = screen.getByRole('button', { name: '放大' });
    zoomBtn.click();
    const overlay = await waitFor(() => {
      const el = document.querySelector('[data-testid="gen-ui-overlay"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const frameInOverlay = overlay.querySelector('iframe');
    expect(frameInOverlay).not.toBeNull();
    expect(frameInOverlay).toBe(frame); // 同一 DOM 节点 = 不重载
    expect(frameInOverlay?.getAttribute('src')).toBe('petri-genui://gen-test123/index.html');
    // 卡片锚点留占位
    expect(anchor.textContent).toContain('已在放大预览中打开');

    // 还原：迁回锚点，身份不变
    const restoreBtn = screen.getByRole('button', { name: '还原' });
    restoreBtn.click();
    await waitFor(() => {
      expect(document.querySelector('[data-testid="gen-ui-overlay"]')).toBeNull();
    });
    expect(anchor.querySelector('iframe')).toBe(frame);
  });

  it('复制图按钮把卡片可视区域几何提交给 copyImage IPC', async () => {
    (window as unknown as { petri?: unknown }).petri = { genUi: { prepare, copyImage } };
    const { container } = mountCard();
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    screen.getByRole('button', { name: '复制图' }).click();
    await waitFor(() => expect(copyImage).toHaveBeenCalledTimes(1));
    const payload = copyImage.mock.calls[0][0] as { sessionId: string; rect: Record<string, number> };
    expect(payload.sessionId).toBe('gen-test123');
    expect(Number.isFinite(payload.rect.width)).toBe(true);
  });
});
