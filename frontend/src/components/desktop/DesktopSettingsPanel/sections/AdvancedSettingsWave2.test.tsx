import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkProxyPanel } from './NetworkProxyPanel';
import { RuntimePolicyPanel } from './RuntimePolicyPanel';
import { DecisionConfigPanel } from './DecisionConfigPanel';
import { AuditTabs } from './AuditTabs';

type JsonBody = Record<string, unknown>;

function response(body: JsonBody, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const NETWORK = {
  configured: { httpProxy: '', httpsProxy: '', noProxy: '', caFile: '' },
  applied: null,
  noProxyEffective: 'localhost,127.0.0.1,::1',
  restartRequired: false,
  diagnostics: [],
};

const RUNTIME = {
  configured: { approvalDefaultMode: 'full', spawnConcurrency: 3, spawnMaxDepth: 1, toolAllow: '', toolDeny: '' },
  effective: { approvalDefaultMode: 'full', spawnConcurrency: 3, spawnMaxDepth: 1 },
  modes: ['read', 'plan', 'workspace-write', 'full'],
  envShadowed: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('UI-704 加映四 — 零行为变更的呈现合并', () => {
  it('工具曝光白/黑名单合为一张「工具可见范围」卡，后端键与输入不变', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ status: 'ok', runtime: RUNTIME }))));
    render(<RuntimePolicyPanel />);
    await waitFor(() => expect(screen.getByTestId('runtime-tool-allow')).toBeTruthy());
    const group = screen.getByTestId('runtime-tool-scope-group');
    expect(group).toBeTruthy();
    expect(group.contains(screen.getByTestId('runtime-tool-allow'))).toBe(true);
    expect(group.contains(screen.getByTestId('runtime-tool-deny'))).toBe(true);
    expect(group.textContent).toContain('工具可见范围');
  });

  it('HTTP/HTTPS 代理合为一张「代理地址」卡，两个保存键不变', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ status: 'ok', network: NETWORK }))));
    render(<NetworkProxyPanel />);
    await waitFor(() => expect(screen.getByTestId('network-http-proxy')).toBeTruthy());
    const group = screen.getByTestId('network-proxy-address-group');
    expect(group).toBeTruthy();
    expect(group.contains(screen.getByTestId('network-http-proxy'))).toBe(true);
    expect(group.contains(screen.getByTestId('network-https-proxy'))).toBe(true);
    expect(group.textContent).toContain('代理地址');
  });

  it('决策供给 URL/Key/Model 与预设收进默认折叠卡，写面不变', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({
      status: 'ok',
      points: [],
      provider: { baseUrl: 'https://api.typesafe.ai', model: 'jev-1.13.0', hasKey: true },
    }))));
    render(<DecisionConfigPanel />);
    await waitFor(() => expect(screen.getByTestId('decision-provider-url')).toBeTruthy());
    const fold = screen.getByTestId('decision-supply-fold');
    expect((fold as HTMLDetailsElement).open).toBe(false);
    for (const id of ['decision-provider-url', 'decision-provider-key', 'decision-provider-model',
      'decision-provider-preset-jev', 'decision-provider-preset-laya']) {
      expect(fold.contains(screen.getByTestId(id))).toBe(true);
    }
  });

  it('审计页签默认只渲染第一块，切换后才渲染第二块（不改面板本身）', () => {
    render(
      <AuditTabs tabs={[
        { id: 'ack', label: '审批记录', content: <div data-testid="audit-ack">ack</div> },
        { id: 'memory', label: '记忆变更', content: <div data-testid="audit-memory">memory</div> },
      ]} />
    );
    expect(screen.getByTestId('audit-tab-ack')).toBeTruthy();
    expect(screen.getByTestId('audit-panel-ack')).toBeTruthy();
    expect(screen.queryByTestId('audit-panel-memory')).toBeNull();
    fireEvent.click(screen.getByTestId('audit-tab-memory'));
    expect(screen.getByTestId('audit-panel-memory')).toBeTruthy();
    expect(screen.queryByTestId('audit-panel-ack')).toBeNull();
  });
});
