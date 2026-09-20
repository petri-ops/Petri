import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTerminalTabs } from '@/hooks/useTerminalTabs';
import { TERMINAL_THEMES, type TerminalThemeName } from '@/themes/terminal-themes';

// ---------------------------------------------------------------------------
// Mocks（沿用 useTerminalSession 旧测试的 Fake xterm 模式）
// ---------------------------------------------------------------------------

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
      this.options = opts;
      FakeXTerm.instances.push(this);
    }
  }

  class FakeFitAddon {
    fit = vi.fn();
  }

  return { FakeXTerm, FakeFitAddon, ctor: vi.fn() };
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
  return { FitAddon: class extends hoisted.FakeFitAddon {} };
});

class FakeResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_cb: ResizeObserverCallback) {}
}

// ---------------------------------------------------------------------------
// IPC bridge installer（事件 payload 为 BLOCK-54 新形状 { sessionId, ... }）
// ---------------------------------------------------------------------------

type DataPayload = { sessionId: string; data: string };
type ExitPayload = { sessionId: string; code?: number | null; signal?: string | null };

function installBridge() {
  const onDataListeners: Array<(p: DataPayload) => void> = [];
  const onExitListeners: Array<(p: ExitPayload) => void> = [];
  let startCalls = 0;
  const startSession = vi.fn<
    (
      cwd?: string,
      sessionId?: string
    ) => Promise<{ ok: boolean; error?: string; pid?: number; sessionId?: string }>
  >(async (_cwd, sessionId) => ({
    ok: true,
    pid: 1000 + (startCalls += 1),
    sessionId,
  }));
  const bridge = {
    startSession,
    stopSession: vi.fn(async () => ({ ok: true, wasRunning: true })),
    writeSession: vi.fn(async () => ({ ok: true })),
    resizeSession: vi.fn(async () => ({ ok: true })),
    listSessions: vi.fn(async () => ({ ok: true, sessions: [], maxTabs: 4 })),
    onData: vi.fn((cb: (p: DataPayload) => void) => {
      onDataListeners.push(cb);
      return () => {
        const i = onDataListeners.indexOf(cb);
        if (i >= 0) onDataListeners.splice(i, 1);
      };
    }),
    onExit: vi.fn((cb: (p: ExitPayload) => void) => {
      onExitListeners.push(cb);
      return () => {
        const i = onExitListeners.indexOf(cb);
        if (i >= 0) onExitListeners.splice(i, 1);
      };
    }),
  };
  (window as unknown as { biof3Desktop: unknown }).biof3Desktop = { terminal: bridge };
  return { bridge, onDataListeners, onExitListeners };
}

