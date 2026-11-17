/**
 * BLOCK-456 — 模型级上下文/思考默认档解析（前端镜像）。
 *
 * 后端单源 = core/shared-backend/llm-providers/model-profile.js；本文件是同规则
 * 薄镜像（渲染进程不能 require 后端模块），一致性由 model-preferences.test.ts
 * 的跨源矩阵契约锁定。改规则必须两侧同改。
 *
 * 解析序：modelPreferences[model] 显式覆写 > 渠道级 fallback（旧数据零行为变化）。
 * 存储键写时清洗（normalize），查询键 trim；非法覆写值回落 fallback。
 */

export type ThinkingLevelLike = 'off' | 'standard' | 'high';

export interface ModelPreferenceProfileLike {
  contextWindow?: number;
  defaultThinkingLevel?: string;
  modelPreferences?: Record<string, { contextWindow?: number; thinkingLevel?: string }>;
}

const THINKING_LEVELS: readonly string[] = ['off', 'standard', 'high'];

function prefFor(
  profile: ModelPreferenceProfileLike | null | undefined,
  model: string | undefined,
): { contextWindow?: number; thinkingLevel?: string } | undefined {
  if (!profile || typeof profile !== 'object') return undefined;
  const key = typeof model === 'string' ? model.trim() : '';
  const pref = key ? profile.modelPreferences?.[key] : undefined;
  return pref && typeof pref === 'object' ? pref : undefined;
}

export function resolveModelContextWindow(
  profile: ModelPreferenceProfileLike | null | undefined,
  model: string | undefined,
): number | undefined {
  const override = prefFor(profile, model)?.contextWindow;
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) return Math.round(override);
  const fallback = profile?.contextWindow;
  return typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : undefined;
}

export function resolveModelThinkingDefault(
  profile: ModelPreferenceProfileLike | null | undefined,
  model: string | undefined,
): ThinkingLevelLike | undefined {
  const override = prefFor(profile, model)?.thinkingLevel;
  if (override && THINKING_LEVELS.includes(override)) return override as ThinkingLevelLike;
  const fallback = profile?.defaultThinkingLevel;
  return fallback && THINKING_LEVELS.includes(fallback) ? fallback as ThinkingLevelLike : undefined;
}