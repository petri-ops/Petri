import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { useTerminalSession } from '@/hooks/useTerminalSession';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// All fake constructors and trackers must live inside vi.hoisted() so the
// hoisted vi.mock() factories can reach them without referencing top-level
// variables (which would TDZ).
const hoisted = vi.hoisted(() => {
  class FakeXTerm {
    static instances: FakeXTerm[] = [];
    cols = 80;
    rows = 24;
    options: { theme?: unknown } = {};
    private onDataHandlers: Array<(data: string) => void> = [];
    onData(handler: (data: string) => void) {
      this.onDataHandlers.push(handler);
      return { dispose: () => {} };
    }
    onDataEmit(data: string) {
      for (const h of this.onDataHandlers) h(data);
    }
    open = vi.fn();
    loadAddon = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
    clear = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    constructor(opts: Record<string, unknown>) {
      this.options = opts as { theme?: unknown };
      FakeXTerm.instances.push(this);
    }
  }

  class FakeFitAddon {
    fit = vi.fn();
  }

  return {
    FakeXTerm,
    FakeFitAddon,
    ctor: vi.fn(),
  };
});

vi.mock('@xterm/xterm', () => {
  return {
    Terminal: class extends hoisted.FakeXTerm {
      constructor(opts: Record<string, unknown>) {
        super(opts);
        hoisted.ctor(opts);
      }
    },
  };
});

vi.mock('@xterm/addon-fit', () => {
  return {
    FitAddon: class extends hoisted.FakeFitAddon {},
  };
});

// Mock ResizeObserver + MutationObserver which happy-dom may not expose.
class FakeResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_cb: ResizeObserverCallback) {}
}
class FakeMutationObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn().mockReturnValue([]);
  constructor(_cb: MutationCallback) {}
}

// ---------------------------------------------------------------------------
// IPC bridge installer
// ---------------------------------------------------------------------------

interface TerminalBridge {
  startSession: ReturnType<typeof vi.fn>;
  stopSession: ReturnType<typeof vi.fn>;
  writeSession: ReturnType<typeof vi.fn>;
  resizeSession: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
}

function installBridge() {
  const onDataListeners: Array<(data: string) => void> = [];
  const onExitListeners: Array<(payload: { code?: number | null; signal?: string | null }) => void> = [];
  const bridge: TerminalBridge = {
    startSession: vi.fn().mockResolvedValue({ ok: true }),
    stopSession: vi.fn().mockResolvedValue({ ok: true }),
    writeSession: vi.fn(),
    resizeSession: vi.fn(),
    onData: vi.fn((cb: (data: string) => void) => {
      onDataListeners.push(cb);
      return () => {
        const i = onDataListeners.indexOf(cb);
        if (i >= 0) onDataListeners.splice(i, 1);
      };
    }),
    onExit: vi.fn((cb: (payload: { code?: number | null; signal?: string | null }) => void) => {
      onExitListeners.push(cb);
      return () => {
        const i = onExitListeners.indexOf(cb);
        if (i >= 0) onExitListeners.splice(i, 1);
      };
    }),
  };
  (window as unknown as { biof3Desktop: { terminal: TerminalBridge } }).biof3Desktop = {
    terminal: bridge,
  };
  return { bridge, onDataListeners, onExitListeners };
}

function uninstallBridge() {
  delete (window as unknown as { biof3Desktop?: unknown }).biof3Desktop;
}

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

