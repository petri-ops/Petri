import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAutoModelPreference } from './useAutoModelPreference';

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return await handler(url, init);
  });
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('useAutoModelPreference', () => {
  it('读取 autoModel=true，写入后调用 PUT 并保持本端状态', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      calls.push({ url, init });
      if (!init || init.method !== 'PUT') {
        return new Response(JSON.stringify({ ok: true, prefs: { autoModel: true } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { result } = renderHook(() => useAutoModelPreference());
    await waitFor(() => expect(result.current.autoModel).toBe(true));
    await act(async () => { await result.current.setAutoModel(false); });
    expect(result.current.autoModel).toBe(false);
    expect(result.current.error).toBeNull();
    const put = calls.find((call) => call.init?.method === 'PUT');
    expect(put?.url).toContain('/user/prefs');
    const body = put?.init?.body;
    if (typeof body !== 'string') throw new Error('expected JSON string body');
    expect(JSON.parse(body)).toEqual({ autoModel: false });
  });

  it('写失败保留本机切换并给出可见错误', async () => {
    mockFetch((_url, init) => {
      if (init?.method === 'PUT') return new Response('boom', { status: 500 });
      return new Response(JSON.stringify({ prefs: {} }), { status: 200 });
    });
    const { result } = renderHook(() => useAutoModelPreference());
    await waitFor(() => expect(result.current.autoModel).toBe(false));
    await act(async () => { await result.current.setAutoModel(true); });
    expect(result.current.autoModel).toBe(true);
    expect(result.current.error).toContain('未能同步');
  });
});
