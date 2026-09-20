import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsageResourcePanel } from './sections/UsageResourcePanel';

vi.mock('@/hooks/useRuntimeResourceSnapshot', () => ({
  useRuntimeResourceSnapshot: () => ({
    snapshot: null,
    loading: false,
    error: '',
    refresh: async () => {},
  }),
}));

function usageResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    days: 30,
    calls: 12,
    prompt_tokens: 1000,
    completion_tokens: 800,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    estimated_cost_cny: 0.05,
    unknown_cost_calls: 0,
    cache_hit_rate: 0,
    avg_latency: 4200,
    cost_status: 'estimated',
    providers: [
      { provider: 'deepseek', calls: 10, inputTokens: 900, outputTokens: 700, latencyMs: 35000, measurableCalls: 10, noUsageCalls: 0, tokensPerSecond: 20, measurable: true },
      { provider: 'ollama', calls: 2, inputTokens: 100, outputTokens: 0, latencyMs: 900, measurableCalls: 0, noUsageCalls: 2, tokensPerSecond: null, measurable: false },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => usageResponse(),
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('UsageResourcePanel（BLOCK-79 按供应商速率）', () => {
  it('按供应商渲染速率行：tok/s、输出 token、平均延迟', async () => {
    render(<UsageResourcePanel />);
    expect(await screen.findByText('供应商速率（30 天）')).toBeTruthy();
    expect(await screen.findByText('20 tok/s')).toBeTruthy();
    expect(screen.getByText(/deepseek · 10 次调用/)).toBeTruthy();
    expect(screen.getByText(/700 tok/)).toBeTruthy();
    expect(screen.getByText(/全部供应商 · 平均延迟/)).toBeTruthy();
    expect(screen.getByText('4.20 s')).toBeTruthy();
  });

  it('渠道未返回用量 → 显示「不可算」而非 0', async () => {
    render(<UsageResourcePanel />);
    expect(await screen.findByText('不可算（未返回用量）')).toBeTruthy();
  });

  it('无记录：诚实空态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => usageResponse({ calls: 0, providers: [] }),
    })));
    render(<UsageResourcePanel />);
    expect(await screen.findByText('暂无可统计的调用记录。')).toBeTruthy();
  });
});
