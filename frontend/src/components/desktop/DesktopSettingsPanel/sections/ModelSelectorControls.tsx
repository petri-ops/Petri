/**
 * ModelSelectorControls — BLOCK-224 模型选择器治理（D2 可见性 + 默认思考档）。
 *
 * 挂在模型渠道卡片网格里（两对 label/value，与其他控件同形）：
 *  - 选择器可见：取消勾选后该模型不出现在聊天模型选择器；已绑定/正在使用不受影响；
 *  - 默认思考：切到该模型时带入的档位（不选=不覆盖当前会话档位）。
 */

import React from 'react';
import type { ChatModelPreset } from '@/hooks/useAiSettings';

interface ModelSelectorControlsProps {
  profile: ChatModelPreset;
  onUpdate: (id: string, patch: Partial<ChatModelPreset>) => void;
}

export function ModelSelectorControls({ profile, onUpdate }: ModelSelectorControlsProps): React.ReactElement {
  const visible = profile.visible !== false;
  const level = profile.defaultThinkingLevel || '';
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
      <span className="petri-endpoint-field-label" aria-hidden="true">默认思考</span>
      <select
        className="petri-select"
        value={level}
        onChange={(event) => onUpdate(profile.id, {
          defaultThinkingLevel: (event.target.value || undefined) as ChatModelPreset['defaultThinkingLevel'],
        })}
        aria-label="默认思考档"
        title="切换到该模型时带入的思考档；不选=不覆盖当前会话档位"
      >
        <option value="">不覆盖</option>
        <option value="off">关闭</option>
        <option value="standard">标准</option>
        <option value="high">高</option>
      </select>
    </>
  );
}
