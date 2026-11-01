/**
 * BLOCK-323 — AgentRulesPanel 放权坡道复盘区契约（渲染 + 升级/收权/标复盘 + PUT 断言）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';

interface RecordedCall {
  url: string;
  method?: string;
  body?: unknown;
}

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  const calls: RecordedCall[] = [];
  const fn = ((url: string, init?: RequestInit) => {
    const r = handler(url, init);
    calls.push({ url, method: init?.method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    // 面板既有 fetch(...).then 链式用法：必须返回真 Promise
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: () => Promise.resolve(r.body),
    }) as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const { AgentRulesPanel } = await import('./AgentRulesPanel');

const rulesFixture = {
  status: 'ok',
  rules: [
    { id: 'r-obs', matcher: { type: 'command-token', pattern: 'npm' }, action: 'observe', scope: 'global' },
    { id: 'r-deny', matcher: { type: 'path-glob', pattern: 'secrets/**' }, action: 'deny', scope: 'global' },
  ],
};

const observationsFixture = {
  status: 'ok',
  unreviewedCount: 2,
  unreviewed: [
    { id: 7, kind: 'rule-observe', ruleId: 'r-obs', toolName: 'workspace_exec', fingerprint: 'fp-a', guardKey: 'rule:r-obs', samplePreview: '{"command":"npm install"}', hits: 5, firstSeenAt: '2026-11-01T00:00:00Z', lastSeenAt: '2026-11-01T01:00:00Z', reviewedAt: null },
    { id: 8, kind: 'tool-observe', ruleId: null, toolName: 'workspace_exec_background', fingerprint: 'fp-b', guardKey: 'tool:workspace_exec_background', samplePreview: null, hits: 1, firstSeenAt: '2026-11-01T00:30:00Z', lastSeenAt: '2026-11-01T00:30:00Z', reviewedAt: null },
  ],
  autoAllow: [
    { id: 3, kind: 'rule-auto-allow', ruleId: 'r-old', toolName: 'workspace_exec', fingerprint: 'fp-c', guardKey: 'rule:r-old', samplePreview: null, hits: 9, firstSeenAt: '2026-10-31T00:00:00Z', lastSeenAt: '2026-10-31T09:00:00Z', reviewedAt: null },
  ],
  policyChanges: [
    { id: 2, kind: 'policy-change', ruleId: '', toolName: '', fingerprint: 'change:x', guardKey: '', samplePreview: '{"changed":[{"id":"r-old","from":"observe","to":"allow"}]}', hits: 1, firstSeenAt: '2026-10-31T00:00:00Z', lastSeenAt: '2026-10-31T00:00:00Z', reviewedAt: null },
  ],
};

describe('AgentRulesPanel（BLOCK-323 放权坡道复盘区）', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('渲染：规则动作四档标签 + 待复盘行（次数/样本）+ 近期自动放行 + 变更留痕', async () => {
    vi.stubGlobal('fetch', mockFetch((url) => {
      if (String(url).includes('/ai/policy-observations')) return { status: 200, body: observationsFixture };
      return { status: 200, body: rulesFixture };
    }).fn);
    render(<AgentRulesPanel />);
    await waitFor(() => expect(screen.getByTestId('agent-rule-observation-7')).toBeTruthy());
    expect(screen.getByTestId('agent-rule-observation-8')).toBeTruthy();
    expect(screen.getByTestId('agent-rule-observation-7').textContent).toContain('命中 5 次');
    expect(screen.getByTestId('agent-rule-observation-7').textContent).toContain('npm install');
    expect(screen.getByTestId('agent-rule-auto-allow-list').textContent).toContain('r-old');
    expect(screen.getByTestId('agent-rule-policy-changes').textContent).toContain('observe');
  });

  it('复盘升级：点击「升级为放行」PUT 整单规则且该规则 action=allow', async () => {
    const { fn, calls } = mockFetch((url, init) => {
      if (init?.method === 'PUT' && String(url).includes('/ai/agent-rules')) return { status: 200, body: { status: 'ok', count: 2 } };
      if (String(url).includes('/ai/policy-observations')) return { status: 200, body: observationsFixture };
      return { status: 200, body: rulesFixture };
    });
    vi.stubGlobal('fetch', fn);
    render(<AgentRulesPanel />);
    await waitFor(() => expect(screen.getByTestId('observation-upgrade-7')).toBeTruthy());
    fireEvent.click(screen.getByTestId('observation-upgrade-7'));
    await waitFor(() => expect(screen.getByText(/已升级为「放行」/)).toBeTruthy());
    const put = calls.find((c) => c.method === 'PUT' && String(c.url).includes('/ai/agent-rules'));
    expect(put).toBeTruthy();
    const saved = (put as { body: { rules: Array<{ id: string; action: string }> } }).body.rules;
    expect(saved.find((r) => r.id === 'r-obs')?.action).toBe('allow');
    expect(saved.find((r) => r.id === 'r-deny')?.action).toBe('deny');
  });

  it('标为已复盘：POST review 携带该行 id', async () => {
    const { fn, calls } = mockFetch((url, init) => {
      if (init?.method === 'POST' && String(url).includes('/review')) return { status: 200, body: { status: 'ok', updated: 1 } };
      if (String(url).includes('/ai/policy-observations')) return { status: 200, body: observationsFixture };
      return { status: 200, body: rulesFixture };
    });
    vi.stubGlobal('fetch', fn);
    render(<AgentRulesPanel />);
    await waitFor(() => expect(screen.getByTestId('observation-review-7')).toBeTruthy());
    fireEvent.click(screen.getByTestId('observation-review-7'));
    await waitFor(() => expect(screen.getByText('已标为复盘')).toBeTruthy());
    const post = calls.find((c) => c.method === 'POST' && String(c.url).includes('/review'));
    expect((post as { body: { ids: number[] } }).body.ids).toEqual([7]);
  });

  it('工具观察行无升级按钮（规则升级只对 rule-observe 提供）', async () => {
    vi.stubGlobal('fetch', mockFetch((url) => {
      if (String(url).includes('/ai/policy-observations')) return { status: 200, body: observationsFixture };
      return { status: 200, body: rulesFixture };
    }).fn);
    render(<AgentRulesPanel />);
    await waitFor(() => expect(screen.getByTestId('agent-rule-observation-8')).toBeTruthy());
    expect(screen.queryByTestId('observation-upgrade-8')).toBeNull();
    expect(screen.getByTestId('observation-review-8')).toBeTruthy();
  });
});
