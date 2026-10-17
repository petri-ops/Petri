// BLOCK-200 P1 验收腿：**改了键位，派发必须跟着变**（显示与派发同源），写失败必须可见。
// 这条是 P0-1 的核心——此前徽章文本与派发事实是两份真相（`⌘N` 徽章全仓无处理器），
// 只测 UI 状态等于没测；所以这里断言的是「按新组合能触发、按旧默认组合不再触发」。
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeymapProvider, useAppKeymapDispatcher, useKeymapSafe } from './appKeymapContext';
import type { KeymapContextValue } from './appKeymapContext';

const originals = new Map<string, PropertyDescriptor | undefined>();
function stubPlatform(value: string): void {
  if (!originals.has('platform')) originals.set('platform', Object.getOwnPropertyDescriptor(window.navigator, 'platform'));
  Object.defineProperty(window.navigator, 'platform', { value, configurable: true });
}

afterEach(() => {
  cleanup();
  fires.length = 0;
  seen = null;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(window.navigator, 'platform', descriptor);
    else delete (window.navigator as unknown as Record<string, unknown>).platform;
  }
  originals.clear();
  vi.unstubAllGlobals();
});

let seen: KeymapContextValue | null = null;
const fires: string[] = [];

function Probe(): React.ReactElement {
  const value = useKeymapSafe();
  seen = value;
  useAppKeymapDispatcher({ 'nav-home': () => { fires.push('nav-home'); } });
  return <div data-testid="sync-state">{value.sync.state}</div>;
}

function response(payload: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => payload } as unknown as Response;
}

function stubFetch(onPut?: (body: unknown) => Response): typeof fetch {
  const impl = vi.fn(async (input: unknown, init?: unknown) => {
    if (init && (init as { method?: string }).method === 'PUT') {
      const body = JSON.parse(String((init as { body: string }).body)) as unknown;
      return onPut ? onPut(body) : response({ status: 'ok', bindings: {} });
    }
    return response({ status: 'ok', bindings: {} });
  });
  vi.stubGlobal('fetch', impl);
  return impl as unknown as typeof fetch;
}

describe('键位注册表运行时面（Provider + App 级派发器）', () => {
  it('盘上覆盖改变生效键位：按新组合触发，按旧默认组合不再触发', async () => {
    stubPlatform('Win32');
    vi.stubGlobal('fetch', vi.fn(async () => response({ status: 'ok', bindings: { 'nav-home': 'Mod+Shift+N' } })));
    render(<KeymapProvider><Probe /></KeymapProvider>);
    await waitFor(() => expect(seen?.bindings['nav-home']).toBe('Mod+Shift+N'));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'N', shiftKey: true, ctrlKey: true }));
    expect(fires).toEqual(['nav-home']);

    const before = fires.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true })); // 旧默认 Mod+N
    expect(fires.length).toBe(before);
  });

  it('写入成功 → sync 回 ok 且覆盖立即生效（本地先生效不等网络）', async () => {
    stubPlatform('Win32');
    stubFetch(() => response({ status: 'ok', bindings: { 'nav-home': 'Mod+Alt+H' } }));
    render(<KeymapProvider><Probe /></KeymapProvider>);
    await waitFor(() => expect(seen?.bindings['nav-home']).toBe('Mod+N'));

    fireEvent.keyDown(window, { key: 'h', altKey: true, ctrlKey: true });
    expect(fires).toHaveLength(0);

    await seen?.save({ 'nav-home': 'Mod+Alt+H' });
    await waitFor(() => expect(seen?.sync.state).toBe('ok'));
    expect(seen?.bindings['nav-home']).toBe('Mod+Alt+H');

    fireEvent.keyDown(window, { key: 'H', altKey: true, ctrlKey: true });
    expect(fires).toContain('nav-home');
  });

  it('写侧 400+diagnostics → sync 显式 failed 并回滚到服务端真相（绝不静默）', async () => {
    stubPlatform('Win32');
    stubFetch(() => response({
      status: 'error',
      error: 'config_value_rejected',
      diagnostics: [{ path: 'nav-home', code: 'not-allowed', message: '语法不符' }],
    }, false));
    render(<KeymapProvider><Probe /></KeymapProvider>);
    await waitFor(() => expect(seen?.sync.state).toBe('ok'));

    await seen?.save({ 'nav-home': 'Mod+Shift+N' });
    await waitFor(() => expect(screen.getByTestId('sync-state').textContent).toBe('failed'));
    expect(seen?.sync.error).toContain('语法不符');
    // 拒写=盘上没变 → 本地那份"以为生效"的覆盖必须收回
    expect(seen?.bindings['nav-home']).toBe('Mod+N');
  });

  it('网络异常同样可见（failed + 错误文本），且仍不影响本端按键', async () => {
    stubPlatform('Win32');
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: unknown) => {
      if (init && (init as { method?: string }).method === 'PUT') throw new Error('ECONNREFUSED');
      return response({ status: 'ok', bindings: {} });
    }));
    render(<KeymapProvider><Probe /></KeymapProvider>);
    await waitFor(() => expect(seen?.sync.state).toBe('ok'));
    await seen?.save({ 'nav-home': 'Mod+Shift+N' });
    await waitFor(() => expect(screen.getByTestId('sync-state').textContent).toBe('failed'));
    expect(seen?.sync.error).toContain('ECONNREFUSED');
  });

  it('无 Provider 不崩并回落命令源默认（弹出窗 /window/* 不挂主窗 Provider 树）', () => {
    stubPlatform('Win32');
    render(<Probe />);
    expect(seen?.bindings['nav-home']).toBe('Mod+N');
    expect(seen?.conflicts).toEqual([]);
  });

  it('冲突可见：两个命令挤同一组合时点名双方（不静默丢一个）', async () => {
    stubPlatform('Win32');
    vi.stubGlobal('fetch', vi.fn(async () => response({ status: 'ok', bindings: { 'nav-home': 'Mod+K' } })));
    render(<KeymapProvider><Probe /></KeymapProvider>);
    await waitFor(() => {
      const conflict = (seen?.conflicts || []).find((row) => row.combo === 'Mod+K');
      expect(conflict?.commandIds.slice().sort()).toEqual(['nav-home', 'palette.toggle']);
    });
  });
});
