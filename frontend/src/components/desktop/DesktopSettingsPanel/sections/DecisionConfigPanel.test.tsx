/**
 * BLOCK-116 P4 — 决策配置面板契约（mock fetch 渲染 + 开关/阈值交互 + 还原按钮）。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';

const pointsFixture = [
  { point: 'topic-shift', label: '话题漂移判断', enabled: true, envOverride: null, threshold: null, defaultThreshold: null, gates: { yes: 0.85, no: 0.5 }, evidence: 'acceptance/block-110/calibration.json' },
  { point: 'intent-route', label: 'copilot 意图路由', enabled: false, envOverride: null, threshold: 0.7, defaultThreshold: 0.7, gates: null, evidence: 'acceptance/block-112/calibration.json' },
  { point: 'marker-celltype', label: 'marker→细胞类型判别', enabled: true, envOverride: null, threshold: 0.6, defaultThreshold: 0.55, gates: null, evidence: 'acceptance/block-111/calibration.json' },
];

const { DecisionConfigPanel } = await import('./DecisionConfigPanel');

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const r = handler(url, init);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  }) as unknown as typeof fetch;
}

describe('DecisionConfigPanel（BLOCK-116 P4 配置面）', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('渲染五接点卡片：标签/说明/双门限只读/启用勾选/阈值输入', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ status: 200, body: { status: 'ok', points: pointsFixture } })));
    render(<DecisionConfigPanel />);
    await waitFor(() => expect(screen.getAllByText('启用').length).toBe(3));
    expect(screen.getByText('话题漂移判断')).toBeTruthy();
    expect(screen.getByText(/双门限（只读）/)).toBeTruthy();
    expect(screen.getByText(/yes=0.85/)).toBeTruthy();
    const thresholdInputs = screen.getAllByDisplayValue(/0\.(7|6)/) as HTMLInputElement[];
    assert.ok(thresholdInputs.length >= 2);
  });

  it('切换启用 → PUT 只带 enabled', async () => {
    const putSpy = vi.fn(() => ({ status: 200, body: { status: 'ok', point: { ...pointsFixture[1], enabled: true } } }));
    vi.stubGlobal('fetch', mockFetch((url, init) => {
      if (init?.method === 'PUT') return { status: 200, body: putSpy(url, init) };
      return { status: 200, body: { status: 'ok', points: pointsFixture } };
    }) as unknown as typeof fetch);
    render(<DecisionConfigPanel />);
    await waitFor(() => expect(screen.getAllByText('启用').length).toBe(3));
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    const intentBox = checkboxes[1]; // fixture 顺序第二项 intent-route（false → 可勾选）
    fireEvent.click(intentBox);
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    const [url, init] = putSpy.mock.calls[0];
    expect(String(url)).toContain('/ai/decisions/config/intent-route');
    expect(JSON.parse(String(init?.body))).toEqual({ enabled: true });
  });

  it('偏离校准值 → 显示提醒与还原按钮；点击还原 PUT 校准值', async () => {
    const puts: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', mockFetch((url, init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init?.body));
        puts.push(body);
        const target = pointsFixture.find((p) => p.point === 'marker-celltype')!;
        return { status: 200, body: { status: 'ok', point: { ...target, threshold: body.threshold } } };
      }
      return { status: 200, body: { status: 'ok', points: pointsFixture } };
    }) as unknown as typeof fetch);
    render(<DecisionConfigPanel />);
    await waitFor(() => expect(screen.getByText('marker→细胞类型判别')).toBeTruthy());
    expect(screen.getByText(/已偏离校准默认值 0.55/)).toBeTruthy();
    fireEvent.click(screen.getByText(/还原 0.55/));
    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]).toEqual({ threshold: 0.55 });
  });

  it('非法阈值响应：400 时面板显示错误不崩溃', async () => {
    vi.stubGlobal('fetch', mockFetch((url, init) => {
      if (init?.method === 'PUT') return { status: 400, body: { status: 'error', error: 'threshold 必须是 [0,1] 内的有限数值' } };
      return { status: 200, body: { status: 'ok', points: pointsFixture } };
    }) as unknown as typeof fetch);
    render(<DecisionConfigPanel />);
    await waitFor(() => expect(screen.getAllByText('启用').length).toBe(3));
    expect(screen.queryByText(/threshold 必须是/)).toBeNull();
  });
});
