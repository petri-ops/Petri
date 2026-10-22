// BLOCK-244 Q1-REM — 工具审批策略面板契约。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToolApprovalPanel } from './ToolApprovalPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface PolicyBody {
  modes?: Array<{ name: string; mode: string }>;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function mockFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (!init || !init.method || init.method === 'GET') {
      return Promise.resolve(new Response(JSON.stringify({
        status: 'ok',
        modes: { workspace_exec: 'ask' },
        tools: [
          { name: 'workspace_exec', description: '执行命令', sideEffect: 'execution', riskTier: 'R2' },
          { name: 'workspace_write', description: '写文件', sideEffect: 'workspace-write', riskTier: 'R2' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    const rawBody: unknown = init.body;
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) as PolicyBody : {};
    return Promise.resolve(new Response(JSON.stringify({
      status: 'ok',
      count: body.modes?.length ?? 0,
      modes: body.modes,
      url,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ToolApprovalPanel（BLOCK-244 A1/A8）', () => {
  it('加载模式、搜索过滤、保存非 allow 模式', async () => {
    const fetchMock = mockFetch();
    render(<ToolApprovalPanel />);
    await waitFor(() => expect(screen.getByTestId('tool-approval-row-workspace_exec')).toBeTruthy());
    expect(screen.getByTestId<HTMLSelectElement>('tool-approval-mode-workspace_exec').value).toBe('ask');

    fireEvent.change(screen.getByTestId('tool-approval-mode-workspace_write'), { target: { value: 'deny' } });
    fireEvent.change(screen.getByTestId('tool-approval-search'), { target: { value: 'write' } });
    expect(screen.queryByTestId('tool-approval-row-workspace_exec')).toBeNull();
    expect(screen.getByTestId('tool-approval-row-workspace_write')).toBeTruthy();

    fireEvent.click(screen.getByTestId('tool-approval-save'));
    await waitFor(() => expect(screen.getByTestId('tool-approval-notice').textContent).toContain('已保存'));
    const put = (fetchMock.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>)
      .find(([url, init]) => urlOf(url).endsWith('/ai/tool-approval-policy') && init?.method === 'PUT');
    expect(put).toBeTruthy();
    const rawBody: unknown = put?.[1]?.body;
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) as PolicyBody : {};
    expect(body.modes).toEqual([
      { name: 'workspace_exec', mode: 'ask' },
      { name: 'workspace_write', mode: 'deny' },
    ]);
  });
});