function mountHost(workspacePath?: string, open = false) {
  const host = document.createElement('div');
  document.body.appendChild(host);

  // We attach hostRef.current before the renderHook so the mount effect can
  // find a non-null host. We do this by passing a small wrapper component
  // that captures the ref synchronously in its render body.
  function Harness(props: { isOpen: boolean; ws?: string }) {
    const session = useTerminalSession({ open: props.isOpen, workspacePath: props.ws });
    // Set the ref synchronously during render. The mount effect reads it.
    (session.hostRef as React.MutableRefObject<HTMLDivElement | null>).current = host;
    return session;
  }

  const { result, rerender, unmount } = renderHook(
    ({ isOpen, ws }: { isOpen: boolean; ws?: string }) => Harness({ isOpen, ws }),
    { initialProps: { isOpen: open, ws: workspacePath } }
  );

  return { result, rerender, unmount, host };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTerminalSession', () => {
  beforeEach(() => {
    hoisted.FakeXTerm.instances = [];
    hoisted.ctor.mockClear();
    document.body.innerHTML = '';
    (globalThis as unknown as { ResizeObserver: typeof FakeResizeObserver }).ResizeObserver = FakeResizeObserver;
    (globalThis as unknown as { MutationObserver: typeof FakeMutationObserver }).MutationObserver = FakeMutationObserver;
  });

  afterEach(() => {
    uninstallBridge();
  });

  it('constructs an xterm and opens it into the host element on mount', () => {
    installBridge();
    const { result } = mountHost();
    expect(hoisted.FakeXTerm.instances).toHaveLength(1);
    const term = hoisted.FakeXTerm.instances[0];
    expect(term.open).toHaveBeenCalledTimes(1);
    expect(term.open.mock.calls[0][0]).toBeInstanceOf(HTMLDivElement);
    expect(result.current.hostRef.current).toBeInstanceOf(HTMLDivElement);
  });

  it('does not call startSession until open=true', () => {
    const { bridge } = installBridge();
    mountHost('/tmp', false);
    expect(bridge.startSession).not.toHaveBeenCalled();
  });

  it('calls startSession(workspacePath) and sets running=true when opened', async () => {
    const { bridge } = installBridge();
    const { result } = mountHost('/tmp/proj', true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(bridge.startSession).toHaveBeenCalledWith('/tmp/proj');
    expect(result.current.running).toBe(true);
  });

  it('writes an error message and keeps running=false when startSession fails', async () => {
    const { bridge } = installBridge();
    bridge.startSession.mockResolvedValueOnce({ ok: false, error: 'no pty' });
    const { result } = mountHost('/tmp/proj', true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.running).toBe(false);
    const term = hoisted.FakeXTerm.instances[0];
    const lastWrite = term.writeln.mock.calls[term.writeln.mock.calls.length - 1]?.[0] as string;
    expect(lastWrite).toContain('启动失败');
    expect(lastWrite).toContain('no pty');
  });

  it('forwards terminal input to writeSession', () => {
    const { bridge } = installBridge();
    const { result } = mountHost();
    const term = hoisted.FakeXTerm.instances[0];
    term.onDataEmit('ls\n');
    expect(bridge.writeSession).toHaveBeenCalledWith('ls\n');
    expect(result.current.hostRef).toBeDefined();
  });

  it('writes backend output to the terminal', () => {
    const { onDataListeners } = installBridge();
    mountHost();
    const term = hoisted.FakeXTerm.instances[0];
    onDataListeners[0]('hello world\n');
    expect(term.write).toHaveBeenCalledWith('hello world\n');
  });

  it('sets running=false and writes an exit message when the session exits', () => {
    const { onExitListeners } = installBridge();
    const { result } = mountHost();
    const term = hoisted.FakeXTerm.instances[0];
    onExitListeners[0]({ code: 0, signal: null });
    expect(result.current.running).toBe(false);
    const lastWrite = term.writeln.mock.calls[term.writeln.mock.calls.length - 1]?.[0] as string;
    expect(lastWrite).toContain('进程已退出');
    expect(lastWrite).toContain('代码 0');
  });

  it('exposes clear() that delegates to the underlying terminal', () => {
    installBridge();
    const { result } = mountHost();
    const term = hoisted.FakeXTerm.instances[0];
    act(() => {
      result.current.clear();
    });
    expect(term.clear).toHaveBeenCalledTimes(1);
  });

  it('exposes focus() that delegates to the underlying terminal', () => {
    installBridge();
    const { result } = mountHost();
    const term = hoisted.FakeXTerm.instances[0];
    act(() => {
      result.current.focus();
    });
    expect(term.focus).toHaveBeenCalledTimes(1);
  });

  it('stops the session on unmount and disposes the terminal', () => {
    const { bridge } = installBridge();
    const { unmount } = mountHost();
    const term = hoisted.FakeXTerm.instances[0];
    unmount();
    expect(term.dispose).toHaveBeenCalledTimes(1);
    expect(bridge.stopSession).toHaveBeenCalled();
  });

  it('does not call startSession when biof3Desktop.terminal is absent', async () => {
    uninstallBridge();
    mountHost('/tmp/proj', true);
    await act(async () => {
      await Promise.resolve();
    });
    // The mount effect still constructs the xterm; startSession is gated on
    // window.biof3Desktop presence.
    expect(hoisted.FakeXTerm.instances.length).toBe(1);
  });
});
