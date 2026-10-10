// ============================================================
// VisionRoleBinding.tsx — BLOCK-150 加映（UI-476）：识图模型角色选择器
//
// 用户裁决（2026-10-09「不想用 Qwen VL Max 渠道……设置上有个选择设置按钮
// 不就可以了吗」）：视觉理解角色（识图）应可在设置页显式换绑到任一声明了
// vision 能力的渠道。配套：渠道行「视觉」能力勾选（desktop.css 第 10 列，
// 「思考」列同款先例）+ 网关 image_url 协议转换（model-gateway）。
// ============================================================

import type { ChatModelPreset } from '@/hooks/useAiSettings';

export function hasVisionCapability(profile: ChatModelPreset): boolean {
  return !!profile.capabilities?.includes('vision');
}

export interface VisionRoleBindingProps {
  /** 全部用户渠道（内部过滤出 vision 可选项）。 */
  profiles: ChatModelPreset[];
  /** 当前 vision 角色绑定的渠道 id（空=未绑定）。 */
  value?: string;
  onChange: (profileId: string) => void;
}

export function VisionRoleBinding({ profiles, value, onChange }: VisionRoleBindingProps) {
  const visionProfiles = profiles.filter(hasVisionCapability);
  return (
    <div className="petri-model-role-binding">
      <label className="petri-model-role-binding__label">
        识图模型（视觉理解）
        <select
          className="petri-select"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          aria-label="识图模型（视觉理解角色）"
          title="粘贴/拖入图片由该渠道模型解读（走 image_url 协议）；候选=已勾选「视觉」能力的渠道"
          disabled={visionProfiles.length === 0}
        >
          <option value="">未绑定</option>
          {visionProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label || profile.id}（{profile.model || profile.defaultModel || '未选模型'}）
            </option>
          ))}
        </select>
      </label>
      {visionProfiles.length === 0 ? (
        <p className="petri-field__hint" role="note">
          暂无可选渠道：先在下方渠道行勾选「视觉」能力（渠道网关需支持图片输入）。
        </p>
      ) : (
        <p className="petri-field__hint">换绑后贴图即走所选渠道；其网关须真正支持图片输入，否则调用会诚实报错。</p>
      )}
    </div>
  );
}
