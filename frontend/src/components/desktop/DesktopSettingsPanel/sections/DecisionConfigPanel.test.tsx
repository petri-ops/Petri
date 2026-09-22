/**
 * BLOCK-116 P4 — 决策配置面板契约（渲染 + 开关/阈值交互 + 偏离提醒与还原 + PUT 断言）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';

interface PointConfig {
  point: string;
  label: string;
  enabled: boolean;
  envOverride: 'on' | 'off' | null;
  threshold: number | null;
  defaultThreshold: number | null;
  gates: Record<string, number> | null;
  evidence: string | null;
}

const pointsFixture: PointConfig[] = [
  { point: 'topic-shift', label: '话题漂移判断', enabled: true, envOverride: null, threshold: null, defaultThreshold: null, gates: { yes: 0.85, no: 0.5 }, evidence: 'acceptance/block-110/calibration.json' },
  { point: 'intent-route', label: 'copilot 意图路由', enabled: false, envOverride: null, threshold: 0.7, defaultThreshold: 0.7, gates: null, evidence: 'acceptance/block-112/calibration.json' },
  { point: 'marker-celltype', label: 'marker→细胞类型判别', enabled: true, envOverride: null, threshold: 0.6, defaultThreshold: 0.55, gates: null, evidence: 'acceptance/block-111/calibration.json' },
];

const { DecisionConfigPanel } = await import('./DecisionConfigPanel');

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
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: () => Promise.resolve(r.body),
    };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('DecisionConfigPanel（BLOCK-116 P4 配置面）', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('渲染接点卡片：标签/说明/双门限只读/启用勾选/阈值输入', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ status: 200, body: { status: 'ok', points: pointsFixture } })).fn);
    render(<DecisionConfigPanel />);
    await waitFor(() => expect(screen.getAllByText('启用').length).toBe(3));
    expect(screen.getByText('话题漂移判断')).toBeTruthy();
    expect(screen.getByText(/双门限（只读）/)).toBeTruthy();
    expect(screen.getByText(/yes=0.85/)).toBeTruthy();
  });

  it('切换启用 → PUT 只带 enabled 到对应接点', async () => {
    const { fn, calls } = mockFetch((url, init) => {
      if (init?.method === 'PUT') {
        const body: Record<string, unknown> = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
        const target = pointsFixture.find((pp) => url.includes(pp.point)) ?? pointsFixture[0];
        return { status: 200, body: { status: 'ok', point: { ...target, ...body } } };
      }
      return { status: 200, body: { status: 'ok', points: pointsFixture } };
    });
    vi.stubGlobal('fetch', fn);
    render(<DecisionConfigPanel />);
    await waitFor(() => expect(screen.getAllByText('启用').length).toBe(3));
    // 双工具对 getAllByRole 返回类型判定不一致：断言保 tsc 侧 .checked 访问（下一行定向禁用）
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    const intentBox = checkboxes.find((box) => !box.checked) as HTMLInputElement;
    expect(intentBox).toBeTruthy();
    fireEvent.click(intentBox);
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT');
      expect(put).toBeTruthy();
    });
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toContain('/ai/decisions/config/intent-route');
    expect(put.body).toEqual({ enabled: true });
  });

  it('偏离校准值 → 提醒 + 还原按钮；点击还原 PUT 校准值', async () => {
    const { fn, calls } = mockFetch((url, init) => {
      if (init?.method === 'PUT') {
        const body: Record<string, unknown> = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
        const target = pointsFixture.find((pp) => url.includes('marker-celltype')) ?? pointsFixture[0];
        return { status: 200, body: { status: 'ok', point: { ...target, ...body } } };
      }
      return { status: 200, body: { status: 'ok', points: pointsFixture } };
    });
    vi.stubGlobal('fetch', fn);
    render(<DecisionConfigPanel />);
    await waitFor(() => expect(screen.getByText('marker→细胞类型判别')).toBeTruthy());
    expect(screen.getByText(/已偏离校准默认值 0.55/)).toBeTruthy();
    fireEvent.click(screen.getByText(/还原 0.55/));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toBeTruthy();
    expect(put!.url).toContain('/ai/decisions/config/marker-celltype');
    expect(put!.body).toEqual({ threshold: 0.55 });
  });
});
