// EmbeddingRoleBinding — 向量模型（语义检索）角色选择器（UI-638 加映四）。
//
// 用途：知识空间语义检索 + 对话记忆召回。向量库固定 1024 维，换绑到输出维度
// 不同的模型时后端会整批拒收并降级（helpers/embedding-dim-guard.js），所以
// 候选=已勾选「向量」能力的渠道，且提示必须输出 1024 维（如 bge-m3）。

import type { ChatModelPreset } from '@/hooks/useAiSettings';

export function hasEmbeddingCapability(profile: ChatModelPreset): boolean {
  return !!profile.capabilities?.includes('embedding');
}

export interface EmbeddingRoleBindingProps {
  /** 全部模型档案（含内置/本地）；内部过滤出声明 embedding 的项。 */
  profiles: ChatModelPreset[];
  value?: string;
  onChange: (profileId: string) => void;
}

export function EmbeddingRoleBinding({ profiles, value, onChange }: EmbeddingRoleBindingProps) {
  const embeddingProfiles = profiles.filter(hasEmbeddingCapability);
  return (
    <div className="petri-model-role-binding" data-testid="embedding-role-binding">
      <label className="petri-model-role-binding__label">
        向量模型（语义检索）
        <select
          className="petri-select"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          aria-label="向量模型（embedding 角色）"
          title="知识空间语义检索与对话记忆召回使用的向量模型；输出必须为 1024 维"
          disabled={embeddingProfiles.length === 0}
        >
          <option value="">未绑定（语义检索关闭）</option>
          {embeddingProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label || profile.id}（{profile.model || profile.defaultModel || '未选模型'}）
            </option>
          ))}
        </select>
      </label>
      {embeddingProfiles.length === 0 ? (
        <p className="petri-field__hint" role="note">
          暂无向量渠道：在下方渠道行勾选「向量」能力（该端点需支持 /embeddings 且输出 1024 维，如 bge-m3）。
        </p>
      ) : (
        <p className="petri-field__hint">
          用于知识空间语义检索与对话记忆召回；模型输出必须为 1024 维，否则整批拒收并降级（不影响聊天）。
        </p>
      )}
    </div>
  );
}
