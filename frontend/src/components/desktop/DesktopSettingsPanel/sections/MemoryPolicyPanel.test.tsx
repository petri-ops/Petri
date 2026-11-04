// BLOCK-346 T4 追加 — 记忆压缩策略 / 清空记忆（三端点此前前端零调用）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryPolicyPanel } from './MemoryPolicyPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) } as unknown as Response;
}

const SNAPSHOT = {
  status: 'ok',
  path: '/tmp/memory-policy.json',
  values: { compactionTriggerTokens: 12000, compactionMinMessages: 24, embeddingModel: 'text-embedding-v3' },
  sources: { compactionTriggerTokens: 'default', compactionMinMessages: 'file', embeddingModel: 'default' },
  defaults: { compactionTriggerTokens: 12000, compactionMinMessages: 24, embeddingModel: 'text-embedding-v3' },
  readonlyKeys: ['embeddingModel'],
};

describe('MemoryPolicyPanel（BLOCK-346 T4）', () => {
  it('渲染生效值与来源，readonlyKeys 输入被禁用', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit): Promise<Response> => Promise.resolve(jsonResponse(SNAPSHOT))));
    render(<MemoryPolicyPanel />);
    await waitFor(() => expect(screen.getByTestId('memory-policy-compactionTriggerTokens')).toBeTruthy());
    expect(screen.getByTestId('memory-policy-panel').textContent).toContain('默认');
    expect(screen.getByTestId('memory-policy-panel').textContent).toContain('文件');
    const readonlyInput = screen.getByTestId<HTMLInputElement>('memory-policy-embeddingModel');
    expect(readonlyInput.disabled).toBe(true);
    const editable = screen.getByTestId<HTMLInputElement>('memory-policy-compactionTriggerTokens');
    expect(editable.disabled).toBe(false);
    expect(editable.value).toBe('12000');
  });

  it('保存：把数字输入转回 number 并 PUT 全量 values', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('/ai/memory-policy') && init?.method === 'PUT') {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      return Promise.resolve(jsonResponse(SNAPSHOT));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryPolicyPanel />);
    await waitFor(() => expect(screen.getByTestId('memory-policy-compactionTriggerTokens')).toBeTruthy());
    fireEvent.change(screen.getByTestId('memory-policy-compactionTriggerTokens'), { target: { value: '20000' } });
    fireEvent.click(screen.getByTestId('memory-policy-save'));
    await waitFor(() => expect(screen.getByTestId('memory-policy-notice').textContent).toContain('已保存'));

    const put = fetchMock.mock.calls.find(([url, init]) => String(url).includes('/ai/memory-policy')
      && init?.method === 'PUT');
    expect(put).toBeTruthy();
    const body = put![1]?.body;
    if (typeof body !== 'string') throw new Error('PUT body 应为字符串');
    const parsed: unknown = JSON.parse(body);
    expect(parsed && typeof parsed === 'object').toBe(true);
    const payload = parsed as Record<string, unknown>;
    expect(payload.compactionTriggerTokens).toBe(20000);
    expect(typeof payload.compactionTriggerTokens).toBe('number');
  });

  it('清空记忆需二次确认：首次点击不发请求', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit): Promise<Response> => Promise.resolve(jsonResponse(SNAPSHOT)));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryPolicyPanel />);
    await waitFor(() => expect(screen.getByTestId('memory-wipe')).toBeTruthy());
    fireEvent.click(screen.getByTestId('memory-wipe'));
    expect(screen.getByTestId('memory-wipe').textContent).toContain('确认清空');
    expect(screen.getByTestId('memory-policy-notice').textContent).toContain('再次点击');
    const wipeCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/ai/memory-wipe'));
    expect(wipeCalls.length).toBe(0);
  });
});
