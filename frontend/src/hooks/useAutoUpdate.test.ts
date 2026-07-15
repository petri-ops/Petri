import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutoUpdate } from '@/hooks/useAutoUpdate';

type MockUpdater = {
  check: () => Promise<{ ok: boolean; hasUpdate?: boolean; version?: string; info?: { version: string }; error?: string }>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  onDownloadProgress?: (fn: (p: { ratio: number }) => void) => () => void;
  onUpdateDownloaded?: (fn: () => void) => () => void;
  onError?: (fn: (msg: string) => void) => () => void;
};

function installMock(mock: MockUpdater) {
  (window as any).biof3Desktop = { updater: mock };
}
function clearMock() {
  delete (window as any).biof3Desktop;
}

describe('useAutoUpdate', () => {
  beforeEach(() => { vi.useFakeTimers(); clearMock(); });
  afterEach(() => { vi.useRealTimers(); clearMock(); });

  // mount auto-check
  it('starts with no update available', async () => {
    installMock({ check: () => Promise.resolve({ ok: true, hasUpdate: false }), download: () => Promise.resolve(), install: () => Promise.resolve() });
    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(result.current.available).toBe(false);
    expect(result.current.availableVersion).toBe('');
    expect(result.current.upToDate).toBe(true);
  });

  it('detects available update on mount', async () => {
    installMock({ check: () => Promise.resolve({ ok: true, hasUpdate: true, info: { version: '2.1.0' } }), download: () => Promise.resolve(), install: () => Promise.resolve() });
    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(result.current.available).toBe(true);
    expect(result.current.availableVersion).toBe('2.1.0');
    expect(result.current.upToDate).toBe(false);
  });

  it('treats thrown mount check as no update', async () => {
    installMock({ check: () => Promise.reject(new Error('net')), download: () => Promise.resolve(), install: () => Promise.resolve() });
    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(result.current.available).toBe(false);
    expect(result.current.upToDate).toBe(false);
  });

  // check action
  it('check() sets checking then false on completion', async () => {
    let resolveCheck!: (v: { ok: boolean; hasUpdate: boolean }) => void;
    installMock({ check: () => new Promise(r => { resolveCheck = r; }), download: () => Promise.resolve(), install: () => Promise.resolve() });
    const { result } = renderHook(() => useAutoUpdate());
    void result.current.check();
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(result.current.checking).toBe(true);
    await act(async () => { resolveCheck({ ok: true, hasUpdate: false }); await vi.runOnlyPendingTimersAsync(); });
    expect(result.current.checking).toBe(false);
  });

  it('check() sets error on non-ok response', async () => {
    installMock({ check: () => Promise.resolve({ ok: false, error: 'timeout' }), download: () => Promise.resolve(), install: () => Promise.resolve() });
    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => { result.current.check(); await vi.runOnlyPendingTimersAsync(); });
    expect(result.current.error).toBe('timeout');
  });

  it('check() clears available when no update found', async () => {
    installMock({ check: () => Promise.resolve({ ok: true, hasUpdate: true, info: { version: '2.0.0' } }), download: () => Promise.resolve(), install: () => Promise.resolve() });
    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(result.current.available).toBe(true);
    installMock({ check: () => Promise.resolve({ ok: true, hasUpdate: false }), download: () => Promise.resolve(), install: () => Promise.resolve() });
    await act(async () => { result.current.check(); await vi.runOnlyPendingTimersAsync(); });
    expect(result.current.available).toBe(false);
    expect(result.current.upToDate).toBe(true);
  });

  // download action
  it('download() sets downloading=true', async () => {
    installMock({ check: () => Promise.resolve({ ok: true, hasUpdate: false }), download: () => new Promise(() => {}), install: () => Promise.resolve() });
    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    void result.current.download();
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(result.current.downloading).toBe(true);
  });

  it('download() sets error via onError event when promise rejects', async () => {
    let errorFn!: (msg: string) => void;
    installMock({
      check: () => Promise.resolve({ ok: true, hasUpdate: false }),
      download: () => Promise.reject(new Error('disk full')),
      install: () => Promise.resolve(),
      onError: fn => { errorFn = fn; return () => {}; },
    });
    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    void result.current.download();
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    // Simulate the updater firing its onError callback synchronously
    await act(async () => { errorFn('disk full'); await vi.runOnlyPendingTimersAsync(); });
    expect(result.current.error).toBe('disk full');
    expect(result.current.downloading).toBe(false);
  });

  // event handlers
  it('onDownloadProgress updates progress', async () => {
    let progressFn!: (p: { ratio: number }) => void;
    installMock({ check: () => Promise.resolve({ ok: true, hasUpdate: false }), download: () => new Promise(() => {}), install: () => Promise.resolve(), onDownloadProgress: fn => { progressFn = fn; return () => {}; } });
    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    void result.current.download();
    await act(async () => { progressFn({ ratio: 0.45 }); await vi.runOnlyPendingTimersAsync(); });
    expect(result.current.progress).toBeCloseTo(0.45);
  });

  it('onUpdateDownloaded sets downloaded=true, downloading=false, progress=1', async () => {
    let doneFn!: () => void;
    installMock({
      check: () => Promise.resolve({ ok: true, hasUpdate: false }),
      // download() never resolves in fake timers; the hook calls
      // updater.onUpdateDownloaded() inline after await resolves, so we
      // fire it manually to simulate the updater event.
      download: () => new Promise(() => {}),
      install: () => Promise.resolve(),
      onUpdateDownloaded: (fn) => {
        doneFn = fn;
        return () => {};
      },
    });
    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    void result.current.download();
    await act(async () => { doneFn(); }); // fire the hook's inline callback
    expect(result.current.downloading).toBe(false);
    expect(result.current.downloaded).toBe(true);
    expect(result.current.progress).toBe(1);
  });

  it('onError sets error and clears in-flight states', async () => {
    let errorFn!: (msg: string) => void;
    installMock({ check: () => Promise.resolve({ ok: true, hasUpdate: false }), download: () => new Promise(() => {}), install: () => Promise.resolve(), onError: fn => { errorFn = fn; return () => {}; } });
    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    void result.current.download();
    await act(async () => { errorFn('corrupt'); await vi.runOnlyPendingTimersAsync(); });
    expect(result.current.error).toBe('corrupt');
    expect(result.current.downloading).toBe(false);
    expect(result.current.installing).toBe(false);
  });

  // install action
  it('install() sets installing=true immediately', async () => {
    installMock({ check: () => Promise.resolve({ ok: true, hasUpdate: false }), download: () => Promise.resolve(), install: () => new Promise(() => {}) });
    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => { result.current.install(); await vi.runOnlyPendingTimersAsync(); });
    expect(result.current.installing).toBe(true);
  });

  it('install() surfaces a rejected installer-open request and clears installing', async () => {
    installMock({
      check: () => Promise.resolve({ ok: true, hasUpdate: false }),
      download: () => Promise.resolve(),
      install: () => Promise.reject(new Error('denied')),
    });
    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => { result.current.install(); await vi.runOnlyPendingTimersAsync(); });
    expect(result.current.error).toBe('denied');
    expect(result.current.installing).toBe(false);
  });

  // no-updater guard
  it('returns safe defaults when updater is absent', async () => {
    clearMock();
    const { result } = renderHook(() => useAutoUpdate());
    expect(result.current.available).toBe(false);
    expect(result.current.downloading).toBe(false);
    expect(result.current.installing).toBe(false);
    await act(async () => { result.current.check(); });
    await act(async () => { result.current.download(); });
    await act(async () => { result.current.install(); });
  });
});
