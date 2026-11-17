// EndpointCapabilityToggle — 能力位开关（思考 / 视觉 / 向量）。
// 渠道级（无 model）写 profile.capabilities；模型级（带 model，BLOCK-455）写
// profile.modelCapabilities[model] 显式条目，基线 = 该模型解析能力（覆写 > 渠道兜底；
// 完全未声明的 legacy 档案按隐式默认 chat/streaming/tools，保持旧宽松语义）。

import type { ChatModelPreset } from '@/hooks/useAiSettings';
import { modelCapabilityOverride, resolveModelCapabilities } from '@/lib/model-capabilities';

const IMPLICIT_BASE = ['chat', 'streaming', 'tools'];

export interface EndpointCapabilityToggleProps {
  profile: ChatModelPreset;
  capability: 'reasoning' | 'vision' | 'embedding';
  label: string;
  title: string;
  ariaLabel: string;
  onUpdate: (id: string, patch: Partial<ChatModelPreset>) => void;
  /** BLOCK-455 — 传入模型名 = 模型级编辑；缺省 = 渠道默认（兜底）编辑。 */
  model?: string;
}

export function EndpointCapabilityToggle(props: EndpointCapabilityToggleProps) {
  const { profile, capability, label, title, ariaLabel, onUpdate, model } = props;
  const declared = Array.isArray(profile.capabilities)
    || (model ? modelCapabilityOverride(profile, model) !== undefined : false);
  const resolved = model ? resolveModelCapabilities(profile, model) : (profile.capabilities || []);
  const base = declared ? resolved : IMPLICIT_BASE;
  const checked = base.includes(capability);
  const disabled = model !== undefined && !model;
  return (
    <>
      <span className="petri-endpoint-field-label" aria-hidden="true">{label}</span>
      <label className="petri-endpoint-reasoning" title={title}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.checked
              ? Array.from(new Set([...base, capability]))
              : base.filter((cap) => cap !== capability);
            if (model) {
              onUpdate(profile.id, {
                modelCapabilities: { ...(profile.modelCapabilities || {}), [model]: next },
              });
            } else {
              onUpdate(profile.id, { capabilities: next });
            }
          }}
          aria-label={ariaLabel}
        />
      </label>
    </>
  );
}