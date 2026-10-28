import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModelMenu, supplierPanelPosition } from './ModelMenu';
import { buildModelGroups, EMPTY_MODEL_CATALOG } from '@/lib/model-catalog';
import type { ChatModelPreset } from '@/hooks/useAiSettings';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
    new Response(JSON.stringify({ status: 'ok', pricing: {} }), { status: 200 }),
  )));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const presets: ChatModelPreset[] = [
  { id: 'a1', label: 'DeepSeek', provider: 'anthropic', model: 'model-a', endpointProfileId: 'a', contextWindow: 128000 },
  { id: 'a2', label: 'DeepSeek', provider: 'anthropic', model: 'model-b', endpointProfileId: 'a', defaultThinkingLevel: 'high' },
];
const groups = buildModelGroups(presets, EMPTY_MODEL_CATALOG);

// UI-617 — 主从两栏：两个供应商用于验证「点其它供应商只换右栏、左列常驻」。
const twoSupplierPresets: ChatModelPreset[] = [
  ...presets,
  { id: 'b1', label: 'Other', provider: 'openai-compatible', model: 'other-1', endpointProfileId: 'b' },
];
const twoGroups = buildModelGroups(twoSupplierPresets, EMPTY_MODEL_CATALOG);

describe('ModelMenu', () => {
  it('模型段渲染上下文/默认思考元信息，点击就绪行回调', () => {
    const onPickModel = vi.fn();
    render(
      <ModelMenu
        mode="model"
        groups={groups}
        selectedGroup={groups[0]}
        activeModelId="a1"
        summary={{ level: 'ok', text: '' }}
        onClose={() => {}}
        onPickSupplier={() => {}}
        onPickModel={onPickModel}
      />
    );
    expect(screen.getByTestId('model-menu')).not.toBeNull();
    expect(screen.getByText('当前使用 · 128K 上下文')).not.toBeNull();
    expect(screen.getByText('高思考')).not.toBeNull();
    fireEvent.click(screen.getByText('model-b'));
    expect(onPickModel).toHaveBeenCalledWith(presets[1]);
  });

  it('缺密钥行禁用并显示原因；供应商无可用模型时禁用', () => {
    const lockedGroups = buildModelGroups(presets, {
      ...EMPTY_MODEL_CATALOG,
      credentialStatus: { anthropic: false },
    });
    const { rerender } = render(
      <ModelMenu
        mode="model"
        groups={lockedGroups}
        selectedGroup={lockedGroups[0]}
        activeModelId="a1"
        summary={{ level: 'ok', text: '' }}
        onClose={() => {}}
        onPickSupplier={() => {}}
        onPickModel={() => {}}
      />
    );
    const row = screen.getByText('model-a').closest('button') as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(screen.getAllByText('未配置密钥').length).toBe(2);

    rerender(
      <ModelMenu
        mode="supplier"
        groups={lockedGroups}
        selectedGroup={lockedGroups[0]}
        activeModelId="a1"
        summary={{ level: 'ok', text: '' }}
        onClose={() => {}}
        onPickSupplier={() => {}}
        onPickModel={() => {}}
      />
    );
    const supplier = screen.getByText('DeepSeek').closest('button') as HTMLButtonElement;
    expect(supplier.disabled).toBe(true);
    expect(screen.getByText('无可用模型')).not.toBeNull();
  });

  it('自动开关行显示解析预览并回调', () => {
    const onToggleAuto = vi.fn();
    render(
      <ModelMenu
        mode="model"
        groups={groups}
        selectedGroup={groups[0]}
        activeModelId="a1"
        summary={{ level: 'ok', text: '' }}
        autoModel
        autoPreview="model-a（工具调用能力）"
        onToggleAuto={onToggleAuto}
        onClose={() => {}}
        onPickSupplier={() => {}}
        onPickModel={() => {}}
      />
    );
    expect(screen.getByTestId('model-menu-auto').textContent).toContain('开启 · model-a');
    fireEvent.click(screen.getByTestId('model-menu-auto'));
    expect(onToggleAuto).toHaveBeenCalledTimes(1);
  });

  it('BLOCK-259 D1 — 价格来自 /api/ai/pricing，逐模型展示', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toContain('/ai/pricing');
      return Promise.resolve(new Response(JSON.stringify({
        status: 'ok',
        pricing: { 'model-a': { input: 0.5, output: 8 } },
      }), { status: 200 }));
    }));
    render(
      <ModelMenu
        mode="model"
        groups={groups}
        selectedGroup={groups[0]}
        activeModelId="a1"
        summary={{ level: 'ok', text: '' }}
        onClose={() => {}}
        onPickSupplier={() => {}}
        onPickModel={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText(/¥0\.5\/¥8 每 1M/)).not.toBeNull());
    expect(screen.getByText('当前使用 · 128K 上下文 · ¥0.5/¥8 每 1M')).not.toBeNull();
  });

  it('BLOCK-259 D1 — 发现失败时「原因 + 价格」同时显示', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      status: 'ok',
      pricing: { 'model-a': { input: 0.5, output: 8 } },
    }), { status: 200 }))));
    const failedGroups = buildModelGroups(presets, {
      ...EMPTY_MODEL_CATALOG,
      discoveryErrors: { a: 'boom' },
    });
    render(
      <ModelMenu
        mode="model"
        groups={failedGroups}
        selectedGroup={failedGroups[0]}
        activeModelId="a1"
        summary={{ level: 'ok', text: '' }}
        onClose={() => {}}
        onPickSupplier={() => {}}
        onPickModel={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText(/加载失败.*¥0\.5\/¥8 每 1M/)).not.toBeNull());
  });

  it('加载中与零可用模型显示状态行', () => {
    const { rerender } = render(
      <ModelMenu
        mode="supplier"
        groups={[]}
        selectedGroup={undefined}
        activeModelId=""
        summary={{ level: 'loading', text: '正在加载模型目录…' }}
        onClose={() => {}}
        onPickSupplier={() => {}}
        onPickModel={() => {}}
      />
    );
    expect(screen.getByTestId('model-menu-status').textContent).toContain('正在加载');
    rerender(
      <ModelMenu
        mode="supplier"
        groups={[]}
        selectedGroup={undefined}
        activeModelId=""
        summary={{ level: 'empty', text: '没有可用模型，请先在设置中配置渠道' }}
        onClose={() => {}}
        onPickSupplier={() => {}}
        onPickModel={() => {}}
      />
    );
    expect(screen.getByTestId('model-menu-status').textContent).toContain('没有可用模型');
  });
});

