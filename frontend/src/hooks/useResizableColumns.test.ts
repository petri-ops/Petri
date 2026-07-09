import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, type RenderHookResult } from '@testing-library/react';
import { useResizableColumns } from '@/hooks/useResizableColumns';

function flush() {
  return act(async () => {
    await Promise.resolve();
  });
}

function fireMouse(target: EventTarget, type: string, init: { clientX?: number; clientY?: number } = {}) {
  const event = new MouseEvent(type, { bubbles: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('useResizableColumns', () => {
  it('exposes sane initial sizes', () => {
    const { result } = renderHook(() => useResizableColumns());
    expect(result.current.leftWidth).toBe(240);
    expect(result.current.rightWidth).toBe(340);
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

    fireMouse(document, 'mousemove', { clientX: 300 });
    fireMouse(document, 'mouseup');
    await flush();
    expect(result.current.leftWidth).toBe(240 + 300);

    // Re-attach and try to drag past the minimum.
    handler(fakeEvent);
    fireMouse(document, 'mousemove', { clientX: -10_000 });
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
    fireMouse(document, 'mousemove', { clientY: 100 });
    fireMouse(document, 'mouseup');
    await flush();
    // 120 - 100 = 20, but Math.max(48, 20) clamps to 48.
    expect(result.current.inputHeight).toBe(48);

    handler(fakeEvent);
    fireMouse(document, 'mousemove', { clientY: -10_000 });
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

    fireMouse(document, 'mouseup');
    expect(setCursor).toHaveBeenCalledWith('');
    expect(setSelect).toHaveBeenCalledWith('');
  });
});
