import { describe, expect, it } from 'vitest';
import {
  EMPTY_MODEL_CATALOG,
  buildModelGroups,
  catalogSummary,
  formatContextWindow,
  isSelectableRow,
  modelAvailability,
  preferredRowForGroup,
} from './model-catalog';
import type { ChatModelPreset } from '@/hooks/useAiSettings';

function preset(overrides: Partial<ChatModelPreset> = {}): ChatModelPreset {
  return {
    id: 'profile-a::model-a',
    label: 'DeepSeek',
    provider: 'anthropic',
    model: 'model-a',
    endpointProfileId: 'profile-a',
    ...overrides,
  };
}

describe('modelAvailability', () => {
  it('缺密钥的已知 provider 标记为 missing_credential（不可选）', () => {
    const result = modelAvailability(preset(), {
      ...EMPTY_MODEL_CATALOG,
      credentialStatus: { anthropic: false },
    });
    expect(result.availability).toBe('missing_credential');
    expect(result.reason).toBe('未配置密钥');
    expect(isSelectableRow({ preset: preset(), ...result })).toBe(false);
  });

  it('自定义 provider 不受凭据布尔门控（本地端点可能无需 Key）', () => {
    const result = modelAvailability(preset({ provider: 'openai-compatible' }), {
      ...EMPTY_MODEL_CATALOG,
      credentialStatus: { 'openai-compatible': false },
    });
    expect(result.availability).toBe('ready');
  });

  it('发现失败标记为 discovery_failed 但仍可选（回退到默认模型）', () => {
    const result = modelAvailability(preset(), {
      ...EMPTY_MODEL_CATALOG,
      discoveryErrors: { 'profile-a': 'HTTP 500' },
    });
    expect(result.availability).toBe('discovery_failed');
    expect(isSelectableRow({ preset: preset(), ...result })).toBe(true);
  });
});

describe('buildModelGroups', () => {
  it('隐藏模型不进选择器；其余按供应商分组并保留顺序', () => {
    const groups = buildModelGroups(
      [
        preset({ id: 'a1', model: 'a1' }),
        preset({ id: 'a2', model: 'a2', visible: false }),
        preset({ id: 'b1', model: 'b1', endpointProfileId: 'profile-b', label: 'Other' }),
      ],
      EMPTY_MODEL_CATALOG
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].rows.map((row) => row.preset.model)).toEqual(['a1']);
    expect(groups[1].supplier).toBe('Other');
  });

  it('preferredRowForGroup 跳过禁用行，优先当前/上次/默认', () => {
    const group = buildModelGroups(
      [preset({ id: 'ready', model: 'ready' }), preset({ id: 'locked', model: 'locked' })],
      { ...EMPTY_MODEL_CATALOG, credentialStatus: { anthropic: false } }
    )[0];
    // 两条都因缺密钥被禁用 → 无首选
    expect(preferredRowForGroup(group, 'ready')).toBeUndefined();
  });
});

describe('catalogSummary', () => {
  it('加载中 / 发现失败降级 / 空态 / 就绪四态', () => {
    expect(catalogSummary({ ...EMPTY_MODEL_CATALOG, loading: true }, []).level).toBe('loading');
    const groups = buildModelGroups([preset()], EMPTY_MODEL_CATALOG);
    expect(
      catalogSummary({ ...EMPTY_MODEL_CATALOG, discoveryErrors: { 'profile-a': 'x' } }, groups)
    ).toEqual({ level: 'degraded', text: '1 个渠道的模型列表加载失败（已回退到默认模型）' });
    expect(catalogSummary(EMPTY_MODEL_CATALOG, []).level).toBe('empty');
    expect(catalogSummary(EMPTY_MODEL_CATALOG, groups).level).toBe('ok');
  });

  it('隐藏导致的空集合给出可读空态', () => {
    const groups = buildModelGroups([preset({ visible: false })], EMPTY_MODEL_CATALOG);
    expect(groups).toHaveLength(0);
    expect(catalogSummary(EMPTY_MODEL_CATALOG, groups).text).toContain('没有可用模型');
  });
});

describe('formatContextWindow', () => {
  it('按 K/M 量级格式化', () => {
    expect(formatContextWindow(128000)).toBe('128K 上下文');
    expect(formatContextWindow(1000000)).toBe('1M 上下文');
    expect(formatContextWindow(undefined)).toBe('');
  });
});
