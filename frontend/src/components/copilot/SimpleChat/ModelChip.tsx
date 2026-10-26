/**
 * ModelChip — BLOCK-225 composer 的供应商/模型两枚按钮（从 SimpleChat 抽出）。
 *
 * BLOCK-266 视觉收缩：默认图标态（zap + chevron 一枚钮），供应商文字与模型名
 * 收进 title（悬浮可见）——文字常驻会在窄容器挤压换行且换供应商是低频操作；
 * 两钮仍各自可点（供应商钮=图标左半、模型钮=图标右半的联合胶囊），
 * 选择逻辑仍在 useModelAccessMenus/ModelMenu。
 */

import React from 'react';
import { Icon } from '@/components/icons/Icon';

interface ModelChipProps {
  supplier: string;
  modelName: string;
  autoModel: boolean;
  autoPreview: string;
  narrow: boolean;
  onOpenSupplier: () => void;
  onOpenModel: () => void;
}

export function ModelChip({
  supplier,
  modelName,
  autoModel,
  autoPreview,
  narrow: _narrow, // 保留签名兼容；图标态已不区分窄宽
  onOpenSupplier,
  onOpenModel,
}: ModelChipProps): React.ReactElement {
  const modelTitle = autoModel ? `自动选模型（当前：${autoPreview}）` : modelName || '选择会话模型';
  return (
    <>
      <div className="sc-model-picker sc-model-picker-footer">
        <button
          type="button"
          className="sc-model-btn sc-model-provider-btn"
          onClick={onOpenSupplier}
          title={`供应商：${supplier || '未选择'}（点击切换）`}
          aria-label={`供应商：${supplier || '未选择'}`}
          data-testid="model-chip-supplier"
        >
          <Icon name="cpu" size={14} />
        </button>
      </div>
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
    </>
  );
}
