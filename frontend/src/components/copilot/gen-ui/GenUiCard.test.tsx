// BLOCK-166 P2 — 放大预览锚点迁移契约：同一 iframe DOM 节点在卡片锚点与覆盖层间
// 搬移，src 不变（不重载）、节点身份不变（交互状态保留）；还原回到锚点。
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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

// BLOCK-166-NAV-GUARD — 沙箱帧劫持侦测推送：精确匹配即时重置 / 非本卡零扰动 / 30s×3 挂起 / 手动恢复。
describe('GenUiCard NAV-GUARD（劫持即时恢复+循环限幅）', () => {
  let hijackSink: ((payload: { frameUrl?: string }) => void) | null = null;

  afterEach(() => {
    cleanup();
    delete (window as unknown as { petri?: unknown }).petri;
    hijackSink = null;
  });

  async function waitForSubscription() {
    // act 外 setState 的 passive effects 由调度器延迟提交——act 冲刷 + 轮询兜底
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- 逐轮冲刷等待订阅生效
      await act(async () => {});
      if (hijackSink) { console.log('[poll] sink ready at iter', i); return; }
      console.log('[poll] iter', i, 'sink null');
      // eslint-disable-next-line no-await-in-loop -- 给调度器让渡
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(hijackSink).not.toBeNull();
  }

  function mountWithHijackChannel() {
    (window as unknown as { petri?: unknown }).petri = {
      genUi: {
        prepare,
        copyImage,
        onSandboxHijacked: (cb: (payload: { frameUrl?: string }) => void) => {
          hijackSink = cb;
          return () => {
            hijackSink = null;
          };
        },
      },
    };
    return mountCard();
  }

  afterEach(() => {
    hijackSink = null;
  });

  it('命中本卡帧 URL 的劫持信号即时重置（不等 9s 心跳宽限）；非本卡帧零扰动', async () => {
    const { container } = mountWithHijackChannel();
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    // 订阅 effect 在 iframe 挂载后的 passive effect 刷新中惰性生效（act 外 setState
    // 由调度器异步提交）——轮询等待订阅就绪再发信号
    await waitForSubscription();
    const frame = container.querySelector('iframe') as HTMLIFrameElement;

    // 非本卡帧：零扰动（同一 DOM 节点在场）
    hijackSink?.({ frameUrl: 'petri-genui://gen-other/index.html' });
    expect(container.querySelector('iframe')).toBe(frame);

    // 本卡帧：即时重置（resetSeq 变化 → iframe 节点重建）
    hijackSink?.({ frameUrl: 'petri-genui://gen-test123/index.html' });
    await waitFor(() => {
      const el = container.querySelector('iframe');
      expect(el).not.toBeNull();
      expect(el).not.toBe(frame);
    });
    expect(document.querySelector('[data-testid="gen-ui-sandbox-suspended"]')).toBeNull();
  });

  it('30s 窗口内第 3 次劫持转挂起态；挂起中信号不再触发重置；手动恢复重载', async () => {
    const { container } = mountWithHijackChannel();
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    await waitForSubscription();
    const frameUrl = 'petri-genui://gen-test123/index.html';
    hijackSink?.({ frameUrl });
    hijackSink?.({ frameUrl });
    hijackSink?.({ frameUrl });
    // act 外的 setState 由调度器异步提交——先让渡一拍再断言挂起面
    await new Promise((r) => setTimeout(r, 250));
    const suspended = await waitFor(
      () => document.querySelector('[data-testid="gen-ui-sandbox-suspended"]'),
    );
    expect(suspended).not.toBeNull();

    // 挂起中信号不再触发重置/计数（挂起面保持单份）
    hijackSink?.({ frameUrl });
    expect(document.querySelectorAll('[data-testid="gen-ui-sandbox-suspended"]').length).toBe(1);

    // 手动恢复：挂起面消失，iframe 重载回场
    screen.getByRole('button', { name: '恢复可视化' }).click();
    await waitFor(() => {
      expect(document.querySelector('[data-testid="gen-ui-sandbox-suspended"]')).toBeNull();
      expect(container.querySelector('iframe')).not.toBeNull();
    });
  });
});
