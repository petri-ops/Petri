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

/**
 * UI-614 — 图片输入能力门的「实际执行模型」解析：
 * - 自动模式：用「有图时」的自动决议（不是当前无图时的 agent 绑定）——否则
 *   自动模式下明明会切到视觉模型，入口却按手动模型判死；
 * - 手动模式：用当前模型；旧 bridge/legacy preset 缺 capabilities 时，按同 id /
 *   endpoint / model 从完整 presets 补能力位（配置声明 vision 就应放行）。
 */
function resolveImageVisionPreset(input: {
  autoModel: boolean;
  autoImagePreset?: ChatModelPreset;
  activeModel?: ChatModelPreset;
  presets?: ChatModelPreset[];
}): ChatModelPreset | undefined {
  if (input.autoModel) return input.autoImagePreset || input.activeModel;
  const active = input.activeModel;
  if (!active) return undefined;
  if (Array.isArray(active.capabilities)) return active;
  const presets = input.presets || [];
  const match = presets.find((preset) => preset.id === active.id)
    || presets.find((preset) => preset.endpointProfileId && preset.endpointProfileId === active.id)
    || presets.find((preset) => preset.endpointProfileId
      && preset.endpointProfileId === active.endpointProfileId
      && preset.model === active.model);
  return match ? { ...active, capabilities: match.capabilities } : active;
}

export function imageVisionCapable(input: {
  autoModel: boolean;
  autoImagePreset?: ChatModelPreset;
  activeModel?: ChatModelPreset;
  presets?: ChatModelPreset[];
}): boolean {
  const preset = resolveImageVisionPreset(input);
  return Array.isArray(preset?.capabilities) && preset.capabilities.includes('vision');
}

// ---------- BLOCK-264（C-36）— Auto 定形：复杂度分级 + 决策依据审计 ----------

export type TaskComplexity = 'light' | 'standard' | 'heavy';

export interface ComplexityInput {
  /** 上下文总字符（消息文本 + 引用块） */
  contextChars: number;
  /** 图片附件数 */
  imageCount: number;
  /** composer 显式引用条数（文件/产物/知识） */
  referenceCount: number;
}

export interface ComplexityAssessment {
  level: TaskComplexity;
  /** 决策依据（逐条可解释，进解析预览与审计） */
  factors: string[];
}

/**
 * 确定性复杂度分级（无模型参与——Auto 的「定形」先于模型调用，可审计可复现）：
 *   heavy：图片 ≥2 / 上下文 ≥20000 字 / 引用 ≥5
 *   light：无图 且 上下文 <200 字 且 引用 =0
 *   standard：其余
 */
export function assessComplexity(input: ComplexityInput): ComplexityAssessment {
  const chars = Math.max(0, Math.floor(input.contextChars || 0));
  const images = Math.max(0, Math.floor(input.imageCount || 0));
  const refs = Math.max(0, Math.floor(input.referenceCount || 0));
  const factors: string[] = [];

  if (images >= 2) factors.push(`图片 ${images} 张（多图按重任务对待）`);
  if (chars >= 20000) factors.push(`上下文 ${chars} 字（≥20000 按重任务对待）`);
  if (refs >= 5) factors.push(`引用 ${refs} 条（≥5 按重任务对待）`);
  if (factors.length > 0) return { level: 'heavy', factors };

  if (images === 0 && chars < 200 && refs === 0) {
    return { level: 'light', factors: [`无图、上下文 ${chars} 字、无引用（轻任务）`] };
  }
  const parts: string[] = [];
  if (images > 0) parts.push(`图片 ${images} 张`);
  if (chars >= 200) parts.push(`上下文 ${chars} 字`);
  if (refs > 0) parts.push(`引用 ${refs} 条`);
  return { level: 'standard', factors: [parts.join('、') || '常规任务'] };
}

/** 分级进决策依据（Auto 解析预览显示：模型 × 复杂度）。 */
export function describeAutoDecisionWithComplexity(
  decision: AutoModelDecision | undefined,
  complexity: ComplexityAssessment | null,
): string {
  const base = describeAutoDecision(decision);
  if (!complexity) return base;
  const label: Record<TaskComplexity, string> = { light: '轻', standard: '标准', heavy: '重' };
  return `${base} · ${label[complexity.level]}任务（${complexity.factors[0]}）`;
}
