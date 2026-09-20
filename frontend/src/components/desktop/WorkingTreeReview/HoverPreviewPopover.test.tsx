import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoverPreviewPopover } from './HoverPreviewPopover';

// BLOCK-47 — UI-255 增量：悬停浮窗纵向越界修复。
// 根因：useLayoutEffect 仅在 anchor 变化时测高，内容异步膨胀后 top 不重算，
// 60vh 上限时底边越出窗口（实测越界约 145px）。修法：ResizeObserver 重钳。

const MARGIN = 8;

function rect(top: number, left: number, w = 100, h = 20): DOMRect {
  return {
    top,
    left,
    right: left + w,
    bottom: top + h,
    width: w,
    height: h,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

describe('HoverPreviewPopover 纵向钳制（BLOCK-47）', () => {
  let roCb: ResizeObserverCallback | null = null;
  const roObserve = vi.fn();
  const roDisconnect = vi.fn();
  let contentHeight = 100;
  const innerHeightSpy = vi.spyOn(window, 'innerHeight', 'get');
  const gbcSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');

  beforeEach(() => {
    roCb = null;
    contentHeight = 100;
    innerHeightSpy.mockReturnValue(1000);
    gbcSpy.mockImplementation(function (this: HTMLElement) {
      return rect(0, 0, 420, contentHeight);
    });
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
  });

  afterEach(() => {
    innerHeightSpy.mockReset();
    gbcSpy.mockReset();
    vi.unstubAllGlobals();
    cleanup();
  });

  it('首帧按内容高度钳制 top，底边不出窗口', () => {
    // anchor 贴近视口底部：不钳制时 top=anchor.top-8，浮窗将越界
    const { getByTestId } = render(
      <HoverPreviewPopover
        anchor={rect(990, 500)}
        testid="pop"
        className="pop"
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      >
        <div>diff</div>
      </HoverPreviewPopover>
    );
    const el = getByTestId('pop');
    // top = min(990-8, 1000-100-8) = 892，bottom = 992 ≤ 1000-8
    expect(el.style.top).toBe('892px');
    expect(el.style.visibility).toBe('visible');
    expect(Number.parseFloat(el.style.top) + contentHeight).toBeLessThanOrEqual(1000 - MARGIN);
  });

  it('内容异步膨胀后 ResizeObserver 重钳 top，底边仍不出窗口', () => {
    const { getByTestId } = render(
      <HoverPreviewPopover
        anchor={rect(990, 500)}
        testid="pop"
        className="pop"
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      >
        <div>diff</div>
      </HoverPreviewPopover>
    );
    expect(roObserve).toHaveBeenCalled();
    expect(roCb).toBeTruthy();

    // 模拟 diff 流式渲染使内容膨胀到 60vh 上限（600px）
    act(() => {
      contentHeight = 600;
      roCb!([], {} as ResizeObserver);
    });
    const el = getByTestId('pop');
    // 修复前：top 恒 892，bottom = 1492 越界；修复后：top = min(982, 1000-600-8) = 392
    expect(el.style.top).toBe('392px');
    expect(Number.parseFloat(el.style.top) + contentHeight).toBeLessThanOrEqual(1000 - MARGIN);
  });

  it('内容收缩后 top 回弹到 anchor 侧，卸载时断开观察', () => {
    const { getByTestId, unmount } = render(
      <HoverPreviewPopover
        anchor={rect(990, 500)}
        testid="pop"
        className="pop"
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      >
        <div>diff</div>
      </HoverPreviewPopover>
    );
    act(() => {
      contentHeight = 600;
      roCb!([], {} as ResizeObserver);
    });
    act(() => {
      contentHeight = 40;
      roCb!([], {} as ResizeObserver);
    });
    const el = getByTestId('pop');
    // 收缩后钳制上限回到 anchor 侧：top = min(982, 1000-40-8) = 952
    expect(el.style.top).toBe('952px');
    unmount();
    expect(roDisconnect).toHaveBeenCalled();
  });
});
