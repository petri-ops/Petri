import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatScrollbar } from './ChatScrollbar';

// UI-269 — ChatScrollbar：溢出渲染 / 无溢出不渲染 / scroll 事件更新 thumb 位置

type ScrollableRef = { current: HTMLDivElement | null };

function stubScrollBox(opts: { clientH: number; scrollH: number }): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: opts.clientH });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: opts.scrollH });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    value: 0,
    writable: true,
  });
  return el;
}

describe('ChatScrollbar', () => {
  let roCb: ResizeObserverCallback;
  const roObserve = vi.fn();
  const roDisconnect = vi.fn();

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          roCb = cb;
        }
        observe = roObserve;
        unobserve = vi.fn();
        disconnect = roDisconnect;
      }
    );
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders nothing when content does not overflow', () => {
    const ref: ScrollableRef = { current: stubScrollBox({ clientH: 900, scrollH: 800 }) };
    const { container } = render(<ChatScrollbar containerRef={ref} />);
    expect(container.querySelector('[class*=track]')).toBeNull();
  });

  it('renders a persistent track and thumb when content overflows', () => {
    const ref: ScrollableRef = { current: stubScrollBox({ clientH: 900, scrollH: 1800 }) };
    const { container } = render(<ChatScrollbar containerRef={ref} />);
    expect(container.querySelector('[class*=track]')).toBeTruthy();
    expect(container.querySelector('[class*=thumb]')).toBeTruthy();
    // UI-270 增补 — 导轨线已按用户裁决移除，仅保留 thumb
    expect(container.querySelector('[class*=line]')).toBeNull();
  });

  it('repositions the thumb on scroll events', () => {
    const box = stubScrollBox({ clientH: 900, scrollH: 1800 });
    const ref: ScrollableRef = { current: box };
    const { container } = render(<ChatScrollbar containerRef={ref} />);
    const thumb = container.querySelector<HTMLElement>('[class*=thumb]');
    expect(thumb).toBeTruthy();
    const topBefore = thumb!.style.top;

    act(() => {
      box.scrollTop = 450; // maxScroll = 900 → 中点
      box.dispatchEvent(new Event('scroll'));
    });
    const topAfter = container.querySelector<HTMLElement>('[class*=thumb]')!.style.top;
    expect(topAfter).not.toBe(topBefore);
  });

  it('hides the scrollbar when overflow disappears after a resize', () => {
    const box = stubScrollBox({ clientH: 900, scrollH: 1800 });
    const ref: ScrollableRef = { current: box };
    const { container } = render(<ChatScrollbar containerRef={ref} />);
    expect(container.querySelector('[class*=track]')).toBeTruthy();

    act(() => {
      Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 900 });
      roCb([], {} as ResizeObserver);
    });
    expect(container.querySelector('[class*=track]')).toBeNull();
  });
});
