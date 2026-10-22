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
  transport?: 'stdio' | 'http';
  url?: string;
  allow?: string[];
  block?: string[];
  trust?: 'ask' | 'allow';
}

function withServers(
  servers: unknown[],
  putPolicy?: (body: DraftBody) => Response,
): FetchMock {
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
      if (/\/mcp\/servers\/[^/]+\/authenticate$/.test(url) && method === 'POST') {
        return new Response(JSON.stringify({
          status: 'redirect',
          authorizationUrl: 'https://auth.example/authorize?state=abc',
        }), { status: 200 });
      }
      if (/\/mcp\/servers\/[^/]+\/policy$/.test(url) && method === 'PUT') {
        if (putPolicy) return putPolicy(body);
        return new Response(JSON.stringify({
          status: 'ok',
          serverId: 'fixture',
          policy: { trust: 'ask', allow: body.allow ?? [], block: body.block ?? [] },
          diagnostics: [],
        }), { status: 200 });
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
  envKeys: [],
  envCount: 0,
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
  vi.restoreAllMocks();
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

  it('BLOCK-239 — HTTP server 需要授权时显示 url 与授权入口，点击打开浏览器', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const mock = withServers([row({
      id: 'oauth-srv',
      transport: 'http',
      url: 'http://127.0.0.1:9999/mcp',
      status: 'auth_required',
      auth: 'required',
      command: 'ignored',
      args: [],
    })]);
    render(<McpShelfPane />);
    await waitFor(() => expect(screen.getByTestId('mcp-card-oauth-srv')).toBeTruthy());
    expect(screen.getByText('http://127.0.0.1:9999/mcp')).toBeTruthy();
    expect(screen.getByTestId('mcp-card-oauth-srv').textContent).toContain('需要授权');

    fireEvent.click(screen.getByTestId('mcp-authenticate-oauth-srv'));
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    expect(openSpy.mock.calls[0][0]).toBe('https://auth.example/authorize?state=abc');
    await waitFor(() => expect(screen.getByTestId('mcp-auth-url')).toBeTruthy());
    const posts = (mock.mock.calls as Array<[string, RequestInit | undefined]>)
      .filter(([u, i]) => /\/authenticate$/.test(String(u)) && i?.method === 'POST');
    expect(posts).toHaveLength(1);
  });

  it('BLOCK-241 — 大目录显示目录模式与按需工具数', async () => {
    withServers([row({
      id: 'many-srv',
      status: 'connected',
      toolCount: 6,
      policy: {
        trust: 'ask', allowCount: 0, blockCount: 0, allow: [], block: [],
        projectedToolCount: 2,
        catalogMode: { mode: 'catalog', total: 6 },
      },
    })]);
    render(<McpShelfPane />);
    await waitFor(() => expect(screen.getByTestId('mcp-policy-many-srv')).toBeTruthy());
    const metrics = screen.getByTestId('mcp-policy-metrics-many-srv').textContent || '';
    expect(metrics).toContain('目录模式');
    expect(metrics).toContain('6 个工具按需加载');
    expect(metrics).toContain('生效入口 2');
  });

  it('BLOCK-239 — 授权等待态与已授权徽标', async () => {
    withServers([
      row({ id: 'auth-wait', transport: 'http', status: 'authorizing', auth: 'required' }),
      row({ id: 'auth-ok', transport: 'http', status: 'connected', auth: 'authorized', toolCount: 2 }),
    ]);
    render(<McpShelfPane />);
    await waitFor(() => expect(screen.getByTestId('mcp-card-auth-wait')).toBeTruthy());
    expect(screen.getByTestId('mcp-card-auth-wait').textContent).toContain('等待授权');
    expect(screen.getByTestId<HTMLButtonElement>('mcp-authorizing-auth-wait').disabled).toBe(true);
    expect(screen.getByTestId('mcp-auth-badge-auth-ok').textContent).toContain('已授权');
  });

  it('UI-547 / BLOCK-243 — 治理摘要与 trust 当前值呈现（ask 不提供直接授权入口）', async () => {
    withServers([row({
      id: 'gov',
      status: 'connected',
      toolCount: 5,
      policy: {
        trust: 'ask', allowCount: 1, blockCount: 1,
        allow: ['read_file'], block: ['delete_file'], projectedToolCount: 3,
      },
    })]);
    render(<McpShelfPane />);
    await waitFor(() => expect(screen.getByTestId('mcp-policy-gov')).toBeTruthy());
    expect(screen.getByTestId('mcp-policy-trust-gov').textContent).toContain('ask');
    expect(screen.getByTestId('mcp-policy-metrics-gov').textContent).toContain('生效 3');
    expect(screen.getByTestId<HTMLInputElement>('mcp-policy-allow-gov').value).toBe('read_file');
    expect(screen.getByTestId<HTMLInputElement>('mcp-policy-block-gov').value).toBe('delete_file');
    expect(screen.queryByTestId('mcp-policy-trust-select-gov')).toBeNull();
    expect(screen.queryByTestId('mcp-policy-trust-revoke-gov')).toBeNull();
  });

  it('BLOCK-243 — trust allow 可在货架改回 ask（PUT policy trust=ask）', async () => {
    const mock = withServers([row({
      id: 'gov-allow',
      status: 'connected',
      toolCount: 5,
      policy: {
        trust: 'allow', allowCount: 1, blockCount: 0,
        allow: ['read_file'], block: [], projectedToolCount: 4,
      },
    })]);
    render(<McpShelfPane />);
    await waitFor(() => expect(screen.getByTestId('mcp-policy-gov-allow')).toBeTruthy());
    expect(screen.getByTestId('mcp-policy-trust-gov-allow').textContent).toContain('allow');
    fireEvent.click(screen.getByTestId('mcp-policy-trust-revoke-gov-allow'));
    await waitFor(() => expect(screen.getByTestId('mcp-notice').textContent).toContain('已保存 gov-allow'));

    const puts = (mock.mock.calls as Array<[string, RequestInit | undefined]>)
      .filter(([u, i]) => /\/mcp\/servers\/gov-allow\/policy$/.test(String(u)) && i?.method === 'PUT');
    expect(puts).toHaveLength(1);
    const rawBody = puts[0][1]?.body;
    const body = typeof rawBody === 'string' ? (JSON.parse(rawBody) as DraftBody) : {};
    expect(body).toEqual({ trust: 'ask' });
  });

  it('UI-547 — 保存白名单/阻断走 PUT policy 并提示成功', async () => {
    const mock = withServers([row({
      id: 'gov2',
      status: 'connected',
      toolCount: 5,
      policy: {
        trust: 'ask', allowCount: 1, blockCount: 1,
        allow: ['read_file'], block: ['delete_file'], projectedToolCount: 3,
      },
    })]);
    render(<McpShelfPane />);
    await waitFor(() => expect(screen.getByTestId('mcp-policy-gov2')).toBeTruthy());
    fireEvent.change(screen.getByTestId('mcp-policy-block-gov2'), {
      target: { value: 'delete_file, drop_table' },
    });
    fireEvent.click(screen.getByTestId('mcp-policy-save-gov2'));
    await waitFor(() => expect(screen.getByTestId('mcp-notice').textContent).toContain('已保存 gov2'));

    const puts = (mock.mock.calls as Array<[string, RequestInit | undefined]>)
      .filter(([u, i]) => /\/mcp\/servers\/gov2\/policy$/.test(String(u)) && i?.method === 'PUT');
    expect(puts).toHaveLength(1);
    const rawBody = puts[0][1]?.body;
    const body = typeof rawBody === 'string' ? (JSON.parse(rawBody) as DraftBody) : {};
    expect(body).toEqual({ allow: ['read_file'], block: ['delete_file', 'drop_table'] });
  });

  it('UI-547 — 非法工具名本地拦截，不发 PUT', async () => {
    const mock = withServers([row({
      id: 'gov3',
      status: 'connected',
      toolCount: 5,
      policy: {
        trust: 'ask', allowCount: 0, blockCount: 0,
        allow: [], block: [], projectedToolCount: 5,
      },
    })]);
    render(<McpShelfPane />);
    await waitFor(() => expect(screen.getByTestId('mcp-policy-gov3')).toBeTruthy());
    fireEvent.change(screen.getByTestId('mcp-policy-allow-gov3'), {
      target: { value: 'read_file bad/name' },
    });
    fireEvent.click(screen.getByTestId('mcp-policy-save-gov3'));
    await waitFor(() => expect(screen.getByTestId('mcp-policy-error-gov3').textContent).toContain('工具名不合法'));
    const puts = (mock.mock.calls as Array<[string, RequestInit | undefined]>)
      .filter(([, i]) => i?.method === 'PUT');
    expect(puts).toHaveLength(0);
  });

  it('UI-547 — 后端 400 diagnostics 如实展示', async () => {
    withServers([row({
      id: 'gov4',
      status: 'connected',
      toolCount: 5,
      policy: {
        trust: 'ask', allowCount: 0, blockCount: 0,
        allow: [], block: [], projectedToolCount: 5,
      },
    })], () => new Response(JSON.stringify({
      status: 'error',
      error: 'policy_rejected',
      diagnostics: [{ code: 'block_invalid_name', value: 'x y' }],
    }), { status: 400 }));
    render(<McpShelfPane />);
    await waitFor(() => expect(screen.getByTestId('mcp-policy-gov4')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mcp-policy-save-gov4'));
    await waitFor(() => expect(screen.getByTestId('mcp-policy-diagnostics-gov4').textContent)
      .toContain('block_invalid_name'));
  });

  it('BLOCK-239 — 添加 HTTP server 提交 transport/url', async () => {
    const mock = withServers([]);
    render(<McpShelfPane />);
    await waitFor(() => expect(screen.getByTestId('mcp-empty')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mcp-add-toggle'));
    fireEvent.change(screen.getByTestId('mcp-form-transport'), { target: { value: 'http' } });
    fireEvent.change(screen.getByTestId('mcp-form-id'), { target: { value: 'remote' } });
    fireEvent.change(screen.getByTestId('mcp-form-url'), { target: { value: 'https://example.com/mcp' } });
    fireEvent.click(screen.getByTestId('mcp-form-submit'));
    await waitFor(() => expect(screen.getByTestId('mcp-notice').textContent).toContain('已添加 remote'));

    const posts = (mock.mock.calls as Array<[string, RequestInit | undefined]>)
      .filter(([u, i]) => String(u).endsWith('/mcp/servers') && i?.method === 'POST');
    const rawBody = posts[0][1]?.body;
    const body = typeof rawBody === 'string' ? (JSON.parse(rawBody) as DraftBody) : {};
    expect(body).toMatchObject({
      id: 'remote',
      command: 'http',
      args: [],
      transport: 'http',
      url: 'https://example.com/mcp',
      autoConnect: false,
    });
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
