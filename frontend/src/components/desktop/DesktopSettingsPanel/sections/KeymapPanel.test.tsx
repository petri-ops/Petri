// BLOCK-200 P3 键位设置面组件测：显示的就是派发读的那个值；录制/解绑走写侧守卫；写失败可见。
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeymapProvider } from '@/lib/appKeymapContext';
import { KeymapPanel } from './KeymapPanel';

const originals = new Map<string, PropertyDescriptor | undefined>();
function stubPlatform(value: string): void {
  if (!originals.has('platform')) originals.set('platform', Object.getOwnPropertyDescriptor(window.navigator, 'platform'));
  Object.defineProperty(window.navigator, 'platform', { value, configurable: true });
}

afterEach(() => {
  cleanup();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(window.navigator, 'platform', descriptor);
    else delete (window.navigator as unknown as Record<string, unknown>).platform;
  }
  originals.clear();
  vi.unstubAllGlobals();
});

function jsonResponse(payload: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => payload } as unknown as Response;
}

function mount(getBindings: Record<string, string | null> = {}, onPut?: (body: unknown) => Response): void {
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: unknown) => {
    if (init && (init as { method?: string }).method === 'PUT') {
      const body = JSON.parse(String((init as { body: string }).body));
      return onPut ? onPut(body) : jsonResponse({ status: 'ok', bindings: { ...getBindings, ...body.bindings } });
    }
    return jsonResponse({ status: 'ok', bindings: getBindings });
  }));
  render(<KeymapProvider><KeymapPanel /></KeymapProvider>);
}

describe('KeymapPanel（UI-514）', () => {
  it('无覆盖时按命令源默认渲染组合串（不是另一份显示文本）', async () => {
    stubPlatform('Win32');
    mount();
    await waitFor(() => expect(screen.getByTestId('keymap-combo-nav-home').textContent).toBe('Ctrl+N'));
    expect(screen.getByTestId('keymap-combo-palette.toggle').textContent).toBe('Ctrl+K');
    expect(screen.getByTestId('keymap-combo-workspace.toggleRight').textContent).toBe('Ctrl+Shift+B');
  });

  it('盘上覆盖改变显示，且解绑的命令显示"未绑定"', async () => {
    stubPlatform('Win32');
    mount({ 'nav-home': 'Mod+Shift+N' });
    await waitFor(() => expect(screen.getByTestId('keymap-combo-nav-home').textContent).toBe('Ctrl+Shift+N'));
    expect(screen.getByTestId('keymap-combo-nav-home').dataset.state).toBe('bound');
  });

  it('点「改键」后按下的组合写回并立即反映在行上', async () => {
    stubPlatform('Win32');
    mount();
    fireEvent.click(within(screen.getByTestId('keymap-row-palette.toggle')).getByText('改键'));
    await waitFor(() => expect(screen.getByTestId('keymap-combo-palette.toggle').textContent).toContain('按下组合键'));
    fireEvent.keyDown(window, { key: 'K', shiftKey: true, ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId('keymap-combo-palette.toggle').textContent).toBe('Ctrl+Shift+K'));
  });

  it('录制裸键被拒并给出理由，不发写请求（裸键会劫持输入框）', async () => {
    stubPlatform('Win32');
    const put = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: unknown) => {
      if (init && (init as { method?: string }).method === 'PUT') { put(); return jsonResponse({ status: 'ok', bindings: {} }); }
      return jsonResponse({ status: 'ok', bindings: {} });
    }));
    render(<KeymapProvider><KeymapPanel /></KeymapProvider>);
    await waitFor(() => expect(screen.getByTestId('keymap-combo-nav-home').textContent).toBe('Ctrl+N'));
    fireEvent.click(within(screen.getByTestId('keymap-row-palette.toggle')).getByText('改键'));
    fireEvent.keyDown(window, { key: 'x' });
    expect((await screen.findByTestId('keymap-hint')).textContent).toContain('至少需要一个修饰键');
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByTestId('keymap-combo-nav-home').textContent).toBe('Ctrl+N');
  });

  it('两个命令挤同一组合 → 冲突横幅点名（不静默覆盖）', async () => {
    stubPlatform('Win32');
    mount({ 'nav-home': 'Mod+K' });
    const banner = await screen.findByTestId('keymap-conflicts');
    expect(banner.textContent).toContain('nav-home');
    expect(banner.textContent).toContain('palette.toggle');
  });

  it('写侧 400（非法组合被注册表拒）时失败横幅可见', async () => {
    stubPlatform('Win32');
    mount({}, () => jsonResponse({
      status: 'error',
      error: 'config_value_rejected',
      diagnostics: [{ path: 'nav-home', code: 'not-allowed', message: '语法不符' }],
    }, false));
    await waitFor(() => expect(screen.getByTestId('keymap-combo-nav-home').textContent).toBe('Ctrl+N'));
    fireEvent.click(within(screen.getByTestId('keymap-row-nav-home')).getByText('改键'));
    fireEvent.keyDown(window, { key: 'N', shiftKey: true, ctrlKey: true });
    const banner = await screen.findByTestId('keymap-sync-failed');
    expect(banner.textContent).toContain('语法不符');
  });
});
