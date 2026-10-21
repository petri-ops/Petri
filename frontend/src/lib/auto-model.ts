/**
 * auto-model — BLOCK-225 D4 自动选模型的纯解析层。
 *
 * 只在「发送时」决定本轮用哪个模型，不写回 active_chat_model_id：
 *   1. 有图片：显式 vision 角色绑定 > 带 vision 能力的可用模型；
 *   2. 无图片：显式 agent 角色绑定 > 带 tools 能力的可用模型；
 *   3. 都没有：当前模型 > 第一个可用模型。
 * 候选必须过 BLOCK-224 可用性门（隐藏/缺密钥不选）。
 */

import type { ChatModelPreset } from '@/hooks/useAiSettings';
import { isSelectableRow, modelAvailability, type ModelCatalogState } from './model-catalog';

export interface AutoModelInput {
  presets: ChatModelPreset[];
  catalog?: ModelCatalogState | null;
  roleBindings?: Record<string, string> | null;
  hasImages: boolean;
  fallbackId?: string;
}

export interface AutoModelDecision {
  preset: ChatModelPreset;
  reason: string;
  role: 'vision' | 'agent' | 'fallback';
}

function isAvailable(preset: ChatModelPreset, catalog: ModelCatalogState | null | undefined): boolean {
  if (preset.visible === false) return false;
  return isSelectableRow({ preset, ...modelAvailability(preset, catalog) });
}

function byBinding(
  candidates: ChatModelPreset[],
  bindingId: string | undefined
): ChatModelPreset | undefined {
  if (!bindingId) return undefined;
  const matches = candidates.filter((preset) => (preset.endpointProfileId || preset.id) === bindingId);
  if (matches.length === 0) return undefined;
  return matches.find((preset) => preset.model === preset.defaultModel) || matches[0];
}

function byCapability(candidates: ChatModelPreset[], capability: 'vision' | 'tools'): ChatModelPreset | undefined {
  return candidates.find((preset) => (preset.capabilities || []).includes(capability));
}

export function resolveAutoPreset(input: AutoModelInput): AutoModelDecision | undefined {
  const available = (input.presets || []).filter((preset) => isAvailable(preset, input.catalog));
  if (available.length === 0) return undefined;
  const bindings = input.roleBindings || {};

  if (input.hasImages) {
    const bound = byBinding(available, bindings.vision);
    if (bound) return { preset: bound, reason: '识图角色绑定', role: 'vision' };
    const capable = byCapability(available, 'vision');
    if (capable) return { preset: capable, reason: '视觉能力', role: 'vision' };
  } else {
    const bound = byBinding(available, bindings.agent);
    if (bound) return { preset: bound, reason: 'Agent 角色绑定', role: 'agent' };
    const capable = byCapability(available, 'tools');
    if (capable) return { preset: capable, reason: '工具调用能力', role: 'agent' };
  }

  const fallback = available.find((preset) => preset.id === input.fallbackId) || available[0];
  return { preset: fallback, reason: '回落当前模型', role: 'fallback' };
}

export function describeAutoDecision(decision: AutoModelDecision | undefined): string {
  if (!decision) return '没有可用模型';
  return `${decision.preset.model}（${decision.reason}）`;
}
