import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRoleRevealPreference } from './useRoleRevealPreference';

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return await handler(url, init);
  });
}

beforeEach(() => { globalThis.fetch = originalFetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

describe('useRoleRevealPreference', () => {
  it('roleRevealSeen=false → 展示；dismiss 写回 true 并关闭', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      calls.push({ url, init });
      if (init?.method === 'PUT') return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify({ prefs: { roleRevealSeen: false } }), { status: 200 });
    });
    const { result } = renderHook(() => useRoleRevealPreference());
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(async () => { await result.current.dismiss(); });
    expect(result.current.visible).toBe(false);
    const put = calls.find((call) => call.init?.method === 'PUT');
    const body = put?.init?.body;
    if (typeof body !== 'string') throw new Error('expected JSON string body');
    expect(JSON.parse(body)).toEqual({ roleRevealSeen: true });
  });

  it('roleRevealSeen=true → 不展示', async () => {
    mockFetch(() => new Response(JSON.stringify({ prefs: { roleRevealSeen: true } }), { status: 200 }));
    const { result } = renderHook(() => useRoleRevealPreference());
    await waitFor(() => expect(result.current.visible).toBe(false));
  });

  it('读取失败 → 不展示（未知不等于首次）', async () => {
    mockFetch(() => new Response('boom', { status: 500 }));
    const { result } = renderHook(() => useRoleRevealPreference());
    await waitFor(() => expect(result.current.visible).toBe(false));
  });

  it('写回失败 → 本端关闭且错误可见', async () => {
    mockFetch((_url, init) => {
      if (init?.method === 'PUT') return new Response('boom', { status: 500 });
      return new Response(JSON.stringify({ prefs: {} }), { status: 200 });
    });
    const { result } = renderHook(() => useRoleRevealPreference());
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(async () => { await result.current.dismiss(); });
    expect(result.current.visible).toBe(false);
    expect(result.current.error).toContain('未能记录');
  });
});
