/**
 * ModelChip — BLOCK-225 composer 的模型选择钮（从 SimpleChat 抽出）。
 *
 * BLOCK-266 并钮：供应商+模型合并为单枚按钮（zap+当前模型短名+chevron），开组合菜单
 *（供应商分组标题 + 全部可选模型平铺）；自动档显示「自动 · 当前解析模型」，完整差异仍在 title。
 * UI-538 加映一 — 模型名从 title-only 提升为可见文本，避免用户不知道当前选了谁。
 */

import React from 'react';
import { Icon } from '@/components/icons/Icon';

interface ModelChipProps {
  supplier: string;
  modelName: string;
  autoModel: boolean;
  autoPreview: string;
  narrow?: boolean;
  onOpenSupplier?: () => void;
  onOpenModel: () => void;
}

export function ModelChip({
  modelName,
  autoModel,
  autoPreview,
  onOpenModel,
}: ModelChipProps): React.ReactElement {
  const modelNameText = modelName || '选择会话模型';
  const modelTitle = autoModel
    ? `自动选模型（当前：${autoPreview || modelNameText}）`
    : modelNameText;
  const chipLabel = autoModel
    ? `自动 · ${autoPreview || modelNameText}`
    : modelNameText;
  return (
    <div className="sc-model-picker sc-model-picker-footer">
      <button
        type="button"
        className="sc-model-btn sc-model-name-btn"
        onClick={onOpenModel}
        title={modelTitle}
        aria-label={modelTitle}
        data-auto={autoModel ? 'true' : 'false'}
        data-testid="model-chip-model"
      >
        <Icon name="zap" size={14} />
        <span data-testid="model-chip-label">{chipLabel}</span>
        <Icon name="chevron-down" size={12} />
      </button>
    </div>
  );
}