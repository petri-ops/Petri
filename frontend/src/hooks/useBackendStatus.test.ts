import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBackendStatus } from '@/hooks/useBackendStatus';
import type { BackendStatus } from '@/lib/electron';

type Status = { ready: boolean; services: { name: string }[] };

function installMock(status: Status | null, opts: { throw?: boolean } = {}) {
  (window as any).biof3Desktop = {
    backend: {
      status: opts.throw
        ? () => Promise.reject(new Error('ipc failed'))
        : () => Promise.resolve(status) as unknown as Promise<BackendStatus>,
    },
  };
}

describe('useBackendStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).biof3Desktop;
  });

  it('returns the resolved status on the first poll', async () => {
    const expected: Status = { ready: true, services: [{ name: 'r' }] };
    installMock(expected);
    const { result } = renderHook(() => useBackendStatus());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(result.current).toEqual(expected);
  });

  it('clears to null when the IPC throws', async () => {
    installMock(null, { throw: true });
    const { result } = renderHook(() => useBackendStatus());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(result.current).toBeNull();
  });

  it('re-polls at the configured interval (10s)', async () => {
    const calls: number[] = [];
    let n = 0;
    (window as any).biof3Desktop = {
      backend: {
        status: () => {
          calls.push(++n);
          return Promise.resolve({ ready: n > 0, services: [] }) as unknown as Promise<BackendStatus>;
        },
      },
    };
    renderHook(() => useBackendStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.length).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(calls.length).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(calls.length).toBe(3);
  });
});