// UI-707（BLOCK-456，承接 UI-MODELCFG-1 / UI-696）/ UI-COLLAPSE-2 契约：
// ① 上下文窗口与思考强度跟具体模型走：模型行悬停/聚焦展开行内配置抽屉，
//    写回该模型的 modelPreferences（onModelConfigChange 按 presetId 定向回调）
// ② 左面板快捷块退役（model-menu-quick 不再存在）；禁行不展开抽屉
// ③ 能力位未声明时思考滑条灰显并给出原因，写回结果可见
// ④ 折叠时机：本轮 run 内统一展开、run 结束统一折叠（UI-COLLAPSE-2 不变）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ModelMenu } from './ModelMenu';
import { buildModelGroups, EMPTY_MODEL_CATALOG } from '@/lib/model-catalog';
import type { ChatModelPreset } from '@/hooks/useAiSettings';
import { contextWindowScale } from '@/lib/context-window-options';
import { isMessageInActiveRun, resolveActiveRunStartIndex } from './activeRunWindow';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
    new Response(JSON.stringify({ status: 'ok', pricing: {} }), { status: 200 }),
  )));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noop = () => {};

const presets: ChatModelPreset[] = [
  {
    id: 'p1::model-a',
    label: 'DeepSeek',
    provider: 'anthropic',
    model: 'model-a',
    endpointProfileId: 'p1',
    contextWindow: 64000,
    defaultThinkingLevel: 'standard',
    capabilities: ['chat', 'reasoning'],
  },
  {
    id: 'p1::model-b',
    label: 'DeepSeek',
    provider: 'anthropic',
    model: 'model-b',
    endpointProfileId: 'p1',
    contextWindow: 128000,
  },
];
const groups = buildModelGroups(presets, EMPTY_MODEL_CATALOG);

function renderMenu(overrides: Partial<React.ComponentProps<typeof ModelMenu>> = {}) {
  return render(
    <ModelMenu
      mode="model"
      groups={groups}
      selectedGroup={groups[0]}
      activeModelId="p1::model-a"
      summary={{ level: 'ok', text: '' }}
      onClose={noop}
      onPickSupplier={noop}
      onPickModel={noop}
      {...overrides}
    />,
  );
}

describe('UI-707 模型行悬停配置（跟具体模型走）', () => {
  it('每个就绪模型行带行内配置抽屉，值来自该模型自身', () => {
    renderMenu({ onModelConfigChange: noop });
    expect(screen.queryByTestId('model-menu-quick')).toBeNull();
    const configA = screen.getByTestId('model-row-config-p1::model-a');
    expect(configA.querySelector('[data-testid="model-row-context-p1::model-a"]')?.getAttribute('data-value')).toBe('64000');
    expect(configA.querySelector('[data-testid="model-row-thinking-p1::model-a"]')?.getAttribute('data-level')).toBe('standard');
    expect(screen.getByTestId('model-row-context-p1::model-b').getAttribute('data-value')).toBe('128000');
    expect(screen.getAllByText('上下文窗口').length).toBe(2);
    expect(screen.getAllByText('思考强度').length).toBe(2);
  });

  it('拖动滑条按 presetId 定向回调（写模型级偏好，不再需要进设置页）', () => {
    const onConfig = vi.fn();
    renderMenu({ onModelConfigChange: onConfig });
    fireEvent.change(screen.getByTestId('model-row-context-p1::model-a'), { target: { value: '2' } });
    expect(onConfig).toHaveBeenCalledWith('p1::model-a', { contextWindow: 128000 });
    fireEvent.change(screen.getByTestId('model-row-thinking-p1::model-a'), { target: { value: '2' } });
    expect(onConfig).toHaveBeenCalledWith('p1::model-a', { defaultThinkingLevel: 'high' });
  });

  it('点击档位刻度也能切换该模型的默认思考档', () => {
    const onConfig = vi.fn();
    renderMenu({ onModelConfigChange: onConfig });
    const configA = screen.getByTestId('model-row-config-p1::model-a');
    const highTick = configA.querySelector('button[aria-label="思考强度：高"]') as HTMLButtonElement;
    fireEvent.click(highTick);
    expect(onConfig).toHaveBeenCalledWith('p1::model-a', { defaultThinkingLevel: 'high' });
  });

  it('模型未声明思考能力时滑条灰显并给出原因（能力位跟模型走）', () => {
    renderMenu({ onModelConfigChange: noop });
    expect(screen.getByTestId('model-row-thinking-p1::model-a').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('model-row-thinking-p1::model-b').hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/未声明思考能力/)).toBeTruthy();
  });

  it('禁行（缺密钥）不展开配置抽屉', () => {
    const locked = buildModelGroups(presets, {
      ...EMPTY_MODEL_CATALOG,
      credentialStatus: { anthropic: false },
    });
    renderMenu({ groups: locked, selectedGroup: locked[0], onModelConfigChange: noop });
    expect(screen.queryByTestId('model-row-config-p1::model-a')).toBeNull();
    expect(screen.queryByTestId('model-row-config-p1::model-b')).toBeNull();
  });

  it('未提供写回回调时不渲染抽屉（零打扰）', () => {
    renderMenu();
    expect(screen.queryByTestId('model-row-config-p1::model-a')).toBeNull();
  });

  it('快捷写回结果可见（失败不静默）', () => {
    renderMenu({ quickNotice: { text: '保存失败，已回退到服务端值', tone: 'error' } });
    expect(screen.getByTestId('model-menu-quick-notice').textContent).toContain('保存失败');
  });

  it('历史自定义窗口值不在档位表里时并入刻度轴，不被静默改写', () => {
    expect(contextWindowScale(256000, [32000, 64000, 128000])).toEqual([32000, 64000, 128000, 256000]);
    expect(contextWindowScale(undefined, [32000, 64000])).toEqual([32000, 64000]);
  });
});

describe('UI-COLLAPSE-2 折叠时机', () => {
  const messages = [
    { role: 'user' },
    { role: 'assistant' },
    { role: 'assistant' },
    { role: 'user' },
    { role: 'assistant' },
  ];

  it('run 进行中：本轮 user 之后的消息都属于 active run（统一展开）', () => {
    const start = resolveActiveRunStartIndex(messages, true);
    expect(start).toBe(3);
    expect(isMessageInActiveRun(messages, true, 4)).toBe(true);
    expect(isMessageInActiveRun(messages, true, 1)).toBe(false);
  });

  it('run 结束：不再有 active run，全部按 settled 折叠（统一折叠）', () => {
    expect(resolveActiveRunStartIndex(messages, false)).toBe(-1);
    for (let i = 0; i < messages.length; i += 1) {
      expect(isMessageInActiveRun(messages, false, i)).toBe(false);
    }
  });

  it('负测：历史轮次不因本轮 run 而炸开（只展开本轮窗口）', () => {
    // index 2 属上一轮（最后一个 user 之前）→ 保持折叠；
    // 本轮若有多条 assistant（如 index 4/5 连续输出）→ 全部保持展开。
    const longRun = [...messages, { role: 'assistant' }];
    expect(isMessageInActiveRun(longRun, true, 2)).toBe(false);
    expect(isMessageInActiveRun(longRun, true, 4)).toBe(true);
    expect(isMessageInActiveRun(longRun, true, 5)).toBe(true);
  });
});