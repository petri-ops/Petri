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

describe('ModelMenu · 并钮组合菜单（BLOCK-266 mode=all；UI-589 两级导航）', () => {
  it('all 模式：第一级供应商列表（无平铺）→ 点供应商钻取其模型 → 点模型回调 → 返回', () => {
    const onPickSupplier = vi.fn();
    const onPickModel = vi.fn();
    render(
      <ModelMenu
        mode="all"
        groups={groups}
        selectedGroup={groups[0]}
        activeModelId="a1"
        summary={{ level: 'ok', text: '' }}
        onClose={() => {}}
        onPickSupplier={onPickSupplier}
        onPickModel={onPickModel}
      />,
    );
    // 第一级：只有供应商分组标题，模型不平铺
    expect(screen.getByText('DeepSeek')).toBeTruthy();
    expect(screen.queryByText('model-a')).toBeNull();
    expect(screen.queryByText('model-b')).toBeNull();
    // 点供应商标题 = 钻取（不再直接 onPickSupplier 切默认）
    fireEvent.click(screen.getByText('DeepSeek'));
    expect(onPickSupplier).not.toHaveBeenCalled();
    // 第二级：该渠道模型行 + 返回行
    expect(screen.getByTestId('model-menu-back')).toBeTruthy();
    expect(screen.getByText('model-a')).toBeTruthy();
    expect(screen.getByText('model-b')).toBeTruthy();
    // 点模型 = onPickModel 回调（selectModel 连带切渠道默认，供应商级联隐式成立）
    fireEvent.click(screen.getByText('model-b'));
    expect(onPickModel).toHaveBeenCalledWith(groups[0].rows[1].preset);
    expect(onPickSupplier).not.toHaveBeenCalled();
    // 返回 = 回第一级供应商列表
    fireEvent.click(screen.getByTestId('model-menu-back'));
    expect(screen.queryByText('model-b')).toBeNull();
    expect(screen.getByText('DeepSeek')).toBeTruthy();
  });

  it('all 模式：钻取后缺密钥行禁行 + 拒绝理由与 model 模式同源', () => {
    const locked = buildModelGroups(presets, {
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
    fireEvent.click(screen.getByText('DeepSeek'));
    const row = screen.getByText('model-a').closest('button') as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(screen.getAllByText('未配置密钥').length).toBeGreaterThanOrEqual(2);
  });
});
