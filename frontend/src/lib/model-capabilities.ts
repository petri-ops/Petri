/**
 * BLOCK-455 — 模型级能力解析（前端镜像）。
 *
 * 后端单源 = core/shared-backend/llm-providers/model-profile.js；本文件是同规则
 * 薄镜像（渲染进程不能 require 后端模块），一致性由 model-capabilities.test.ts
 * 的跨源矩阵契约锁定。改规则必须两侧同改。
 *
 * 解析序：modelCapabilities[model] 显式覆写 > 渠道 capabilities 兜底（旧数据零行为变化）。
 * 名称推断只用于「测试连接」发现模型时预填显式条目，不是运行时隐式行为。
 */

export interface ModelCapabilityProfileLike {
  capabilities?: string[];
  modelCapabilities?: Record<string, string[]>;
}

// own-enumerable 查找：模型名来自远端 /models，动态下标不得命中原型键（constructor 等）。
function ownRecordValue<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  if (!record || !key) return undefined;
  return Object.entries(record).find(([k]) => k === key)?.[1];
}

/** 显式模型级覆写（无覆写/非法值 = undefined）；declared 判定与解析共用同一查找语义。 */
export function modelCapabilityOverride(
  profile: ModelCapabilityProfileLike | null | undefined,
  model: string | undefined,
): string[] | undefined {
  if (!profile || typeof profile !== 'object') return undefined;
  const key = typeof model === 'string' ? model.trim() : '';
  const override = ownRecordValue(profile.modelCapabilities, key);
  return Array.isArray(override) ? override : undefined;
}

export function resolveModelCapabilities(
  profile: ModelCapabilityProfileLike | null | undefined,
  model: string | undefined,
): string[] {
  if (!profile || typeof profile !== 'object') return [];
  const override = modelCapabilityOverride(profile, model);
  if (override) return override;
  return Array.isArray(profile.capabilities) ? profile.capabilities : [];
}

export function inferModelCapabilities(modelName: string | undefined): string[] {
  const name = typeof modelName === 'string' ? modelName.trim().toLowerCase() : '';
  if (!name) return ['chat', 'streaming', 'tools'];
  if (/embed|bge|gte-|(?:^|[-_])m3(?:$|[-_])/.test(name)) return ['embedding'];
  const capabilities = ['chat', 'streaming', 'tools'];
  if (/vl|vision|4o|claude|gemini|qvq|omni/.test(name)) capabilities.push('vision');
  if (/reasoner|reasoning|thinking|qwq|magistral|(?:^|[^a-z0-9])(?:o1|o3|o4|r1)(?:[^a-z0-9]|$)/.test(name)) {
    capabilities.push('reasoning');
  }
  return capabilities;
}

/** 角色绑定值解析：`profileId::encodeURIComponent(model)` 对；裸 id = 渠道默认模型。 */
export function parseModelBinding(value: string | undefined | null): { profileId: string; model?: string } {
  const raw = typeof value === 'string' ? value.trim() : '';
  const separator = raw.indexOf('::');
  if (separator < 0) return { profileId: raw };
  const encoded = raw.slice(separator + 2);
  let model: string;
  try {
    model = decodeURIComponent(encoded);
  } catch {
    model = encoded;
  }
  return { profileId: raw.slice(0, separator).trim(), model: model || undefined };
}

/**
 * BLOCK-455 — 发现模型时的推断预填（零回归规则）：
 * ①不覆盖已有显式条目；②向量系模型名（推断仅 embedding）写 ['embedding']；
 * ③其余仅在推断增益超出渠道声明时写「渠道∪推断」并集；无增益不物化。
 * 返回合并后的覆写表；无任何新增时返回 undefined（调用方保持原状）。
 */
export function prefillModelCapabilities(
  profile: ModelCapabilityProfileLike,
  models: string[],
): Record<string, string[]> | undefined {
  const existing = profile.modelCapabilities || {};
  const channelCaps = Array.isArray(profile.capabilities) ? profile.capabilities : [];
  const additions: Array<[string, string[]]> = [];
  for (const model of models) {
    if (Array.isArray(ownRecordValue(existing, model))) continue;
    const inferred = inferModelCapabilities(model);
    if (inferred.length === 1 && inferred[0] === 'embedding') {
      additions.push([model, ['embedding']]);
      continue;
    }
    const gains = inferred.filter((cap) => !channelCaps.includes(cap));
    if (gains.length > 0) additions.push([model, [...new Set([...channelCaps, ...inferred])]]);
  }
  return additions.length > 0 ? { ...existing, ...Object.fromEntries(additions) } : undefined;
}