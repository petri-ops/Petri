// BLOCK-346 T4 追加 — agent 审计 / 撤销 / 暂停开关（三端点此前前端零调用）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentAuditPanel } from './AgentAuditPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) } as unknown as Response;
}

const AUDIT_ITEMS = [
  { id: 2, undo_token: 'tok_new', action: 'workspace_write', ts: '2026-11-04T10:00:00Z', undone: false },
  { id: 1, undo_token: 'tok_old', action: 'workspace_delete', ts: '2026-11-04T09:00:00Z', undone: true },
];

function routes(overrides: Record<string, () => Response> = {}) {
  return vi.fn((url: string, init?: RequestInit): Promise<Response> => {
    const key = Object.keys(overrides).find((k) => url.includes(k));
    if (key) return Promise.resolve(overrides[key]());
    if (url.includes('/ai/agent-audit')) return Promise.resolve(jsonResponse({ status: 'ok', items: AUDIT_ITEMS }));
    if (url.includes('/ai/agent-settings')) {
      if (init?.method === 'POST') return Promise.resolve(jsonResponse({ status: 'ok', agentPaused: true }));
      return Promise.resolve(jsonResponse({ status: 'ok', agentPaused: false }));
    }
    return Promise.resolve(jsonResponse({ status: 'ok' }));
  });
}

describe('AgentAuditPanel（BLOCK-346 T4）', () => {
  it('渲染审计列表：可撤销项有按钮、已撤销/无 token 项给出说明', async () => {
    vi.stubGlobal('fetch', routes());
    render(<AgentAuditPanel />);
    await waitFor(() => expect(screen.getByTestId('agent-audit-list')).toBeTruthy());
    expect(screen.getByTestId('agent-undo-tok_new')).toBeTruthy();
    expect(screen.queryByTestId('agent-undo-tok_old')).toBeNull();
    expect(screen.getByTestId('agent-audit-list').textContent).toContain('已撤销');
    expect(screen.getByTestId('agent-audit-list').textContent).toContain('workspace_write');
  });

  it('撤销：POST 到 /ai/agent-undo/:token 并刷新列表', async () => {
    const fetchMock = routes();
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentAuditPanel />);
    await waitFor(() => expect(screen.getByTestId('agent-undo-tok_new')).toBeTruthy());
    fireEvent.click(screen.getByTestId('agent-undo-tok_new'));
    await waitFor(() => expect(screen.getByTestId('agent-audit-notice').textContent).toContain('已撤销'));
    const undoCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/ai/agent-undo/tok_new'));
    expect(undoCall).toBeTruthy();
    expect((undoCall![1] as RequestInit).method).toBe('POST');
  });

  it('暂停开关：按当前状态取反并 POST agentPaused', async () => {
    const fetchMock = routes();
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentAuditPanel />);
    await waitFor(() => expect(screen.getByTestId('agent-pause-toggle').textContent).toContain('暂停 agent'));
    fireEvent.click(screen.getByTestId('agent-pause-toggle'));
    await waitFor(() => expect(screen.getByTestId('agent-pause-toggle').textContent).toContain('已暂停'));
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).includes('/ai/agent-settings')
      && (init as RequestInit | undefined)?.method === 'POST');
    expect(post).toBeTruthy();
    const body = (post![1] as RequestInit).body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(String(body))).toEqual({ agentPaused: true });
  });
});
