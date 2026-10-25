import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CrashNoticeBanner } from './CrashNoticeBanner';

const originalFetch = globalThis.fetch;

function installBridge(status: Record<string, unknown>, summary?: Record<string, unknown>) {
  (window as unknown as { petriDesktop: unknown }).petriDesktop = {
    diagnostic: {
      crashStatus: vi.fn().mockResolvedValue({ ok: true, ...status }),
      crashOpenDumps: vi.fn().mockResolvedValue({ ok: true }),
      crashDumpSummary: vi.fn().mockResolvedValue(summary || { ok: false, error: 'unavailable' }),
    },
  };
}

function mockPrefs(prefs: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async () => await Promise.resolve(new Response(JSON.stringify({ prefs }), { status: 200 })));
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
  delete (window as unknown as { petriDesktop?: unknown }).petriDesktop;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete (window as unknown as { petriDesktop?: unknown }).petriDesktop;
  cleanup();
});

describe('CrashNoticeBanner', () => {
  it('异常退出 + 有转储：显示时间/文件名，可打开目录并关闭', async () => {
    installBridge({
      uncleanExit: true,
      previousStartedAt: '2026-10-21T01:00:00.000Z',
      dumps: [{ name: 'abc.dmp', size: 10, mtime: '2026-10-21T01:00:00.000Z' }],
    });
    mockPrefs({ crashNotice: true });
    render(<CrashNoticeBanner />);
    await waitFor(() => expect(screen.getByTestId('crash-notice')).not.toBeNull());
    expect(screen.getByTestId('crash-notice').textContent).toContain('abc.dmp');
    fireEvent.click(screen.getByText('打开崩溃目录'));
    expect((window as unknown as { petriDesktop: { diagnostic: { crashOpenDumps: ReturnType<typeof vi.fn> } } }).petriDesktop.diagnostic.crashOpenDumps).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('crash-notice-dismiss'));
    expect(screen.queryByTestId('crash-notice')).toBeNull();
  });

  it('干净退出不显示；偏好关闭也不显示', async () => {
    installBridge({ uncleanExit: false });
    mockPrefs({ crashNotice: true });
    const { rerender } = render(<CrashNoticeBanner />);
    await waitFor(() => expect(screen.queryByTestId('crash-notice')).toBeNull());

    installBridge({ uncleanExit: true, dumps: [] });
    mockPrefs({ crashNotice: false });
    rerender(<CrashNoticeBanner />);
    await waitFor(() => expect(screen.queryByTestId('crash-notice')).toBeNull());
  });

  it('BLOCK-260 K2 — 本地摘要与详情：模块/架构/异常可见；解析失败如实说明', async () => {
    installBridge({
      uncleanExit: true,
      dumps: [{ name: 'abc.dmp', size: 10, mtime: '2026-10-21T01:00:00.000Z' }],
    }, {
      ok: true,
      name: 'abc.dmp',
      modules: [{ name: 'petri.exe', size: 4096 }],
      exception: { threadId: 7, code: '0xc0000005', address: '0x140001234' },
      system: { arch: 'x64', processors: 8, osVersion: '10.0.26100' },
      processId: 4242,
    });
    mockPrefs({ crashNotice: true });
    const { unmount } = render(<CrashNoticeBanner />);
    await waitFor(() => expect(screen.getByTestId('crash-notice').textContent).toContain('1 个模块 · x64 10.0.26100 · 异常 0xc0000005'));
    fireEvent.click(screen.getByTestId('crash-notice-details-toggle'));
    expect(screen.getByTestId('crash-notice-details').textContent).toContain('petri.exe');
    expect(screen.getByTestId('crash-notice-details').textContent).toContain('进程 4242');
    unmount();

    installBridge({
      uncleanExit: true,
      dumps: [{ name: 'bad.dmp', size: 1, mtime: '2026-10-21T01:00:00.000Z' }],
    }, { ok: false, error: 'bad_signature' });
    render(<CrashNoticeBanner />);
    await waitFor(() => expect(screen.getByTestId('crash-notice').textContent).toContain('摘要不可用（bad_signature）'));
  });
});
