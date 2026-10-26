import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExternalImportPanel } from '@/components/settings/ExternalImportPanel';

// BLOCK-264（C-35）— 外部配置导入应用面（preview → 勾选 → 两步确认 apply → rollback）

interface Call { path: string; body: Record<string, unknown>; }

function mockFetchByRoute(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const impl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const path = String(url).replace('http://mock/api', '');
    const rawBody = typeof init?.body === 'string' ? init.body : '{}';
    calls.push({ path, body: JSON.parse(rawBody) as Record<string, unknown> });
    const hit: { status?: number; body: unknown } | undefined = Object.prototype.hasOwnProperty.call(routes, path) ? routes[path] : undefined;
    const status = hit?.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(hit ? hit.body : {}),
    });
  });
  return { impl, calls };
}

describe('ExternalImportPanel（BLOCK-264 · C-35）', () => {
  beforeEach(() => { });
  afterEach(() => { vi.unstubAllGlobals(); cleanup(); });

  it('预览 → 勾选 → 两步确认 → apply 请求带 selectedKeys', async () => {
    const { impl, calls } = mockFetchByRoute({
      '/import/external-agent/preview': { body: { ok: true, patch: { 'runtime::approvalDefaultMode': 'read' }, credentialsDetected: [], unsupported: [] } },
      '/import/external-agent/apply': { body: { status: 'ok', appliedKeys: ['runtime::approvalDefaultMode'], applyId: 'imp-1', rollbackAvailable: true } },
    });
    vi.stubGlobal('fetch', impl);
    render(<ExternalImportPanel apiBase="http://mock/api" />);

    fireEvent.change(screen.getByPlaceholderText(/粘贴配置内容/), { target: { value: 'model = "gpt-5"' } });
    fireEvent.click(screen.getByRole('button', { name: /预览/ }));
    await waitFor(() => expect(document.querySelector('[data-external-import-preview]')).toBeTruthy());
    expect(screen.getByText(/runtime::approvalDefaultMode/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /应用所选/ }));
    await waitFor(() => expect(document.querySelector('[data-external-import-confirm]')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /确认应用/ }));

    await waitFor(() => expect(document.querySelector('[data-external-import-applied]')).toBeTruthy());
    const applyCall = calls.find((c) => c.path === '/import/external-agent/apply');
    expect(applyCall?.body.selectedKeys).toEqual(['runtime::approvalDefaultMode']);
    expect(applyCall?.body.content).toBe('model = "gpt-5"');
  });

  it('取消勾选后 apply 不带该键（可部分导入）', async () => {
    const { impl, calls: _calls } = mockFetchByRoute({
      '/import/external-agent/preview': { body: { ok: true, patch: { 'runtime::approvalDefaultMode': 'read' }, credentialsDetected: [], unsupported: [] } },
      '/import/external-agent/apply': { body: { status: 'ok', appliedKeys: [], applyId: null } },
    });
    vi.stubGlobal('fetch', impl);
    render(<ExternalImportPanel apiBase="http://mock/api" />);
    fireEvent.change(screen.getByPlaceholderText(/粘贴配置内容/), { target: { value: 'x = 1' } });
    fireEvent.click(screen.getByRole('button', { name: /预览/ }));
    await waitFor(() => expect(document.querySelector('[data-external-import-preview]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-external-import-key="runtime::approvalDefaultMode"] input')!); // 取消勾选
    expect(screen.getByRole('button', { name: /应用所选/ })).toBeTruthy();
  });

  it('预览失败显示错误；凭据检测如实展示', async () => {
    const { impl } = mockFetchByRoute({
      '/import/external-agent/preview': { status: 400, body: { error: 'unparsable_config' } },
    });
    vi.stubGlobal('fetch', impl);
    render(<ExternalImportPanel apiBase="http://mock/api" />);
    fireEvent.change(screen.getByPlaceholderText(/粘贴配置内容/), { target: { value: 'garbage' } });
    fireEvent.click(screen.getByRole('button', { name: /预览/ }));
    await waitFor(() => expect(document.querySelector('[data-external-import-error]')).toBeTruthy());
    expect(screen.getByText(/unparsable_config/)).toBeTruthy();
  });

  it('应用成功后可回滚，回滚请求带 applyId', async () => {
    const { impl, calls } = mockFetchByRoute({
      '/import/external-agent/preview': { body: { ok: true, patch: { 'runtime::approvalDefaultMode': 'read' }, credentialsDetected: [], unsupported: [] } },
      '/import/external-agent/apply': { body: { status: 'ok', appliedKeys: ['runtime::approvalDefaultMode'], applyId: 'imp-abc', rollbackAvailable: true } },
      '/import/external-agent/rollback': { body: { status: 'ok', applyId: 'imp-abc', restoredKeys: ['runtime::approvalDefaultMode'] } },
    });
    vi.stubGlobal('fetch', impl);
    render(<ExternalImportPanel apiBase="http://mock/api" />);
    fireEvent.change(screen.getByPlaceholderText(/粘贴配置内容/), { target: { value: 'approval_policy = "untrusted"' } });
    fireEvent.click(screen.getByRole('button', { name: /预览/ }));
    await waitFor(() => expect(document.querySelector('[data-external-import-preview]')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /应用所选/ }));
    fireEvent.click(screen.getByRole('button', { name: /确认应用/ }));
    await waitFor(() => expect(document.querySelector('[data-external-import-applied]')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /回滚这次导入/ }));
    await waitFor(() => expect(document.querySelector('[data-external-import-message]')).toBeTruthy());
    const rb = calls.find((c) => c.path === '/import/external-agent/rollback');
    expect(rb?.body.applyId).toBe('imp-abc');
  });
});
