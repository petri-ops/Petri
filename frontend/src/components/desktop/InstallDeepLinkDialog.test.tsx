import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InstallDeepLinkDialog } from './InstallDeepLinkDialog';
import { getBridge } from '@/lib/desktopBridge';

vi.mock('@/lib/desktopBridge', () => ({ getBridge: vi.fn() }));
const mockedGetBridge = vi.mocked(getBridge);

const LINK = 'petri-install://pack?manifest=https%3A%2F%2Fexample.com%2Fm.json';
const PREVIEW = {
  kind: 'pack' as const,
  link: LINK,
  source: { host: 'example.com', url: 'https://example.com/m.json' },
  pack: {
    packId: 'demo-pack',
    name: 'Demo Pack',
    version: '1.0.0',
    description: null,
    source: null,
    archive: { url: 'https://example.com/p.zip', sizeBytes: 1024, sha256: 'a'.repeat(64) },
    mcpServers: [{ id: 'collide-mcp', name: 'collide-mcp', transport: 'stdio' as const, command: 'node', args: [] }],
  },
  risk: { level: 'caution' as const, reasons: ['unverified_source', 'replaces_mcp:collide-mcp'] },
  requiresReplace: { pack: false, mcp: ['collide-mcp'] },
};

function bridge(overrides: Record<string, unknown> = {}) {
  return {
    preview: vi.fn(() => ({ ok: true, preview: PREVIEW })),
    confirm: vi.fn((payload: { url: string; allowReplaceMcp?: boolean; expected?: { archive?: { url: string; sha256: string; sizeBytes?: number | null } } }) => ({
      ok: true as const,
      kind: 'pack' as const,
      packId: 'demo-pack',
      _payload: payload,
    })),
    onDeepLink: vi.fn(() => () => undefined),
    pending: vi.fn(() => Promise.resolve({ url: null })),
    ...overrides,
  };
}

beforeEach(() => {
  mockedGetBridge.mockReturnValue(bridge() as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BLOCK-242 InstallDeepLinkDialog', () => {
  it('粘贴链接 → 只读预览字段/风险/替换警告 → 勾选后确认安装', async () => {
    const current = bridge();
    mockedGetBridge.mockReturnValue(current as never);
    render(<InstallDeepLinkDialog />);

    window.dispatchEvent(new CustomEvent('petri:open-install-deep-link'));
    fireEvent.change(await screen.findByTestId('install-deep-link-url'), { target: { value: LINK } });
    fireEvent.click(screen.getByTestId('install-deep-link-preview-button'));

    await waitFor(() => expect(screen.getByTestId('install-deep-link-preview')).toBeTruthy());
    expect(current.preview).toHaveBeenCalledWith(LINK);
    expect(screen.getByText(/Demo Pack/)).toBeTruthy();
    expect(screen.getAllByText(/example\.com/).length).toBeGreaterThan(0);
    expect(screen.getByText(/1\.0 KB/)).toBeTruthy();
    expect(screen.getByText(/来源未验证/)).toBeTruthy();
    expect(screen.getByText(/将替换已有 MCP 配置 collide-mcp/)).toBeTruthy();

    const install = screen.getByTestId<HTMLButtonElement>('install-deep-link-install');
    expect(install.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('install-deep-link-replace-mcp'));
    await waitFor(() => expect(install.disabled).toBe(false));
    fireEvent.click(install);
    await waitFor(() => expect(current.confirm).toHaveBeenCalledTimes(1));
    const payload = current.confirm.mock.calls[0][0];
    expect(payload.url).toBe(LINK);
    expect(payload.allowReplaceMcp).toBe(true);
    expect(payload.expected?.archive).toEqual({
      url: 'https://example.com/p.zip',
      sha256: 'a'.repeat(64),
      sizeBytes: 1024,
    });
    await waitFor(() => expect(screen.getByTestId('install-deep-link-result').textContent).toContain('安装完成'));
  });

  it('被守卫拒绝时只显示原因，不出现安装按钮', async () => {
    const current = bridge({
      preview: vi.fn(() => ({ ok: false, error: 'manifest_scheme_blocked', message: 'manifest 必须是 https' })),
    });
    mockedGetBridge.mockReturnValue(current as never);
    render(<InstallDeepLinkDialog />);

    window.dispatchEvent(new CustomEvent('petri:open-install-deep-link', { detail: { url: 'petri-install://pack?manifest=http%3A%2F%2Fx' } }));
    await waitFor(() => expect(screen.getByTestId('install-deep-link-error')).toBeTruthy());
    expect(screen.getByTestId('install-deep-link-error').textContent).toContain('manifest_scheme_blocked');
    expect(screen.queryByTestId('install-deep-link-install')).toBeNull();
  });
});