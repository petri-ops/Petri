import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComputerUsePanel } from './ComputerUsePanel';

const originalFetch = globalThis.fetch;

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}

function mockFetch(probe: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (url.includes('/computer-use/status')) {
      return await Promise.resolve(new Response(JSON.stringify({
        ok: true,
        platform: 'win32',
        supported: true,
        built: true,
        running: false,
        permissionNote: 'Windows 无需额外系统权限',
      }), { status: 200 }));
    }
    if (init?.method === 'POST' && url.includes('/computer-use/probe')) {
      return await Promise.resolve(new Response(JSON.stringify({ ok: true, probe }), { status: 200 }));
    }
    return await Promise.resolve(new Response('{}', { status: 404 }));
  });
}

beforeEach(() => { globalThis.fetch = originalFetch; });
afterEach(() => { globalThis.fetch = originalFetch; cleanup(); });

describe('ComputerUsePanel', () => {
  it('显示 sidecar 状态；测试连接展示 probe verbs', async () => {
    mockFetch({ platform: 'windows', verbs: ['probe', 'snapshot', 'click'] });
    render(<ComputerUsePanel />);
    await waitFor(() => expect(screen.getByTestId('computer-use-status').textContent).toContain('已构建 是'));
    fireEvent.click(screen.getByText('测试连接'));
    await waitFor(() => expect(screen.getByTestId('computer-use-probe').textContent).toContain('probe / snapshot / click'));
  });

  it('probe 失败显示错误、不假装成功', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (urlOf(input).includes('/status')) {
        return await Promise.resolve(new Response(JSON.stringify({ ok: true, platform: 'win32', supported: true, built: false, running: false }), { status: 200 }));
      }
      return await Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'sidecar_not_built', message: 'sidecar 未构建' }), { status: 503 }));
    });
    render(<ComputerUsePanel />);
    await waitFor(() => expect(screen.getByTestId('computer-use-status').textContent).toContain('已构建 否'));
    fireEvent.click(screen.getByText('测试连接'));
    await waitFor(() => expect(screen.getByTestId('computer-use-error').textContent).toContain('未构建'));
    expect(screen.queryByTestId('computer-use-probe')).toBeNull();
  });
});
