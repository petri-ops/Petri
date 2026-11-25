/**
 * ModelSelectorControls — BLOCK-224 模型选择器治理（D2 可见性）。
 *
 * 挂在渠道行详情里（默认模型的控件行）：
 *  - 选择器可见：取消勾选后该渠道不出现在聊天模型选择器；已绑定/正在使用不受影响。
 *  - BLOCK-518 声明面退役 — 思考合并下拉（reasoning 能力位 × 默认思考档）随声明位
 *    退役移除：reasoning 不再是声明位，档位控制面保留在 composer（未声明默认隐藏）。
 */

import React from 'react';
import type { ChatModelPreset } from '@/hooks/useAiSettings';

interface ModelSelectorControlsProps {
  profile: ChatModelPreset;
  onUpdate: (id: string, patch: Partial<ChatModelPreset>) => void;
}

export function ModelSelectorControls({ profile, onUpdate }: ModelSelectorControlsProps): React.ReactElement {
  const visible = profile.visible !== false;

  return (
    <>
      <span className="petri-endpoint-field-label" aria-hidden="true">选择器</span>
      <label
        className="petri-endpoint-reasoning"
        title="取消勾选后该模型不出现在聊天模型选择器；已绑定或正在使用的解析不受影响"
      >
        <input
          type="checkbox"
          checked={visible}
          onChange={(event) => onUpdate(profile.id, { visible: event.target.checked ? undefined : false })}
          aria-label={`${profile.label || '自定义渠道'} 在选择器中显示`}
        />
        <span>显示</span>
      </label>
    </>
  );
}
