/**
 * BLOCK-156 P2 — McpShelfPane 测试。
 * 钉住：server 卡片状态/工具计数呈现、添加表单校验与提交流、连接动作流。
 * fetch 全 mock（后端 HTTP 数据面）。
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpShelfPane } from './McpShelfPane';

type FetchMock = ReturnType<typeof vi.fn>;

interface DraftBody {
  id?: string;
  command?: string;
  args?: string[];
  autoConnect?: boolean;
}

function withServers(servers: unknown[]): FetchMock {
  const mock: FetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(new Response('ok', { status: 200 })).then((): Response => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const rawBody = init?.body;
      const body: DraftBody =
        typeof rawBody === 'string' ? (JSON.parse(rawBody) as DraftBody) : {};
      if (url.endsWith('/mcp/servers') && method === 'GET') {
        return new Response(JSON.stringify({ status: 'ok', servers }), { status: 200 });
      }
      if (url.endsWith('/mcp/servers') && method === 'POST') {
        if (!body.id || !body.command) {
          return new Response(JSON.stringify({ status: 'error', error: 'missing_command' }), { status: 400 });
        }
        return new Response(JSON.stringify({ status: 'ok', server: body }), { status: 200 });
      }
      if (/\/mcp\/servers\/[^/]+\/connect$/.test(url)) {
        return new Response(JSON.stringify({ status: 'ok', toolCount: 3 }), { status: 200 });
      }
      if (/\/mcp\/servers\/[^/]+\/disconnect$/.test(url)) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (/\/mcp\/servers\/[^/]+$/.test(url) && method === 'DELETE') {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'error', error: `unmocked ${method} ${url}` }), { status: 500 });
    }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'fixture',
  command: 'node',
  args: ['server.js'],
  env: {},
  autoConnect: true,
  status: 'disconnected',
  error: null,
  toolCount: 0,
  connectedAt: null,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BLOCK-156 McpShelfPane', () => {
  it('空清单呈现空态 + 添加入口；表单校验（空 ID/非法 ID/空命令拒绝）', async () => {
    withServers([]);
    render(<McpShelfPane />);
    await waitFor(() => expect(screen.getByTestId('mcp-empty')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mcp-add-toggle'));
    fireEvent.change(screen.getByLabelText('server ID'), { target: { value: 'a b' } });
    fireEvent.change(screen.getByLabelText('启动命令'), { target: { value: 'node' } });
    fireEvent.click(screen.getByTestId('mcp-form-submit'));
    expect(screen.getByText('ID 不能为空，且不含空格/斜杠')).toBeTruthy();
    expect(screen.getByTestId('mcp-add-form')).toBeTruthy(); // 未提交成功表单仍开
  });

  it('server 卡片：已连接态呈现工具计数 + 断开钮；错误态呈现错误信息', async () => {
    withServers([
      row({ id: 'ok-srv', status: 'connected', toolCount: 5 }),
      row({ id: 'bad-srv', status: 'error', error: 'spawn ENOENT' }),
    ]);
    render(<McpShelfPane />);
    await waitFor(() => expect(screen.getByTestId('mcp-card-ok-srv')).toBeTruthy());
    expect(screen.getByTestId('mcp-card-ok-srv').getAttribute('data-status')).toBe('connected');
    expect(screen.getByText('5 个工具')).toBeTruthy();
    expect(screen.getByTestId('mcp-disconnect-ok-srv')).toBeTruthy();
    expect(screen.getByTestId('mcp-card-bad-srv').getAttribute('data-status')).toBe('error');
    expect(screen.getByTitle('spawn ENOENT')).toBeTruthy();
  });

  it('连接动作流：点击连接 → POST connect → notice 带工具数 → 刷新回读', async () => {
    const mock = withServers([row({ id: 'go', status: 'disconnected' })]);
    render(<McpShelfPane />);
    await waitFor(() => expect(screen.getByTestId('mcp-connect-go')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mcp-connect-go'));
    await waitFor(() => expect(screen.getByTestId('mcp-notice')).toBeTruthy());
    expect(screen.getByTestId('mcp-notice').textContent).toContain('已连接 go（3 个工具）');
    const calls = (mock.mock.calls as Array<[string, RequestInit | undefined]>)
      .filter(([u, i]) => String(u).endsWith('/connect') && i?.method === 'POST');
    expect(calls.length).toBe(1);
  });

  it('添加流：合法表单提交 POST /mcp/servers（args 空白切分）', async () => {
    const mock = withServers([]);
    render(<McpShelfPane />);
    await waitFor(() => expect(screen.getByTestId('mcp-empty')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mcp-add-toggle'));
    fireEvent.change(screen.getByLabelText('server ID'), { target: { value: 'fs' } });
    fireEvent.change(screen.getByLabelText('启动命令'), { target: { value: 'npx' } });
    fireEvent.change(screen.getByLabelText('参数'), { target: { value: '-y  @mcp/fs  /tmp' } });
    fireEvent.click(screen.getByTestId('mcp-form-submit'));
    await waitFor(() => expect(screen.getByTestId('mcp-notice').textContent).toContain('已添加 fs'));
    const posts = (mock.mock.calls as Array<[string, RequestInit | undefined]>)
      .filter(([u, i]) => String(u).endsWith('/mcp/servers') && i?.method === 'POST');
    const rawBody = posts[0][1]?.body;
    const body: DraftBody = typeof rawBody === 'string' ? (JSON.parse(rawBody) as DraftBody) : {};
    expect(body.id).toBe('fs');
    expect(body.args).toEqual(['-y', '@mcp/fs', '/tmp']);
    expect(body.autoConnect).toBe(false);
  });
});
