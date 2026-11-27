import React from 'react';

/**
 * item84：3D 供应商不可用/未配置时的独立三选一弹窗。
 * 纯展示组件——状态与回答由 useApprovalSurfaces 的 question 活动持有；
 * 不侵入 83/85 已验的会话产物卡区。
 */
/** 与 server helper 的 questionId 前缀保持同形（前端不跨层 require server 模块）。 */
export const MODEL3D_FALLBACK_PREFIX = 'model3d-fallback';

interface Model3DFallbackOption {
  id: string;
  label: string;
  description?: string;
}

export interface Model3DFallbackDialogProps {
  open: boolean;
  question: string;
  options: Model3DFallbackOption[];
  busy?: boolean;
  onSelect: (optionId: string) => void;
  onCancel: () => void;
}

export function Model3DFallbackDialog({
  open,
  question,
  options,
  busy = false,
  onSelect,
  onCancel,
}: Model3DFallbackDialogProps): React.ReactElement | null {
  if (!open) return null;
  return (
    <div className="sc-full-access-overlay" data-testid="model3d-fallback-dialog">
      <div className="sc-full-access-dialog" role="alertdialog" aria-label="3D 降级选择">
        <div className="sc-full-access-dialog__head">
          <strong>{question}</strong>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((option) => (
            <div key={option.id}>
              <button
                type="button"
                data-testid="model3d-fallback-option"
                disabled={busy}
                onClick={() => onSelect(option.id)}
              >
                {option.label}
              </button>
              {option.description ? <div className="sc-full-access-dialog__caption">{option.description}</div> : null}
            </div>
          ))}
        </div>
        <button type="button" data-testid="model3d-fallback-close" disabled={busy} onClick={onCancel}>
          取消操作
        </button>
      </div>
    </div>
  );
}
