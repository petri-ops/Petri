import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { RemoteTargets } from './RemoteTargets';

function fetchJson(payload: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(payload) } as Response);
}

const PEER = {
  peerId: 'gpeer_test123',
  name: 'MacBook-Pro.local',
  baseUrl: 'https://example.test:8443',
  platform: 'darwin',
  arch: 'arm64',
  gewuVersion: '1.0.0',
  executors: { r: true, python: true },
  protocol: 1,
  addedAt: '2026-09-18T13:30:06.027Z',
  lastSeenAt: new Date().toISOString(),
  lastProbe: { ok: true, at: new Date().toISOString(), latencyMs: 64, error: null },
};

function stubFetch(opts: { peers?: unknown[]; peersOk?: boolean; registered?: unknown[] } = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/federation/peers') && (!init?.method || init.method === 'GET')) {
      return fetchJson({ ok: opts.peersOk !== false, version: 1, peers: opts.peers ?? [PEER] });
    }
    if (url.endsWith('/federation/peers/gpeer_test123/probe')) {
      return fetchJson({ ok: true, probe: { ok: true }, peer: PEER });
    }
    if (url.endsWith('/remote-targets')) {
      return fetchJson({ ok: true, registered: opts.registered ?? [], discovered: [] });
    }
    return fetchJson({ ok: false });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('RemoteTargets 联邦执行位置选择（UI-422 / BLOCK-85 fed: 产品面）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('联邦节点组：渲染对端行+在线态+设为默认写 fed: 存储键+摘要解析节点名', async () => {
    stubFetch();
    render(<RemoteTargets />);
    await waitFor(() => expect(screen.getByTestId('federation-peer-row')).toBeTruthy());
    expect(screen.getByText('MacBook-Pro.local')).toBeTruthy();
    expect(screen.getByTestId('federation-peer-status-gpeer_test123').textContent).toContain('已连通 64ms');

    fireEvent.click(screen.getByTestId('federation-peer-default-gpeer_test123'));
    expect(window.localStorage.getItem('gewu.executionTargetId')).toBe('fed:gpeer_test123');
    await waitFor(() =>
      expect(screen.getByTestId('remote-target-default-summary').textContent).toContain('联邦节点 MacBook-Pro.local'),
    );
    // ★ 默认态
    expect((screen.getByTestId('federation-peer-default-gpeer_test123')).textContent).toContain('★');
  });

  it('无联邦节点：诚实空态指路联邦面板，SSH 目标管理不受影响', async () => {
    stubFetch({ peers: [], registered: [{ id: 't1', alias: 'aliyun', label: '', status: 'ready', lastProbeAt: null, lastProbe: null }] });
    render(<RemoteTargets />);
    await waitFor(() => expect(screen.getByTestId('federation-peers-empty')).toBeTruthy());
    expect(screen.getByTestId('federation-peers-empty').textContent).toContain('「联邦」面板');
    // SSH 目标行仍在
    await waitFor(() => expect(screen.getByTestId('remote-target-row')).toBeTruthy());
    expect(screen.getByText('aliyun')).toBeTruthy();
  });

  it('恢复本机执行：清除存储键并回退摘要', async () => {
    window.localStorage.setItem('gewu.executionTargetId', 'fed:gpeer_test123');
    stubFetch();
    render(<RemoteTargets />);
    await waitFor(() => expect(screen.getByTestId('federation-peer-row')).toBeTruthy());
    const clear = screen.getByTestId('remote-target-default-clear');
    fireEvent.click(clear);
    expect(window.localStorage.getItem('gewu.executionTargetId')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('remote-target-default-summary').textContent).toContain('本机（分析在本机执行）'),
    );
  });

  it('探活按钮：POST probe 后刷新在线态', async () => {
    const fetchMock = stubFetch();
    render(<RemoteTargets />);
    await waitFor(() => expect(screen.getByTestId('federation-peer-row')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '探活' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, init]) => String(u).endsWith('/federation/peers/gpeer_test123/probe') && init?.method === 'POST')).toBe(true),
    );
  });
});
