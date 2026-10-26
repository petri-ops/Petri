/**
 * ModelChip — BLOCK-225 composer 的模型选择钮（从 SimpleChat 抽出）。
 *
 * BLOCK-266 并钮：供应商+模型合并为单枚图标钮（zap+chevron），开组合菜单
 *（供应商分组标题 + 全部可选模型平铺）；自动档显示差异经 data-auto 与 title 表达。
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
  const modelTitle = autoModel ? `自动选模型（当前：${autoPreview}）` : modelName || '选择会话模型';
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
        <Icon name="chevron-down" size={12} />
      </button>
    </div>
  );
}