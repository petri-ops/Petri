/**
 * ModelChip — BLOCK-225 composer 的供应商/模型两枚按钮（从 SimpleChat 抽出）。
 *
 * 自动档开启时模型钮显示「自动」，title 给出当前解析预览；
 * 两枚按钮只负责打开菜单，选择逻辑仍在 useModelAccessMenus/ModelMenu。
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
  narrow,
  onOpenSupplier,
  onOpenModel,
}: ModelChipProps): React.ReactElement {
  return (
    <>
      <div className="sc-model-picker sc-model-picker-footer">
        <button
          type="button"
          className="sc-model-btn sc-model-provider-btn"
          onClick={onOpenSupplier}
          title={autoModel ? `自动选模型（当前：${autoPreview}）` : supplier || '选择供应商'}
        >
          {narrow ? <Icon name="cpu" size={14} /> : <span>{supplier || '供应商'}</span>}
          <Icon name="chevron-down" size={12} />
        </button>
      </div>
      <div className="sc-model-picker sc-model-picker-footer">
        <button
          type="button"
          className="sc-model-btn sc-model-name-btn"
          onClick={onOpenModel}
          title={autoModel ? `自动：${autoPreview}` : modelName || '选择会话模型'}
          data-auto={autoModel ? 'true' : 'false'}
        >
          {narrow ? <Icon name="zap" size={14} /> : <span>{autoModel ? '自动' : modelName || '选择模型'}</span>}
          <Icon name="chevron-down" size={12} />
        </button>
      </div>
    </>
  );
}
