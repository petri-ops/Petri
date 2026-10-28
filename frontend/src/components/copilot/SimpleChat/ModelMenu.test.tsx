import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModelMenu, modelPanelPosition } from './ModelMenu';
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

describe('ModelMenu · 并钮组合菜单（UI-619 左主卡=供应商 / 右独立卡=模型）', () => {
  it('modelPanelPosition：默认右侧、右侧不足向左、视口钳制', () => {
    expect(modelPanelPosition(
      { left: 100, top: 100, right: 420 },
      { width: 1200, height: 800 },
    )).toEqual({ left: 428, top: 100, width: 320, placement: 'right' });
    const leftFallback = modelPanelPosition(
      { left: 860, top: 100, right: 1180 },
      { width: 1200, height: 800 },
    );
    expect(leftFallback.placement).toBe('left');
    expect(leftFallback.left).toBe(532);
    const clamped = modelPanelPosition(
      { left: 40, top: 780, right: 360 },
      { width: 600, height: 800 },
    );
    expect(clamped.left).toBe(12);
    expect(clamped.top).toBe(368);
    expect(modelPanelPosition(
      { left: 10, top: 10, right: 50 },
      { width: 200, height: 400 },
    ).width).toBe(176);
  });

  it('左主卡常驻全部供应商；右侧模型卡独立 portal 到 body；切供应商只换模型卡；点模型回调', () => {
    const onPickSupplier = vi.fn();
    const onPickModel = vi.fn();
    render(
      <ModelMenu
        mode="all"
        groups={twoGroups}
        selectedGroup={twoGroups[0]}
        activeModelId="a1"
        summary={{ level: 'ok', text: '' }}
        onClose={() => {}}
        onPickSupplier={onPickSupplier}
        onPickModel={onPickModel}
      />,
    );
    // 左主卡=供应商列表（两个供应商同时可见，当前使用方打勾）
    expect(screen.getByTestId('model-menu-suppliers')).toBeTruthy();
    expect(screen.getByTestId('model-menu-supplier-a')).toBeTruthy();
    expect(screen.getByTestId('model-menu-supplier-b')).toBeTruthy();
    expect(screen.getByTestId('model-menu-supplier-a').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('model-menu-supplier-a').querySelector('svg')).toBeTruthy();
    expect(screen.getByTestId('model-menu-supplier-b').querySelector('svg')).toBeNull();
    // 主卡内不再出现模型行
    expect(screen.getByTestId('model-menu').querySelector('.sc-model-option')).toBeNull();
    // 右侧模型卡=独立卡片（portal 到 body），默认当前供应商模型
    const modelsPanel = screen.getByTestId('model-menu-models-panel');
    expect(modelsPanel.parentElement).toBe(document.body);
    expect(modelsPanel.getAttribute('data-placement')).toBe('right');
    expect(screen.getByTestId('model-menu-models-head').textContent).toContain('DeepSeek');
    expect(screen.getByText('model-a')).toBeTruthy();
    expect(screen.getByText('model-b')).toBeTruthy();
    // 切其它供应商：模型卡换内容并保持在场，左主卡全部供应商仍在
    fireEvent.click(screen.getByTestId('model-menu-supplier-b'));
    expect(screen.getByTestId('model-menu-models-panel')).toBeTruthy();
    expect(screen.getByTestId('model-menu-supplier-b').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('model-menu-supplier-a').getAttribute('data-active')).toBe('false');
    expect(screen.getByTestId('model-menu-models-head').textContent).toContain('Other');
    expect(screen.getByText('other-1')).toBeTruthy();
    expect(screen.queryByText('model-a')).toBeNull();
    // 点模型 = onPickModel（selectModel 连带切渠道默认）
    fireEvent.click(screen.getByText('other-1'));
    expect(onPickModel).toHaveBeenCalledWith(twoGroups[1].rows[0].preset);
    expect(onPickSupplier).not.toHaveBeenCalled();
  });

  it('all 模式：模型卡缺密钥行禁行 + 拒绝理由与 model 模式同源；左主卡仍列全部供应商', () => {
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
    expect(screen.getByTestId('model-menu-supplier-a')).toBeTruthy();
    expect(screen.getByTestId('model-menu-supplier-b')).toBeTruthy();
  });
});
