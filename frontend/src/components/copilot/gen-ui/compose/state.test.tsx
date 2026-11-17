import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNodeVisible, resolveStateValue } from './catalog';
import { parseComposeSpec } from './spec';
import { ComposeCard } from './ComposeCard';
import { loadWidgetState, saveWidgetState, WIDGET_STATE_MAX_BYTES } from './widgetState';

// BLOCK-461 P2 — 数据面契约（HK-01 红绿先行）。
// $state 绑定经既有 gen-ui:get-data 通道（CP-11 复用）；widgetState 走既有
// /api/gen-ui/widget-state REST（≤16KiB 沿 gen_ui_widget_state 既有上限）。

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // 清掉 defineProperty 注入的 petri 桥（避免泄漏到其它测试文件）
  Reflect.deleteProperty(window, 'petri');
});

describe('resolveStateValue / isNodeVisible（纯函数）', () => {
  it('点分路径取数', () => {
    const state = { rows: { count: 42 }, name: 'alpha' };
    expect(resolveStateValue('$state.rows.count', state)).toBe(42);
    expect(resolveStateValue('$state.name', state)).toBe('alpha');
  });

  it('state 未取到 / 路径断链 → undefined（诚实空值）', () => {
    expect(resolveStateValue('$state.rows.count', null)).toBeUndefined();
    expect(resolveStateValue('$state.missing.deep', { rows: {} })).toBeUndefined();
  });

  it('非 $state 字面量原样返回', () => {
    expect(resolveStateValue('42', { any: 1 })).toBe('42');
  });

  it('visible：$state 真值/假值/未声明', () => {
    const metric = (visible?: string) => ({ kind: 'metric' as const, title: 'x', value: '1', visible });
    expect(isNodeVisible(metric('$state.ready'), { ready: true })).toBe(true);
    expect(isNodeVisible(metric('$state.ready'), { ready: false })).toBe(false);
    expect(isNodeVisible(metric('$state.ready'), null)).toBe(false);
    expect(isNodeVisible(metric(undefined), null)).toBe(true);
  });
});

describe('ComposeCard $state 绑定（get-data 通道复用）', () => {
  const spec = parseComposeSpec({
    version: 1,
    root: 'card1',
    source: { jobId: 'job-1' },
    nodes: {
      card1: { kind: 'card', title: 'Job 概览' },
      m1: { kind: 'metric', parent: 'card1', title: '总行数', value: '$state.rows.count', unit: '行' },
      hidden: { kind: 'metric', parent: 'card1', title: '隐藏指标', value: '9', visible: '$state.ready' },
    },
  });

  function stubGetData(result: { ok: boolean; data?: Record<string, unknown>; code?: string }) {
    // 只替换 petri.genUi.getData（整体替换 window 会破坏 jsdom 的 document/activeElement）
    Object.defineProperty(window, 'petri', {
      configurable: true,
      writable: true,
      value: { genUi: { getData: vi.fn().mockResolvedValue(result) } },
    });
  }

  it('getData 取数后 $state 引用逐节点求值（真实 job 数据驱动）', async () => {
    stubGetData({ ok: true, data: { rows: { count: 7 }, ready: false } });
    render(<ComposeCard spec={spec} conversationId="conv-1" />);
    await waitFor(() => expect(screen.getByText('7 行')).toBeTruthy());
    expect(screen.getByText(/总行数/)).toBeTruthy();
    expect(screen.queryByText(/隐藏指标/)).toBeNull();
  });

  it('getData 失败 → 诚实降级（值显示 — + console 留痕）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubGetData({ ok: false, code: 'get_data_failed' });
    const { container } = render(<ComposeCard spec={spec} conversationId="conv-1" />);
    await waitFor(() => expect(screen.getByText(/总行数/)).toBeTruthy());
    // $state 未取到 → 引用渲染为空值 —（payload 归一 "— 行" 单文本节点）
    expect(container.textContent).toContain('— 行');
    expect(screen.queryByText(/隐藏指标/)).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('widgetState（既有 REST 通道复用，≤16KiB）', () => {
  beforeEach(() => {
    // 工厂函数：Response body 一次性，每次调用新建（避免 "Body has already been used"）
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ok: true, state: null }), { status: 200 }))));
  });

  it('上限常量与既有 gen_ui_widget_state 16KiB 一致', () => {
    expect(WIDGET_STATE_MAX_BYTES).toBe(16 * 1024);
  });

  it('saveWidgetState 超限拒绝（fail-closed，不发请求）', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await saveWidgetState({ scopeKey: 's', filePath: 'f', state: { blob: 'x'.repeat(17 * 1024) } });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loadWidgetState / saveWidgetState 走 backendBase REST 端点', async () => {
    const result = await loadWidgetState({ scopeKey: 's', filePath: 'f' });
    expect(result.ok).toBe(true);
    const saveResult = await saveWidgetState({ scopeKey: 's', filePath: 'f', state: { open: true } });
    expect(saveResult.ok).toBe(true);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
