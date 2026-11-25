import { describe, expect, it } from 'vitest';
import { describeAutoDecision, resolveAutoPreset } from './auto-model';
import { EMPTY_MODEL_CATALOG } from './model-catalog';
import type { ChatModelPreset } from '@/hooks/useAiSettings';

function preset(overrides: Partial<ChatModelPreset> = {}): ChatModelPreset {
  return {
    id: 'p1::m1',
    label: 'P1',
    provider: 'openai-compatible',
    model: 'm1',
    endpointProfileId: 'p1',
    capabilities: ['chat', 'tools'],
    ...overrides,
  };
}

const catalog = EMPTY_MODEL_CATALOG;
const presets = [
  preset({ id: 'p1::m1', model: 'm1', capabilities: ['chat', 'tools'] }),
  preset({ id: 'p2::m2', model: 'm2', endpointProfileId: 'p2', capabilities: ['chat', 'vision'] }),
  preset({ id: 'p3::m3', model: 'm3', endpointProfileId: 'p3', capabilities: ['chat', 'tools'] }),
];

describe('resolveAutoPreset', () => {
  it('试用反馈②：识图角色退役——有图也不走 vision 绑定，旧绑定被忽略走通用路由', () => {
    const decision = resolveAutoPreset({
      presets,
      catalog,
      roleBindings: { vision: 'p3' },
      hasImages: true,
      fallbackId: 'p1::m1',
    });
    expect(decision?.role).not.toBe('vision');
    expect(decision?.preset.endpointProfileId).not.toBe('p3');
  });

  it('试用反馈②：有图无绑定不再按 vision 能力选模型（该能力位已退役）', () => {
    const decision = resolveAutoPreset({ presets, catalog, hasImages: true });
    expect(decision?.preset.endpointProfileId).not.toBe('p2');
    expect(decision?.reason).not.toBe('视觉能力');
  });

  it('无图：agent 绑定优先，其次 tools 能力', () => {
    const bound = resolveAutoPreset({
      presets,
      catalog,
      roleBindings: { agent: 'p3' },
      hasImages: false,
    });
    expect(bound?.preset.endpointProfileId).toBe('p3');
    expect(bound?.reason).toBe('Agent 角色绑定');

    const capable = resolveAutoPreset({ presets, catalog, hasImages: false });
    expect(capable?.preset.endpointProfileId).toBe('p1');
    expect(capable?.reason).toBe('工具调用能力');
  });

  it('跳过缺密钥/隐藏候选，绑定失效时回落能力位', () => {
    const locked = [
      preset({ id: 'p1::m1', provider: 'anthropic', capabilities: ['chat', 'tools'] }),
      preset({ id: 'p2::m2', endpointProfileId: 'p2', capabilities: ['chat', 'tools'] }),
    ];
    const decision = resolveAutoPreset({
      presets: locked,
      catalog: { ...catalog, credentialStatus: { anthropic: false } },
      roleBindings: { agent: 'p1' },
      hasImages: false,
      fallbackId: 'p1::m1',
    });
    expect(decision?.preset.endpointProfileId).toBe('p2');

    const hidden = resolveAutoPreset({
      presets: presets.map((item, index) => index === 0 ? { ...item, visible: false } : item),
      catalog,
      hasImages: false,
      fallbackId: 'p1::m1',
    });
    expect(hidden?.preset.endpointProfileId).toBe('p3');
  });

  it('无可用候选返回 undefined；无可路由时回落当前模型', () => {
    expect(resolveAutoPreset({
      presets: [preset({ provider: 'anthropic' })],
      catalog: { ...catalog, credentialStatus: { anthropic: false } },
      hasImages: false,
    })).toBeUndefined();

    const noCaps = [preset({ id: 'x', capabilities: ['chat'] }), preset({ id: 'y', endpointProfileId: 'y', capabilities: ['chat'] })];
    const fallback = resolveAutoPreset({ presets: noCaps, catalog, hasImages: false, fallbackId: 'y' });
    expect(fallback?.preset.id).toBe('y');
    expect(fallback?.role).toBe('fallback');
    expect(describeAutoDecision(fallback)).toContain('回落当前模型');
  });
});

describe('BLOCK-455 渠道::模型 对绑定', () => {
  it('试用反馈②：旧 vision 对绑定不再参与路由（存储兼容但 UI/路由已退役）', () => {
    const candidates = [
      preset({ id: 'ep::a', endpointProfileId: 'ep', model: 'a', defaultModel: 'a', capabilities: ['chat', 'tools'] }),
      preset({ id: 'ep::b', endpointProfileId: 'ep', model: 'b', defaultModel: 'a', capabilities: ['chat', 'tools'] }),
    ];
    const decision = resolveAutoPreset({
      presets: candidates,
      catalog,
      roleBindings: { vision: 'ep::b' },
      hasImages: true,
    });
    expect(decision?.preset.model).not.toBe('b');
    expect(decision?.role).not.toBe('vision');
  });
});
