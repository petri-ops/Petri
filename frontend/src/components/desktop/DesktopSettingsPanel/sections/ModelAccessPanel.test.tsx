// BLOCK-346 T4 — 模型允许清单 / 原因码词表面板契约（此前前端零调用，只能手改 JSON）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModelAccessPanel } from './ModelAccessPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) } as unknown as Response;
}

/** 取首个 PUT 的请求体（字符串化后解析，避免 any 与 base-to-string 规则）。 */
function putBody(calls: ReadonlyArray<readonly [string, RequestInit?]>): Record<string, unknown> {
  const call = calls.find(([, init]) => init?.method === 'PUT');
  if (!call) throw new Error('no PUT call');
  const body = call[1]?.body;
  if (typeof body !== 'string') throw new Error('body is not string');
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body is not object');
  return parsed as Record<string, unknown>;
}

describe('ModelAccessPanel（BLOCK-346 T4）', () => {
  it('开放模式：如实显示「开放」且允许清单 textarea 为空', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit): Promise<Response> => Promise.resolve(jsonResponse({
      status: 'ok', mode: 'open', allowedModels: [], reasonNotes: {},
    }))));
    render(<ModelAccessPanel />);
    await waitFor(() => expect(screen.getByTestId('model-access-mode').textContent).toContain('开放模式'));
    expect(screen.getByTestId<HTMLTextAreaElement>('model-access-models').value).toBe('');
  });

  it('白名单模式：回填模型与理由账本，保存时按行解析并 PUT 正确载荷', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit): Promise<Response> => {
      if (!init || init.method !== 'PUT') {
        return Promise.resolve(jsonResponse({
          status: 'ok', mode: 'allowlist', allowedModels: ['doubao-seed-1.6'], reasonNotes: { 'glm-4.6': '预算内默认' },
        }));
      }
      return Promise.resolve(jsonResponse({
        status: 'ok', mode: 'allowlist', allowedModels: ['doubao-seed-1.6', 'glm-4.6'], reasonNotes: { 'glm-4.6': '预算内默认' },
      }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ModelAccessPanel />);
    await waitFor(() => expect(screen.getByTestId('model-access-mode').textContent).toContain('白名单模式'));

    fireEvent.change(screen.getByTestId('model-access-models'), {
      target: { value: 'doubao-seed-1.6\nglm-4.6' },
    });
    fireEvent.click(screen.getByTestId('model-access-save'));

    await waitFor(() => expect(screen.getByTestId('model-access-message').textContent).toContain('已保存'));
    const payload = putBody(fetchMock.mock.calls);
    expect(payload.allowedModels).toEqual(['doubao-seed-1.6', 'glm-4.6']);
    expect(payload.reasonNotes).toEqual({ 'glm-4.6': '预算内默认' });
  });

  it('保存失败：展示后端 diagnostics，不假装成功', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit): Promise<Response> => {
      if (!init || init.method !== 'PUT') {
        return Promise.resolve(jsonResponse({ status: 'ok', mode: 'open', allowedModels: [], reasonNotes: {} }));
      }
      return Promise.resolve(jsonResponse({
        status: 'error',
        error: 'value_invalid',
        diagnostics: [{ code: 'item_type', path: 'allowedModels', message: 'allowedModels 的每一项必须是非空字符串' }],
      }, false));
    }));
    render(<ModelAccessPanel />);
    await waitFor(() => expect(screen.getByTestId('model-access-mode').textContent).toContain('开放模式'));
    fireEvent.click(screen.getByTestId('model-access-save'));
    await waitFor(() => expect(screen.getByTestId('model-access-error').textContent).toContain('非空字符串'));
    expect(screen.queryByTestId('model-access-message')).toBeNull();
  });
});
