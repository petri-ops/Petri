// BLOCK-346 T4 — 联邦作业面板契约（此前后端三端点零前端调用，只能 curl）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FederationJobs } from './FederationJobs';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) } as unknown as Response;
}

/** 取首次指定 method 的请求体（字符串化后解析，避免 any 与 base-to-string 规则）。 */
function postedJson(calls: ReadonlyArray<readonly [string, RequestInit?]>, method: string): Record<string, unknown> {
  const call = calls.find(([, init]) => init?.method === method);
  if (!call) throw new Error(`no ${method} call`);
  const body = call[1]?.body;
  if (typeof body !== 'string') throw new Error('body is not string');
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body is not object');
  return parsed as Record<string, unknown>;
}

const PEERS = [{ peerId: 'gpeer_1', name: 'MacBook-Pro.local', online: true }];

describe('FederationJobs（BLOCK-346 T4）', () => {
  it('提交作业：POST 展开 toolId + 参数并回显 job', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ ok: true, peerId: 'gpeer_1', peerName: 'MacBook-Pro.local', job: { id: 'job_42', status: 'running' } }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<FederationJobs peers={PEERS} />);

    fireEvent.change(screen.getByTestId('federation-job-tool'), { target: { value: 'deseq2' } });
    fireEvent.change(screen.getByTestId('federation-job-params'), { target: { value: '{"inputPath":"data/counts.csv"}' } });
    fireEvent.click(screen.getByTestId('federation-job-submit'));

    await waitFor(() => expect(screen.getByTestId('federation-job-notice').textContent).toContain('job_42'));
    expect(postedJson(fetchMock.mock.calls, 'POST')).toEqual({ toolId: 'deseq2', inputPath: 'data/counts.csv' });
    expect(screen.getByTestId('federation-job-result').textContent).toContain('running');
    expect(screen.getByTestId('federation-job-result')).toBeTruthy();
  });

  it('参数不是 JSON 对象：本地拦截并提示，不发请求', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit): Promise<Response> => Promise.resolve(jsonResponse({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    render(<FederationJobs peers={PEERS} />);
    fireEvent.change(screen.getByTestId('federation-job-tool'), { target: { value: 'deseq2' } });
    fireEvent.change(screen.getByTestId('federation-job-params'), { target: { value: '[1,2]' } });
    fireEvent.click(screen.getByTestId('federation-job-submit'));
    await waitFor(() => expect(screen.getByTestId('federation-job-error').textContent).toContain('JSON 对象'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('job id + 文件名齐备时才出现产物下载链接', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit): Promise<Response> => Promise.resolve(jsonResponse({ ok: true }))));
    render(<FederationJobs peers={PEERS} />);
    expect(screen.queryByTestId('federation-job-download')).toBeNull();
    fireEvent.change(screen.getByTestId('federation-job-id'), { target: { value: 'job_42' } });
    fireEvent.change(screen.getByTestId('federation-job-file'), { target: { value: 'result.csv' } });
    const link = await screen.findByTestId('federation-job-download');
    expect(link.getAttribute('href')).toContain('/jobs/job_42/file/result.csv');
  });
});
