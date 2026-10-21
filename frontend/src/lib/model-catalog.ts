/**
 * modelCatalog — BLOCK-224 模型选择器的纯决策层（可单测）。
 *
 * 输入=预设列表 + 目录状态（加载/发现失败/凭据），输出=分组行 + 可用性 + 摘要。
 * 规则：
 *  - `visible === false` 的预设不进选择器（不影响已绑定/正在使用的解析）；
 *  - 已知需要密钥的 provider 且 `credential_status[provider] === false` → 禁用行；
 *  - 模型发现失败 → 行标黄但**仍可选**（回退到 profile 默认模型，不改变可用集合）。
 */

import { modelProviderRequiresCredential } from '@/lib/model-provider-options';
import type { ChatModelPreset } from '@/hooks/useAiSettings';

export type ModelAvailability = 'ready' | 'missing_credential' | 'discovery_failed';

export interface ModelCatalogState {
  loading: boolean;
  discoveryErrors: Record<string, string>;
  credentialStatus: Record<string, boolean>;
}

export const EMPTY_MODEL_CATALOG: ModelCatalogState = Object.freeze({
  loading: false,
  discoveryErrors: {},
  credentialStatus: {},
});

export interface ModelCatalogRow {
  preset: ChatModelPreset;
  availability: ModelAvailability;
  reason: string | null;
}

export interface ModelCatalogGroup {
  key: string;
  supplier: string;
  defaultModel: string;
  lastSelectedModel: string;
  rows: ModelCatalogRow[];
}

export function modelAvailability(
  preset: ChatModelPreset,
  catalog: ModelCatalogState | null | undefined
): { availability: ModelAvailability; reason: string | null } {
  const state = catalog || EMPTY_MODEL_CATALOG;
  if (modelProviderRequiresCredential(preset.provider) && state.credentialStatus[preset.provider] === false) {
    return { availability: 'missing_credential', reason: '未配置密钥' };
  }
  const scope = preset.endpointProfileId || preset.id;
  if (state.discoveryErrors && state.discoveryErrors[scope]) {
    return { availability: 'discovery_failed', reason: '模型列表加载失败，已回退到默认模型' };
  }
  return { availability: 'ready', reason: null };
}

export function isSelectableRow(row: ModelCatalogRow): boolean {
  return row.availability !== 'missing_credential';
}

/** 隐藏模型被过滤；分组顺序沿用预设顺序。 */
export function buildModelGroups(
  presets: ChatModelPreset[],
  catalog: ModelCatalogState | null | undefined
): ModelCatalogGroup[] {
  const groups: ModelCatalogGroup[] = [];
  for (const preset of presets || []) {
    if (preset.visible === false) continue;
    const supplier = preset.label || preset.provider;
    const key = preset.endpointProfileId || preset.provider;
    const availability = modelAvailability(preset, catalog);
    const row: ModelCatalogRow = { preset, ...availability };
    const existing = groups.find((group) => group.key === key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    groups.push({
      key,
      supplier,
      defaultModel: preset.defaultModel || preset.model,
      lastSelectedModel: preset.lastSelectedModel || preset.model,
      rows: [row],
    });
  }
  return groups;
}

export function groupSelectableRows(group: ModelCatalogGroup | undefined): ModelCatalogRow[] {
  return (group?.rows || []).filter(isSelectableRow);
}

export function preferredRowForGroup(
  group: ModelCatalogGroup | undefined,
  activeModelId: string | undefined
): ModelCatalogRow | undefined {
  const selectable = groupSelectableRows(group);
  if (selectable.length === 0) return undefined;
  return selectable.find((row) => row.preset.id === activeModelId)
    || selectable.find((row) => row.preset.model === group?.lastSelectedModel)
    || selectable.find((row) => row.preset.model === group?.defaultModel)
    || selectable[0];
}

export interface CatalogSummary {
  level: 'ok' | 'loading' | 'degraded' | 'empty';
  text: string;
}

export function catalogSummary(
  catalog: ModelCatalogState | null | undefined,
  groups: ModelCatalogGroup[]
): CatalogSummary {
  const state = catalog || EMPTY_MODEL_CATALOG;
  if (state.loading) return { level: 'loading', text: '正在加载模型目录…' };
  const selectable = (groups || []).reduce((sum, group) => sum + groupSelectableRows(group).length, 0);
  if (selectable === 0) {
    return {
      level: 'empty',
      text: (groups || []).length === 0 ? '没有可用模型，请先在设置中配置渠道' : '所有模型均不可用，请检查密钥或连接',
    };
  }
  const failedProfiles = Object.keys(state.discoveryErrors || {}).length;
  if (failedProfiles > 0) {
    return { level: 'degraded', text: `${failedProfiles} 个渠道的模型列表加载失败（已回退到默认模型）` };
  }
  return { level: 'ok', text: '' };
}

export function formatContextWindow(contextWindow: number | undefined): string {
  if (!contextWindow || contextWindow <= 0) return '';
  if (contextWindow >= 1_000_000) return `${Math.round(contextWindow / 100_000) / 10}M 上下文`;
  if (contextWindow >= 1_000) return `${Math.round(contextWindow / 1_000)}K 上下文`;
  return `${contextWindow} 上下文`;
}
