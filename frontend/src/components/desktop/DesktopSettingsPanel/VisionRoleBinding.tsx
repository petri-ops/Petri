// ============================================================
// VisionRoleBinding.tsx — BLOCK-150 加映（UI-476）：识图模型角色选择器
//
// 用户裁决（2026-10-09「不想用 Qwen VL Max 渠道……设置上有个选择设置按钮
// 不就可以了吗」）：视觉理解角色（识图）应可在设置页显式换绑。
// BLOCK-455 D7 — 候选从「渠道」细化为 (渠道, 模型) 对：值用
// `渠道id::encodeURIComponent(模型)`（与聊天选择器 modelChoiceId 同形）；
// legacy 裸渠道绑定归一为该渠道当前模型的对值显示（后端同规则兼容）。
// BLOCK-518 声明面退役（2026-11-25 owner 批准）— 能力过滤撤除：槽位语义从
// 「声明了视觉的模型」退化为「用户指定处理图片的模型」，列全部 (渠道, 模型) 对。
// ============================================================

import type { ChatModelPreset } from '@/hooks/useAiSettings';
import { parseModelBinding } from '@/lib/model-capabilities';
import { modelChoiceId } from '@/lib/model-provider-options';

export interface VisionRoleBindingProps {
  /** 全部用户渠道（列全部 (渠道, 模型) 对，不做能力过滤）。 */
  profiles: ChatModelPreset[];
  /** 连通性测试发现的模型（逐对展开候选）。 */
  availableModels?: Record<string, string[]>;
  /** 当前 vision 角色绑定（渠道::模型 对；legacy 裸渠道 id 兼容）。 */
  value?: string;
  onChange: (binding: string) => void;
}

export function VisionRoleBinding({ profiles, availableModels, value, onChange }: VisionRoleBindingProps) {
  const candidates: { value: string; label: string }[] = [];
  for (const profile of profiles) {
    const models = Array.from(new Set(
      [profile.defaultModel || profile.model, ...(availableModels?.[profile.id] || [])].filter(Boolean),
    ));
    for (const model of models) {
      candidates.push({
        value: modelChoiceId(profile.id, model),
        label: `${profile.label || profile.id}（${model}）`,
      });
    }
  }
  // legacy 裸绑定 → 归一为对值显示；对值不在候选集（渠道已删等）时诚实列出供重选。
  const binding = parseModelBinding(value);
  const boundProfile = binding.profileId ? profiles.find((p) => p.id === binding.profileId) : undefined;
  const effectiveValue = value
    ? (binding.model ? value : modelChoiceId(binding.profileId, boundProfile?.model || boundProfile?.defaultModel || ''))
    : '';
  if (effectiveValue && !candidates.some((c) => c.value === effectiveValue)) {
    candidates.push({
      value: effectiveValue,
      label: `${boundProfile?.label || binding.profileId}（${binding.model || boundProfile?.model || '未知模型'} · 渠道已不存在，请重选）`,
    });
  }
  return (
    <div className="petri-model-role-binding">
      <label className="petri-model-role-binding__label">
        识图模型（视觉理解）
        <select
          className="petri-select"
          value={effectiveValue}
          onChange={(e) => onChange(e.target.value)}
          aria-label="识图模型（视觉理解角色）"
          title="粘贴/拖入图片由该模型解读（走 image_url 协议）；候选=全部模型（BLOCK-518 后能力过滤退役）"
          disabled={candidates.length === 0}
        >
          <option value="">未绑定</option>
          {candidates.map((candidate) => (
            <option key={candidate.value} value={candidate.value}>{candidate.label}</option>
          ))}
        </select>
      </label>
      {candidates.length === 0 && (
        <p className="petri-field__hint" role="note">
          暂无可选模型：先在下方添加模型渠道（识图槽位=用户指定处理图片的模型）。
        </p>
      )}
    </div>
  );
}
