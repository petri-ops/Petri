/**
 * BLOCK-199 P4③ — 跨端偏好同步失败必须可见（原状 `void fetch(...).catch(()=>{})` 静默）。
 *
 * 钉三条：①成功同步回到 ok；②失败进入 failed 且带原因（网络异常与 HTTP 非 2xx 两种都算）；
 * ③**本端仍立即生效**——这是既有体验契约，可见性不得变成"失败就回滚"。
 */
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeProvider';

type FetchMock = { mock: { calls: [string, RequestInit | undefined][] } };

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

const matchMediaStub = () => vi.fn(() => ({
  matches: false,
  media: '(prefers-color-scheme: dark)',
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

function stubFetch(handler: () => Promise<Response>) {
  vi.stubGlobal('matchMedia', matchMediaStub());
  vi.stubGlobal('fetch', vi.fn(handler));
}

/** 在 act 内触发一次变更并让微任务落定（fetch 的 then/catch 里 setState）。 */
async function applyChange(change: () => void) {
  await act(async () => {
    change();
    await Promise.resolve();
  });
}

/** 冲刷 promise 微任务（fetch 的 then/catch 里 setState）。 */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const okResponse = () => Promise.resolve({ ok: true, status: 200 } as Response);
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

beforeEach(() => {
  localStorage.clear();
  warnSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('ThemeProvider 跨端同步可观测性', () => {
  it('同步成功：prefsSync 回到 ok，且确实发出了 PUT（带偏好载荷）', async () => {
    stubFetch(okResponse);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.prefsSync.state).toBe('ok');

    await applyChange(() => { result.current.setPreference('dark'); });
    expect(fetch).toHaveBeenCalled();
    // 挂载时会先 GET 拉服务端偏好，PUT 是随后的那一次
    const putCall = (fetch as unknown as FetchMock).mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(putCall).toBeTruthy();
    expect(JSON.parse((putCall?.[1]?.body as string) ?? '')).toEqual({ theme: 'dark' });
    await flush();
    expect(result.current.prefsSync.state).toBe('ok');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('网络异常：进入 failed + 留痕，但本端偏好不回滚', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => useTheme(), { wrapper });

    await applyChange(() => { result.current.setPreference('dark'); });
    await flush();

    expect(result.current.prefsSync.state).toBe('failed');
    expect(result.current.prefsSync.error).toMatch(/Failed to fetch/);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('服务端同步失败'));
    // 本端已生效（可见性不得变成回滚）
    expect(result.current.preference).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('HTTP 非 2xx：同样进入 failed 并带状态码（服务端拒绝不是"成功"）', async () => {
    stubFetch(() => Promise.resolve({ ok: false, status: 503 } as Response));
    const { result } = renderHook(() => useTheme(), { wrapper });

    await applyChange(() => { result.current.setFontScale(1.2); });
    await flush();

    expect(result.current.prefsSync.state).toBe('failed');
    expect(result.current.prefsSync.error).toContain('503');
    expect(result.current.fontScale).toBe(1.2);
  });

  it('后续同步成功会把状态从 failed 翻回 ok（不留陈旧告警）', async () => {
    let offline = true;
    stubFetch(() => (offline ? Promise.reject(new TypeError('offline')) : okResponse()));
    const { result } = renderHook(() => useTheme(), { wrapper });

    await applyChange(() => { result.current.setPreference('light'); });
    await flush();
    expect(result.current.prefsSync.state).toBe('failed');

    offline = false;
    await applyChange(() => { result.current.setPreference('dark'); });
    await flush();
    expect(result.current.prefsSync.state).toBe('ok');
    expect(result.current.prefsSync.error).toBeUndefined();
  });
});
