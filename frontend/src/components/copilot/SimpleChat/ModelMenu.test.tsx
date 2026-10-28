import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModelMenu } from './ModelMenu';
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

describe('ModelMenu · 并钮组合菜单（BLOCK-266 mode=all；UI-617 主从两栏）', () => {
  it('默认选中当前供应商；点其它供应商只换右栏、左列常驻；点模型回调', () => {
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
    // 主从两栏 + 自动档；默认右栏=当前模型所在供应商（DeepSeek）的模型，打开即见可用模型。
    expect(screen.getByTestId('model-menu-two-pane')).toBeTruthy();
    expect(screen.getByTestId('model-menu-suppliers')).toBeTruthy();
    expect(screen.getByTestId('model-menu-models')).toBeTruthy();
    expect(screen.getByTestId('model-menu-auto')).toBeTruthy();
    expect(screen.getByText('model-a')).toBeTruthy();
    expect(screen.getByText('model-b')).toBeTruthy();
    expect(screen.queryByTestId('model-menu-back')).toBeNull();
    // 左列两个供应商同时可见（不再整页替换）
    expect(screen.getByTestId('model-menu-supplier-a')).toBeTruthy();
    expect(screen.getByTestId('model-menu-supplier-b')).toBeTruthy();
    expect(screen.getByTestId('model-menu-supplier-a').getAttribute('data-active')).toBe('true');
    // 点其它供应商：右栏切换到 Other，左列仍在
    fireEvent.click(screen.getByTestId('model-menu-supplier-b'));
    expect(screen.getByTestId('model-menu-supplier-a')).toBeTruthy();
    expect(screen.getByTestId('model-menu-supplier-b').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('model-menu-models-head').textContent).toContain('Other');
    expect(screen.getByText('other-1')).toBeTruthy();
    expect(screen.queryByText('model-a')).toBeNull();
    // 点模型 = onPickModel 回调（selectModel 连带切渠道默认，供应商级联隐式成立）
    fireEvent.click(screen.getByText('other-1'));
    expect(onPickModel).toHaveBeenCalledWith(twoGroups[1].rows[0].preset);
    expect(onPickSupplier).not.toHaveBeenCalled();
  });

  it('all 模式：右栏缺密钥行禁行 + 拒绝理由与 model 模式同源；左列供应商不消失', () => {
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
    // 默认右栏=DeepSeek：禁用行 + 原因；左列供应商仍在
    const row = screen.getByText('model-a').closest('button') as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(screen.getAllByText('未配置密钥').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('model-menu-supplier-a')).toBeTruthy();
  });
});
