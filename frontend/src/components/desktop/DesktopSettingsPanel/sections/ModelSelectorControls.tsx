/**
 * ModelSelectorControls — BLOCK-224 模型选择器治理（D2 可见性）+ BLOCK-455 D6 思考合并单下拉。
 *
 * 挂在渠道行详情里（默认模型的控件行）：
 *  - 选择器可见：取消勾选后该渠道不出现在聊天模型选择器；已绑定/正在使用不受影响；
 *  - 思考合并下拉：一个控件表达「reasoning 能力位 × 默认思考档」两个字段——
 *    不支持=无 reasoning 位；支持·不覆盖=有位不带档；关闭/标准/高=有位+默认档。
 *    能力位写默认模型的 modelCapabilities 条目（模型级，覆写渠道兜底）。
 */

import React from 'react';
import type { ChatModelPreset } from '@/hooks/useAiSettings';
import { resolveModelCapabilities } from '@/lib/model-capabilities';

interface ModelSelectorControlsProps {
  profile: ChatModelPreset;
  onUpdate: (id: string, patch: Partial<ChatModelPreset>) => void;
}

export function ModelSelectorControls({ profile, onUpdate }: ModelSelectorControlsProps): React.ReactElement {
  const visible = profile.visible !== false;
  const defaultModel = profile.defaultModel || profile.model || '';
  const declared = Array.isArray(profile.capabilities)
    || Array.isArray(profile.modelCapabilities?.[defaultModel]);
  const caps = declared ? resolveModelCapabilities(profile, defaultModel) : ['chat', 'streaming', 'tools'];
  // 完全未声明的 legacy 档案保持旧宽松语义（thinking 门放行），不误判「不支持」。
  const supports = !declared || caps.includes('reasoning');
  const level = profile.defaultThinkingLevel || '';
  const thinkingValue = !supports ? 'unsupported' : (level || 'auto');

  function handleThinkingChange(next: string) {
    if (!defaultModel) return;
    const nextCaps = next === 'unsupported'
      ? caps.filter((cap) => cap !== 'reasoning')
      : (caps.includes('reasoning') ? caps : [...caps, 'reasoning']);
    onUpdate(profile.id, {
      modelCapabilities: { ...(profile.modelCapabilities || {}), [defaultModel]: nextCaps },
      defaultThinkingLevel: (next === 'auto' || next === 'unsupported'
        ? undefined
        : next) as ChatModelPreset['defaultThinkingLevel'],
    });
  }

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
      <span className="petri-endpoint-field-label" aria-hidden="true">思考</span>
      <select
        className="petri-select"
        value={thinkingValue}
        onChange={(event) => handleThinkingChange(event.target.value)}
        disabled={!defaultModel}
        aria-label="思考能力与默认档"
        title="该默认模型是否支持思考档位，以及切换时带入的默认档；能力位按模型声明（展开下方能力表可逐模型编辑）"
      >
        <option value="unsupported">不支持思考</option>
        <option value="auto">支持 · 不覆盖档位</option>
        <option value="off">支持 · 默认关闭</option>
        <option value="standard">支持 · 默认标准</option>
        <option value="high">支持 · 默认高</option>
      </select>
    </>
  );
}