function uninstallBridge() {
  delete (window as unknown as { biof3Desktop?: unknown }).biof3Desktop;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function mountHook(open = false, workspacePath?: string, theme: TerminalThemeName = 'dark') {
  const hosts = new Map<string, HTMLDivElement>();
  /** 挂载宿主元素（模拟 React commit：ref 先于 effects 就绪，带 data-tab-body 供断言定位）。 */
  function attachHost(id: string) {
    if (hosts.has(id)) return;
    const el = document.createElement('div');
    el.setAttribute('data-tab-body', id);
    document.body.appendChild(el);
    hosts.set(id, el);
    result.current.registerHost(id)(el);
  }
  const { result, rerender, unmount } = renderHook(
    ({ isOpen, ws, activeTheme }: { isOpen: boolean; ws?: string; activeTheme: TerminalThemeName }) =>
      useTerminalTabs({ open: isOpen, workspacePath: ws, theme: activeTheme }),
    { initialProps: { isOpen: open, ws: workspacePath, activeTheme: theme } }
  );
  /** 连开 n 个 tab；每次 openTab 独立 act（对齐真实用户点击节奏：每 tab 激活期间各自 ensure）。
   *  新 tab 宿主必须在同一 act 内挂载：真实组件所有 tab body 随创建即渲染（ref 先于
   *  passive effect 就绪），createTerminalTab 的 id 规则是 `tab-${maxSeq+1}`。 */
  function openTabAndAttach(count: number) {
    for (let i = 0; i < count; i += 1) {
      act(() => {
        const nextId = `tab-${result.current.tabs.length + 1}`;
        result.current.openTab();
        attachHost(nextId);
      });
    }
  }
  function setOpen(nextOpen: boolean) {
    rerender({ isOpen: nextOpen, ws: workspacePath, activeTheme: theme });
  }
  return { result, rerender, unmount, attachHost, openTabAndAttach, setOpen };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useTerminalTabs', () => {
  beforeEach(() => {
    hoisted.FakeXTerm.instances = [];
    hoisted.ctor.mockClear();
    document.body.innerHTML = '';
    (globalThis as unknown as { ResizeObserver: typeof FakeResizeObserver }).ResizeObserver =
      FakeResizeObserver;
  });

  afterEach(() => {
    uninstallBridge();
  });

  it('openTab 建首个 tab；面板展开后按 (cwd, sessionId) 懒启动会话', async () => {
    const { bridge } = installBridge();
    const { result, attachHost, setOpen } = mountHook(false, '/tmp/proj');
    act(() => {
      result.current.openTab();
      attachHost('tab-1');
    });
    expect(result.current.tabs.map((t) => t.id)).toEqual(['tab-1']);
    expect(bridge.startSession).not.toHaveBeenCalled(); // 面板未展开不占资源

    setOpen(true);
    await flush();
    expect(bridge.startSession).toHaveBeenCalledTimes(1);
    expect(bridge.startSession).toHaveBeenCalledWith('/tmp/proj', 'tab-1', undefined);
    expect(result.current.activeId).toBe('tab-1');
    expect(result.current.activeRunning).toBe(true);
  });

  it('多 tab 并存：各自独立启动一次，切换不重启既有会话', async () => {
    const { bridge } = installBridge();
    const { result, openTabAndAttach } = mountHook(true, '/tmp/proj');
    openTabAndAttach(1);
    await flush();
    expect(bridge.startSession).toHaveBeenCalledTimes(1);

    openTabAndAttach(1);
    await flush();
    expect(bridge.startSession).toHaveBeenCalledTimes(2);
    expect(bridge.startSession).toHaveBeenLastCalledWith('/tmp/proj', 'tab-2', undefined);

    act(() => result.current.setActive('tab-1'));
    await flush();
    expect(bridge.startSession).toHaveBeenCalledTimes(2); // 切回 tab-1 不重启
    expect(result.current.activeId).toBe('tab-1');
  });

  it(`上限 4：第 5 个 openTab 诚实拒绝并给出提示`, () => {
    installBridge();
    const { result } = mountHook(false, '/tmp/proj');
    for (let i = 0; i < 4; i += 1) act(() => result.current.openTab());
    expect(result.current.tabs).toHaveLength(4);
    act(() => result.current.openTab());
    expect(result.current.tabs).toHaveLength(4);
    expect(result.current.limitNotice).toContain('最多同时打开 4 个');
  });

  it('terminal:data 按 sessionId 路由到对应 xterm', async () => {
    const { onDataListeners } = installBridge();
    const { openTabAndAttach } = mountHook(true, '/tmp/proj');
    openTabAndAttach(2);
    await flush();

    onDataListeners[0]({ sessionId: 'tab-2', data: 'from-2\n' });
    onDataListeners[0]({ sessionId: 'tab-1', data: 'from-1\n' });
    const term1 = hoisted.FakeXTerm.instances.find(
      (t) => t.open.mock.calls[0]?.[0]?.getAttribute?.('data-tab-body') === 'tab-1'
    );
    const term2 = hoisted.FakeXTerm.instances.find(
      (t) => t.open.mock.calls[0]?.[0]?.getAttribute?.('data-tab-body') === 'tab-2'
    );
    expect(term1?.write).toHaveBeenCalledWith('from-1\n');
    expect(term1?.write).not.toHaveBeenCalledWith('from-2\n');
    expect(term2?.write).toHaveBeenCalledWith('from-2\n');
    expect(term2?.write).not.toHaveBeenCalledWith('from-1\n');
  });

  it('terminal:exit 按 sessionId 标记退出 + 写退出行，不误伤其他 tab', async () => {
    const { onExitListeners } = installBridge();
    const { result, openTabAndAttach } = mountHook(true, '/tmp/proj');
    openTabAndAttach(2);
    await flush();

    act(() => {
      onExitListeners[0]({ sessionId: 'tab-2', code: 0, signal: null });
    });
    await flush();
    expect(result.current.tabs.find((t) => t.id === 'tab-2')?.exited).toBe(true);
    expect(result.current.tabs.find((t) => t.id === 'tab-1')?.exited).toBe(false);
    const term2 = hoisted.FakeXTerm.instances[1];
    const lastWrite = term2.writeln.mock.calls.at(-1)?.[0] as string;
    expect(lastWrite).toContain('进程已退出');
  });

  it('closeTab：停进程 + dispose 实例 + 激活右邻', async () => {
    const { bridge } = installBridge();
    const { result, openTabAndAttach } = mountHook(true, '/tmp/proj');
    openTabAndAttach(3);
    await flush();
    const term2 = hoisted.FakeXTerm.instances[1];

    act(() => result.current.closeTab('tab-2'));
    expect(bridge.stopSession).toHaveBeenCalledWith('tab-2');
    expect(term2.dispose).toHaveBeenCalledTimes(1);
    expect(result.current.tabs.map((t) => t.id)).toEqual(['tab-1', 'tab-3']);
    expect(result.current.activeId).toBe('tab-3');
  });

  it('启动失败：写「启动失败」行、running 不置真', async () => {
    const { bridge } = installBridge();
    bridge.startSession.mockResolvedValueOnce({ ok: false, error: 'no pty' });
    const { result, openTabAndAttach } = mountHook(true, '/tmp/proj');
    openTabAndAttach(1);
    await flush();
    expect(result.current.activeRunning).toBe(false);
    const lastWrite = hoisted.FakeXTerm.instances[0].writeln.mock.calls.at(-1)?.[0] as string;
    expect(lastWrite).toContain('启动失败');
    expect(lastWrite).toContain('no pty');
  });

  it('输入按 tab 携带 sessionId；clear 只作用激活 tab；主题跟随应用', async () => {
    const { bridge } = installBridge();
    const { result, openTabAndAttach } = mountHook(true, '/tmp/proj', 'light');
    openTabAndAttach(2);
    await flush();
    const term1 = hoisted.FakeXTerm.instances[0];
    expect(term1.options.theme).toBe(TERMINAL_THEMES.light);

    act(() => result.current.setActive('tab-2'));
    await flush();
    const term2 = hoisted.FakeXTerm.instances[1];
    term2.onDataEmit('ls\n');
    expect(bridge.writeSession).toHaveBeenLastCalledWith('ls\n', 'tab-2');

    act(() => result.current.clear());
    expect(term2.clear).toHaveBeenCalledTimes(1);
    expect(term1.clear).not.toHaveBeenCalled();
  });

  it('卸载：已启动会话全量 stop + 实例全量 dispose', async () => {
    const { bridge } = installBridge();
    const { openTabAndAttach, unmount } = mountHook(true, '/tmp/proj');
    openTabAndAttach(2);
    await flush();
    unmount();
    expect(bridge.stopSession).toHaveBeenCalledWith('tab-1');
    expect(bridge.stopSession).toHaveBeenCalledWith('tab-2');
    expect(hoisted.FakeXTerm.instances.every((t) => t.dispose.mock.calls.length === 1)).toBe(true);
  });
});
