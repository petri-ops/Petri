// EndpointCapabilityToggle — 渠道行能力位开关（思考 / 视觉 / 向量）。
// 三个单元格结构相同（标签 + 居中勾选 + 同一份 capabilities 写回语义），抽共用
// 组件既消除重复，也压住设置面板的代码体积棘轮（UI-638 加映四）。

import type { ChatModelPreset } from '@/hooks/useAiSettings';

export interface EndpointCapabilityToggleProps {
  profile: ChatModelPreset;
  capability: 'reasoning' | 'vision' | 'embedding';
  label: string;
  title: string;
  ariaLabel: string;
  onUpdate: (id: string, patch: Partial<ChatModelPreset>) => void;
}

export function EndpointCapabilityToggle(props: EndpointCapabilityToggleProps) {
  const { profile, capability, label, title, ariaLabel, onUpdate } = props;
  const checked = (profile.capabilities || []).includes(capability);
  return (
    <>
      <span className="petri-endpoint-field-label" aria-hidden="true">{label}</span>
      <label className="petri-endpoint-reasoning" title={title}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            const current = profile.capabilities || ['chat', 'streaming', 'tools'];
            const next = e.target.checked
              ? Array.from(new Set([...current, capability]))
              : current.filter((cap) => cap !== capability);
            onUpdate(profile.id, { capabilities: next });
          }}
          aria-label={ariaLabel}
        />
      </label>
    </>
  );
}
