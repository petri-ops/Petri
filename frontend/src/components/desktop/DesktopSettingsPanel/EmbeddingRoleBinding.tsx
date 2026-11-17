// EmbeddingRoleBinding — 向量模型（语义检索）角色选择器（UI-638 加映四）。
//
// 用途：知识空间语义检索 + 对话记忆召回。向量库固定 1024 维，换绑到输出维度
// 不同的模型时后端会整批拒收并降级（helpers/embedding-dim-guard.js），所以
// 候选=已声明「向量」能力的模型，且提示必须输出 1024 维（如 bge-m3）。
// BLOCK-455 D7 — 候选为 (渠道, 模型) 对，值用 `渠道id::encodeURIComponent(模型)`；
// 能力按模型解析（modelCapabilities 覆写 > 渠道兜底），legacy 裸绑定归一显示。

import type { ChatModelPreset } from '@/hooks/useAiSettings';
import { parseModelBinding, resolveModelCapabilities } from '@/lib/model-capabilities';
import { modelChoiceId } from '@/lib/model-provider-options';

export function hasEmbeddingCapability(profile: ChatModelPreset): boolean {
  return resolveModelCapabilities(profile, profile.model).includes('embedding');
}

export interface EmbeddingRoleBindingProps {
  /** 全部模型档案（含内置/本地）；内部过滤出声明 embedding 的模型对。 */
  profiles: ChatModelPreset[];
  /** 连通性测试发现的模型（逐对展开候选）。 */
  availableModels?: Record<string, string[]>;
  value?: string;
  onChange: (binding: string) => void;
}

export function EmbeddingRoleBinding({ profiles, availableModels, value, onChange }: EmbeddingRoleBindingProps) {
  const candidates: { value: string; label: string }[] = [];
  for (const profile of profiles) {
    const models = Array.from(new Set(
      [profile.defaultModel || profile.model, ...(availableModels?.[profile.id] || [])].filter(Boolean),
    ));
    for (const model of models) {
      if (!resolveModelCapabilities(profile, model).includes('embedding')) continue;
      candidates.push({
        value: modelChoiceId(profile.id, model),
        label: `${profile.label || profile.id}（${model}）`,
      });
    }
  }
  const binding = parseModelBinding(value);
  const boundProfile = binding.profileId ? profiles.find((p) => p.id === binding.profileId) : undefined;
  const effectiveValue = value
    ? (binding.model ? value : modelChoiceId(binding.profileId, boundProfile?.model || boundProfile?.defaultModel || ''))
    : '';
  if (effectiveValue && !candidates.some((c) => c.value === effectiveValue)) {
    candidates.push({
      value: effectiveValue,
      label: `${boundProfile?.label || binding.profileId}（${binding.model || boundProfile?.model || '未知模型'} · 能力不符，请重选）`,
    });
  }
  return (
    <div className="petri-model-role-binding" data-testid="embedding-role-binding">
      <label className="petri-model-role-binding__label">
        向量模型（语义检索）
        <select
          className="petri-select"
          value={effectiveValue}
          onChange={(e) => onChange(e.target.value)}
          aria-label="向量模型（embedding 角色）"
          title="知识空间语义检索与对话记忆召回使用的向量模型；输出必须为 1024 维"
          disabled={candidates.length === 0}
        >
          <option value="">未绑定（语义检索关闭）</option>
          {candidates.map((candidate) => (
            <option key={candidate.value} value={candidate.value}>{candidate.label}</option>
          ))}
        </select>
      </label>
      {candidates.length === 0 && (
        <p className="petri-field__hint" role="note">
          暂无向量模型：在下方渠道行展开详情，为模型勾选「向量」能力（端点需支持 /embeddings 且输出 1024 维，如 bge-m3）。
        </p>
      )}
    </div>
  );
}