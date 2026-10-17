import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimePolicyPanel } from './RuntimePolicyPanel';

const SNAPSHOT = {
  configured: { approvalDefaultMode: 'full', spawnConcurrency: 3, spawnMaxDepth: 1, toolDeny: '' },
  effective: { approvalDefaultMode: 'full', spawnConcurrency: 3, spawnMaxDepth: 1 },
  modes: ['read', 'plan', 'workspace-write', 'full'],
  envShadowed: [],
};

type JsonBody = Record<string, unknown>;

function response(body: JsonBody, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RuntimePolicyPanel', () => {
  it('加载后显示四档选择与并发/深度生效值', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ status: 'ok', runtime: SNAPSHOT }))));
    render(<RuntimePolicyPanel />);
    await waitFor(() => expect(screen.getByTestId('runtime-approval-mode')).toBeTruthy());
    expect((screen.getByTestId('runtime-approval-mode') as unknown as HTMLSelectElement).value).toBe('full');
    expect(screen.getByTestId('runtime-effective').textContent).toContain('并发 3');
  });

  it('并发越界在客户端拦下，不发写请求', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(response({ status: 'ok', runtime: SNAPSHOT })));
    vi.stubGlobal('fetch', fetchMock);
    render(<RuntimePolicyPanel />);
    await waitFor(() => expect(screen.getByTestId('runtime-spawn-concurrency')).toBeTruthy());
    fireEvent.change(screen.getByTestId('runtime-spawn-concurrency'), { target: { value: '99' } });
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByText('保存编排策略'));
    await waitFor(() => expect(screen.getByTestId('runtime-notice').textContent).toContain('1-8'));
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('env 遮蔽必须可见（设置页改它不会生效）', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({
      status: 'ok',
      runtime: { ...SNAPSHOT, envShadowed: [{ key: 'spawnConcurrency', envKey: 'PETRI_SPAWN_CONCURRENCY_LIMIT', envValue: '6' }] },
    }))));
    render(<RuntimePolicyPanel />);
    await waitFor(() => expect(screen.getByTestId('runtime-env-shadowed').textContent).toContain('PETRI_SPAWN_CONCURRENCY_LIMIT'));
  });

  it('保存成功提示「下一轮生效」并回填生效值', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return Promise.resolve(response({
          status: 'ok',
          runtime: { ...SNAPSHOT, effective: { approvalDefaultMode: 'read', spawnConcurrency: 4, spawnMaxDepth: 2 } },
        }));
      }
      return Promise.resolve(response({ status: 'ok', runtime: SNAPSHOT }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<RuntimePolicyPanel />);
    await waitFor(() => expect(screen.getByTestId('runtime-approval-mode')).toBeTruthy());
    fireEvent.change(screen.getByTestId('runtime-approval-mode'), { target: { value: 'read' } });
    fireEvent.change(screen.getByTestId('runtime-spawn-concurrency'), { target: { value: '4' } });
    fireEvent.click(screen.getByText('保存编排策略'));
    await waitFor(() => expect(screen.getByTestId('runtime-notice').textContent).toContain('下一轮'));
    expect(screen.getByTestId('runtime-effective').textContent).toContain('read');
  });
});
