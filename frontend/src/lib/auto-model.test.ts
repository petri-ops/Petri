import { describe, expect, it } from 'vitest';
import { describeAutoDecision, imageVisionCapable, resolveAutoPreset } from './auto-model';
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
  it('有图：显式 vision 绑定优先于视觉能力', () => {
    const decision = resolveAutoPreset({
      presets,
      catalog,
      roleBindings: { vision: 'p3' },
      hasImages: true,
      fallbackId: 'p1::m1',
    });
    expect(decision?.preset.endpointProfileId).toBe('p3');
    expect(decision?.role).toBe('vision');
  });

  it('有图且无绑定：选带 vision 能力的可用模型', () => {
    const decision = resolveAutoPreset({ presets, catalog, hasImages: true });
    expect(decision?.preset.endpointProfileId).toBe('p2');
    expect(decision?.reason).toBe('视觉能力');
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

describe('imageVisionCapable（UI-614 图片入口门禁）', () => {
  it('自动模式：用有图决议，手动 active 非视觉也放行', () => {
    expect(imageVisionCapable({
      autoModel: true,
      autoImagePreset: preset({ endpointProfileId: 'p2', capabilities: ['chat', 'vision'] }),
      activeModel: preset({ endpointProfileId: 'p1', capabilities: ['chat', 'tools'] }),
      presets,
    })).toBe(true);
  });

  it('自动模式：有图决议也无视觉 → 阻断', () => {
    expect(imageVisionCapable({
      autoModel: true,
      autoImagePreset: preset({ capabilities: ['chat', 'tools'] }),
      activeModel: preset({ capabilities: ['chat', 'vision'] }),
    })).toBe(false);
  });

  it('手动模式：当前模型声明 vision 放行，显式非视觉阻断', () => {
    expect(imageVisionCapable({
      autoModel: false,
      activeModel: preset({ capabilities: ['chat', 'vision'] }),
    })).toBe(true);
    expect(imageVisionCapable({
      autoModel: false,
      activeModel: preset({ capabilities: ['chat', 'tools'] }),
    })).toBe(false);
  });

  it('手动模式：legacy preset 缺 capabilities → 按同 profile 从完整 presets 补能力位', () => {
    const legacy = { id: 'p2::m2', label: 'P2', provider: 'openai-compatible', model: 'm2' };
    expect(imageVisionCapable({
      autoModel: false,
      activeModel: legacy,
      presets: [preset({ id: 'p2::m2', endpointProfileId: 'p2', model: 'm2', capabilities: ['chat', 'vision'] })],
    })).toBe(true);
  });
});
