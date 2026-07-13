import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, type RenderHookResult } from '@testing-library/react';
import { useResizableColumns } from '@/hooks/useResizableColumns';

const LS_KEY = 'biof3-pw-cols';

function flush() {
  return act(async () => {
    await Promise.resolve();
  });
}

function fireMouse(
  target: EventTarget,
  type: string,
  init: { clientX?: number; clientY?: number; buttons?: number } = {},
) {
  const event = new MouseEvent(type, { bubbles: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('useResizableColumns', () => {
  beforeEach(() => {
    localStorage.removeItem(LS_KEY);
  });
  afterEach(() => {
    localStorage.removeItem(LS_KEY);
    document.documentElement.style.removeProperty('--biof3-live-result-right-width');
  });
  it('exposes sane initial sizes', () => {
    const { result } = renderHook(() => useResizableColumns());
    expect(result.current.leftWidth).toBe(240);
    expect(result.current.rightWidth).toBe(340);
    expect(result.current.resultRightWidth).toBe(720);
    expect(result.current.inputHeight).toBe(120);
    expect(result.current.bottomTerminalHeight).toBe(240);
  });

  it('honors overrides on initial render', () => {
    const { result } = renderHook(() =>
      useResizableColumns({ leftWidth: 200, rightWidth: 400, inputHeight: 80, bottomTerminalHeight: 200 }),
    );
    expect(result.current.leftWidth).toBe(200);
    expect(result.current.rightWidth).toBe(400);
    expect(result.current.inputHeight).toBe(80);
    expect(result.current.bottomTerminalHeight).toBe(200);
  });

  it('resizes the left column with a min of 96', async () => {
    const { result }: RenderHookResult<ReturnType<typeof useResizableColumns>, unknown> =
      renderHook(() => useResizableColumns());
    const handler = result.current.startColumnResize('left');
    const fakeEvent = { preventDefault: () => {}, clientX: 0, clientY: 0 } as unknown as React.MouseEvent;

    await flush();
    handler(fakeEvent);

    fireMouse(document, 'mousemove', { clientX: 300, buttons: 1 });
    fireMouse(document, 'mouseup');
    await flush();
    expect(result.current.leftWidth).toBe(240 + 300);

    // Re-attach and try to drag past the minimum.
    handler(fakeEvent);
    fireMouse(document, 'mousemove', { clientX: -10_000, buttons: 1 });
    fireMouse(document, 'mouseup');
    await flush();
    expect(result.current.leftWidth).toBe(96);
  });

  it('resizes the input height with a min of 48', async () => {
    const { result } = renderHook(() => useResizableColumns());
    const handler = result.current.startColumnResize('input');
    const fakeEvent = { preventDefault: () => {}, clientX: 0, clientY: 0 } as unknown as React.MouseEvent;

    await flush();
    handler(fakeEvent);
    fireMouse(document, 'mousemove', { clientY: 100, buttons: 1 });
    fireMouse(document, 'mouseup');
    await flush();
    // 120 - 100 = 20, but Math.max(48, 20) clamps to 48.
    expect(result.current.inputHeight).toBe(48);

    handler(fakeEvent);
    fireMouse(document, 'mousemove', { clientY: -10_000, buttons: 1 });
    fireMouse(document, 'mouseup');
    await flush();
    // deltaY = -10000, startInput = 48 (clamped), so 48 - (-10000) = 10048.
    expect(result.current.inputHeight).toBe(10048);
  });

  it('toggles body cursor and user-select while dragging', async () => {
    const setCursor = vi.spyOn(document.body.style, 'cursor', 'set');
    const setSelect = vi.spyOn(document.body.style, 'userSelect', 'set');
    const { result } = renderHook(() => useResizableColumns());
    const handler = result.current.startColumnResize('right');
    const fakeEvent = { preventDefault: () => {}, clientX: 0, clientY: 0 } as unknown as React.MouseEvent;

    await flush();
    handler(fakeEvent);
    expect(setCursor).toHaveBeenCalledWith('ew-resize');
    expect(setSelect).toHaveBeenCalledWith('none');
    expect(document.body.classList.contains('biof3-resizing-columns')).toBe(true);

    fireMouse(document, 'mouseup');
    expect(setCursor).toHaveBeenCalledWith('');
    expect(setSelect).toHaveBeenCalledWith('');
    expect(document.body.classList.contains('biof3-resizing-columns')).toBe(false);
  });

  it('honors caller-supplied clamp on the bottom terminal resize', async () => {
    const { result } = renderHook(() => useResizableColumns({ bottomTerminalHeight: 200 }));
    const fakeEvent = { preventDefault: () => {}, clientY: 0 } as unknown as React.MouseEvent;

    // Plan 1.6 §4.4 — project-workspace passes { min: 140, max: 520 } to
    // keep the bottom terminal from eating the whole viewport. Verify
    // that clamp is applied per drag (using the value at drag-start).
    await flush();
    result.current.startBottomTerminalResize(fakeEvent, { min: 140, max: 520 });

    // Drag up by 800px (clientY = -800) — naive next = 200 - (-800) = 1000 → clamp to max 520.
    fireMouse(document, 'mousemove', { clientY: -800, buttons: 1 });
    fireMouse(document, 'mouseup');
    await flush();
    expect(result.current.bottomTerminalHeight).toBe(520);

    // Drag down by 200px (clientY = +200) — naive next = 520 - 200 = 320 → fits in [140, 520].
    result.current.startBottomTerminalResize(fakeEvent, { min: 140, max: 520 });
    fireMouse(document, 'mousemove', { clientY: 200, buttons: 1 });
    fireMouse(document, 'mouseup');
    await flush();
    expect(result.current.bottomTerminalHeight).toBe(320);

    // Drag down by 10_000px (clientY = +10_000) — naive next = 320 - 10000 = -9680 → clamp to min 140.
    result.current.startBottomTerminalResize(fakeEvent, { min: 140, max: 520 });
    fireMouse(document, 'mousemove', { clientY: 10_000, buttons: 1 });
    fireMouse(document, 'mouseup');
    await flush();
    expect(result.current.bottomTerminalHeight).toBe(140);
  });

  // ---- §3 localStorage persistence ----

  it('writes all panel dims to localStorage on each resize', async () => {
    localStorage.removeItem(LS_KEY);
    const { result } = renderHook(() => useResizableColumns());
    await flush();
    const handler = result.current.startColumnResize('left');
    const fakeEvent = { preventDefault: () => {}, clientX: 0, clientY: 0 } as unknown as React.MouseEvent;
    handler(fakeEvent);
    fireMouse(document, 'mousemove', { clientX: 100, buttons: 1 });
    fireMouse(document, 'mouseup');
    await flush();

    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    expect(saved.leftWidth).toBe(340); // 240 + 100
    expect(saved.rightWidth).toBe(340);
    expect(saved.resultRightWidth).toBe(720);
    expect(saved.inputHeight).toBe(120);
    expect(saved.bottomTerminalHeight).toBe(240);
  });

  it('resizes and persists the result panel independently from the standard right panel', async () => {
    const { result } = renderHook(() => useResizableColumns());
    const handler = result.current.startColumnResize('resultRight');
    const fakeEvent = { preventDefault: () => {}, clientX: 0, clientY: 0 } as unknown as React.MouseEvent;

    handler(fakeEvent);
    fireMouse(document, 'mousemove', { clientX: 120, buttons: 1 });
    expect(result.current.resultRightWidth).toBe(720);
    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });
    expect(
      document.documentElement.style.getPropertyValue('--biof3-live-result-right-width'),
    ).toBe('600px');
    fireMouse(document, 'mouseup');
    await flush();

    expect(result.current.resultRightWidth).toBe(600);
    expect(result.current.rightWidth).toBe(340);
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    expect(saved.resultRightWidth).toBe(600);
    expect(saved.rightWidth).toBe(340);
  });

  it('restores dimensions from localStorage on re-mount', async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ leftWidth: 500, rightWidth: 200, inputHeight: 90, bottomTerminalHeight: 300 }));
    const { result } = renderHook(() => useResizableColumns());
    expect(result.current.leftWidth).toBe(500);
    expect(result.current.rightWidth).toBe(200);
    expect(result.current.inputHeight).toBe(90);
    expect(result.current.bottomTerminalHeight).toBe(300);
  });

  it('prefers localStorage over defaults but caller overrides override localStorage', async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ leftWidth: 999, rightWidth: 888, inputHeight: 77, bottomTerminalHeight: 666 }));
    const { result } = renderHook(() =>
      useResizableColumns({ leftWidth: 300 }), // only leftWidth overridden
    );
    expect(result.current.leftWidth).toBe(300);   // caller wins
    expect(result.current.rightWidth).toBe(888); // LS
    expect(result.current.inputHeight).toBe(77);  // LS
    expect(result.current.bottomTerminalHeight).toBe(666); // LS
  });

  it('persists on bottomTerminalHeight resize', async () => {
    const { result } = renderHook(() => useResizableColumns({ bottomTerminalHeight: 200 }));
    await flush();
    result.current.startBottomTerminalResize(
      { preventDefault: () => {}, clientY: 0 } as unknown as React.MouseEvent,
    );
    fireMouse(document, 'mousemove', { clientY: 80, buttons: 1 }); // 200 - 80 = 120
    fireMouse(document, 'mouseup');
    await flush();

    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    expect(saved.bottomTerminalHeight).toBe(120);
  });

  it('survives corrupted localStorage gracefully', async () => {
    localStorage.setItem(LS_KEY, 'not valid json {{{');
    const { result } = renderHook(() => useResizableColumns());
    // Should fall back to defaults without crashing
    expect(result.current.leftWidth).toBe(240);
    expect(result.current.rightWidth).toBe(340);
  });

  it('stops resizing when the mouse button is no longer pressed', async () => {
    const { result } = renderHook(() => useResizableColumns());
    const handler = result.current.startColumnResize('right');
    const fakeEvent = { preventDefault: () => {}, clientX: 0, clientY: 0 } as unknown as React.MouseEvent;

    await flush();
    handler(fakeEvent);
    fireMouse(document, 'mousemove', { clientX: 60, buttons: 1 });
    await flush();
    const draggedWidth = result.current.rightWidth;
    fireMouse(document, 'mousemove', { clientX: 600, buttons: 0 });
    await flush();

    expect(document.body.classList.contains('biof3-resizing-columns')).toBe(false);
    expect(result.current.rightWidth).toBe(draggedWidth);
  });
});
