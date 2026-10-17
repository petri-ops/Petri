// BLOCK-200 P3 推理档位设置面组件测：出厂值与生效值并列显示、只提交改动项、写侧拒绝逐条点名。
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReasoningDefaultsPanel } from './ReasoningDefaultsPanel';

const SNAPSHOT = {
  levels: ['off', 'standard', 'high'],
  effective: { defaultLevel: 'standard', anthropicHighBudgetTokens: 16000 },
  factory: { defaultLevel: 'standard', anthropicHighBudgetTokens: 16000 },
  protocols: {
    'openai-compatible': {
      allowed: ['none', 'reasoning_effort:minimal', 'reasoning_effort:low', 'reasoning_effort:medium', 'reasoning_effort:high'],
      tiers: {
        off: { effective: 'reasoning_effort:minimal', default: 'reasoning_effort:minimal' },
        standard: { effective: 'none', default: 'none' },
        high: { effective: 'reasoning_effort:high', default: 'reasoning_effort:high' },
      },
    },
    'anthropic-messages': {
      allowed: ['none', 'thinking:disabled', 'thinking:enabled'],
      tiers: {
        off: { effective: 'thinking:disabled', default: 'thinking:disabled' },
        standard: { effective: 'none', default: 'none' },
        high: { effective: 'thinking:enabled', default: 'thinking:enabled' },
      },
    },
  },
};

function jsonResponse(payload: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: () => Promise.resolve(payload) } as unknown as Response;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(onPut?: (body: unknown) => unknown): void {
  vi.stubGlobal('fetch', vi.fn((_input: unknown, init?: unknown) => {
    if (init && (init as { method?: string }).method === 'PUT') {
      const body = JSON.parse(String((init as { body: string }).body)) as { bindings?: Record<string, string | null> };
      return jsonResponse(onPut ? { status: 'ok', reasoning: onPut(body) } : { status: 'ok', reasoning: SNAPSHOT });
    }
    return jsonResponse({ status: 'ok', reasoning: SNAPSHOT });
  }));
  render(<ReasoningDefaultsPanel />);
}

describe('ReasoningDefaultsPanel（UI-515）', () => {
  it('显示生效值与出厂值，未改动时保存按钮不可用（不产生空写入）', async () => {
    mount();
    await waitFor(() => expect((screen.getByTestId('reasoning-mapping-table') as unknown as HTMLTableElement).rows.length).toBeGreaterThan(0));
    const select = screen.getByTestId('reasoning-default-level');
    expect(select.value).toBe('standard');
    expect((screen.getByTestId('reasoning-anthropic-budget')).value).toBe('16000');
    expect((screen.getByTestId('reasoning-save')).disabled).toBe(true);
  });

  it('只提交改动项：改默认档时 PUT 体不含预算与映射', async () => {
    let sent: Record<string, unknown> = {};
    mount((body) => { sent = body as Record<string, unknown>; return SNAPSHOT; });
    await waitFor(() => expect(screen.getByTestId('reasoning-default-level')).toBeTruthy());
    fireEvent.change(screen.getByTestId('reasoning-default-level'), { target: { value: 'high' } });
    fireEvent.click(screen.getByTestId('reasoning-save'));
    await waitFor(() => expect(sent.defaultLevel).toBe('high'));
    expect(sent.anthropicHighBudgetTokens).toBeUndefined();
    expect(sent.mapping).toBeUndefined();
  });

  it('改映射时按协议/档位提交，选回出厂值等价于清键（null）', async () => {
    let sent: Record<string, unknown> = {};
    mount((body) => { sent = body as Record<string, unknown>; return SNAPSHOT; });
    await waitFor(() => expect(screen.getByTestId('reasoning-cell-openai-compatible-high')).toBeTruthy());
    fireEvent.change(screen.getByTestId('reasoning-cell-openai-compatible-high'), { target: { value: 'reasoning_effort:medium' } });
    fireEvent.click(screen.getByTestId('reasoning-save'));
    await waitFor(() => expect(sent.mapping).toBeTruthy());
    expect((sent.mapping as Record<string, Record<string, string>>)['openai-compatible'].high).toBe('reasoning_effort:medium');

    sent = {};
    fireEvent.change(screen.getByTestId('reasoning-cell-openai-compatible-high'), { target: { value: 'reasoning_effort:high' } });
    fireEvent.click(screen.getByTestId('reasoning-save'));
    await waitFor(() => expect(sent.mapping).toBeTruthy());
    expect((sent.mapping as Record<string, Record<string, string | null>>)['openai-compatible'].high).toBeNull();
  });

  it('写侧 400 时逐条 diagnostics 点名（不把拒绝洗成"已保存"）', async () => {
    // 用一个**客户端合法但服务端注册表拒**的输入（改默认档），才能验到拒答渲染路径
    vi.stubGlobal('fetch', vi.fn((_input: unknown, init?: unknown) => {
      if (init && (init as { method?: string }).method === 'PUT') {
        return jsonResponse({
          status: 'error',
          error: 'config_value_rejected',
          diagnostics: [{ path: 'defaultLevel', code: 'not-allowed', message: 'defaultLevel 只接受 off/standard/high' }],
        }, false);
      }
      return jsonResponse({ status: 'ok', reasoning: SNAPSHOT });
    }));
    render(<ReasoningDefaultsPanel />);
    await waitFor(() => expect(screen.getByTestId('reasoning-default-level')).toBeTruthy());
    fireEvent.change(screen.getByTestId('reasoning-default-level'), { target: { value: 'high' } });
    fireEvent.click(screen.getByTestId('reasoning-save'));
    const banner = await screen.findByTestId('reasoning-diagnostics');
    expect(banner.textContent).toContain('只接受 off/standard/high');
    expect(screen.getByTestId('reasoning-notice').textContent).not.toContain('已保存');
  });

  it('预算留空（number 输入对非法键入给空串）时前端拦住且不发写入', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ status: 'ok', reasoning: SNAPSHOT }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ReasoningDefaultsPanel />);
    await waitFor(() => expect(screen.getByTestId('reasoning-anthropic-budget')).toBeTruthy());
    fireEvent.change(screen.getByTestId('reasoning-anthropic-budget'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('reasoning-save'));
    expect((await screen.findByTestId('reasoning-notice')).textContent).toContain('预算需为 ≥1024');
    expect(fetchMock).toHaveBeenCalledTimes(1); // 只有 GET
  });
});