describe('ModelMenu · 并钮组合菜单（UI-619 主卡/供应商第二卡物理分离）', () => {
  it('supplierPanelPosition：默认右侧、右侧不足向左、视口钳制', () => {
    expect(supplierPanelPosition(
      { left: 100, top: 100, right: 420 },
      { width: 1200, height: 800 },
    )).toEqual({ left: 428, top: 100, width: 248, placement: 'right' });
    const leftFallback = supplierPanelPosition(
      { left: 860, top: 100, right: 1180 },
      { width: 1200, height: 800 },
    );
    expect(leftFallback.placement).toBe('left');
    expect(leftFallback.left).toBe(604);
    const clamped = supplierPanelPosition(
      { left: 40, top: 780, right: 360 },
      { width: 600, height: 800 },
    );
    expect(clamped.left).toBe(12);
    expect(clamped.top).toBe(428);
    expect(supplierPanelPosition(
      { left: 10, top: 10, right: 50 },
      { width: 200, height: 400 },
    ).width).toBe(176);
  });

  it('供应商列表在独立第二卡：入口展开 portal 到 body；切换供应商主卡换模型、第二卡仍在；点模型回调', () => {
    const onPickSupplier = vi.fn();
    const onPickModel = vi.fn();
    const onToggleAuto = vi.fn();
    render(
      <ModelMenu
        mode="all"
        groups={twoGroups}
        selectedGroup={twoGroups[0]}
        activeModelId="a1"
        summary={{ level: 'ok', text: '' }}
        autoModel={false}
        autoPreview=""
        onToggleAuto={onToggleAuto}
        onClose={() => {}}
        onPickSupplier={onPickSupplier}
        onPickModel={onPickModel}
      />,
    );
    // 主卡：供应商入口 + 当前供应商模型；第二卡默认不存在
    expect(screen.getByTestId('model-menu-supplier-trigger').textContent).toContain('DeepSeek');
    expect(screen.getByTestId('model-menu-models')).toBeTruthy();
    expect(screen.queryByTestId('model-menu-supplier-panel')).toBeNull();
    expect(screen.getByText('model-a')).toBeTruthy();
    expect(screen.getByText('model-b')).toBeTruthy();
    // 展开第二卡：独立卡片挂在 body，两个供应商同时可见，当前使用方有勾
    fireEvent.click(screen.getByTestId('model-menu-supplier-trigger'));
    const panel = screen.getByTestId('model-menu-supplier-panel');
    expect(panel.parentElement).toBe(document.body);
    expect(panel.getAttribute('data-placement')).toBe('right');
    expect(screen.getByTestId('model-menu-supplier-a')).toBeTruthy();
    expect(screen.getByTestId('model-menu-supplier-b')).toBeTruthy();
    expect(screen.getByTestId('model-menu-supplier-a').querySelector('svg')).toBeTruthy();
    expect(screen.getByTestId('model-menu-supplier-b').querySelector('svg')).toBeNull();
    // 切其它供应商：主卡换模型，第二卡保持展开（不再出现「其它供应商看不见」）
    fireEvent.click(screen.getByTestId('model-menu-supplier-b'));
    expect(screen.getByTestId('model-menu-supplier-panel')).toBeTruthy();
    expect(screen.getByTestId('model-menu-supplier-b').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('model-menu-supplier-trigger').textContent).toContain('Other');
    expect(screen.getByText('other-1')).toBeTruthy();
    expect(screen.queryByText('model-a')).toBeNull();
    // 点模型 = onPickModel（selectModel 连带切渠道默认）
    fireEvent.click(screen.getByText('other-1'));
    expect(onPickModel).toHaveBeenCalledWith(twoGroups[1].rows[0].preset);
    expect(onPickSupplier).not.toHaveBeenCalled();
  });

  it('all 模式：缺密钥行禁行 + 拒绝理由与 model 模式同源；供应商第二卡仍列出全部', () => {
    const locked = buildModelGroups(twoSupplierPresets, {
      ...EMPTY_MODEL_CATALOG,
      credentialStatus: { anthropic: false },
    });
    render(
      <ModelMenu
        mode="all"
        groups={locked}
        selectedGroup={locked[0]}
        activeModelId="a1"
        summary={{ level: 'ok', text: '' }}
        onClose={() => {}}
        onPickSupplier={() => {}}
        onPickModel={() => {}}
      />,
    );
    const row = screen.getByText('model-a').closest('button') as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(screen.getAllByText('未配置密钥').length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByTestId('model-menu-supplier-trigger'));
    expect(screen.getByTestId('model-menu-supplier-a')).toBeTruthy();
    expect(screen.getByTestId('model-menu-supplier-b')).toBeTruthy();
  });
});
