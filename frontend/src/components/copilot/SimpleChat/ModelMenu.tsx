/**
 * ModelMenu — BLOCK-224 模型选择器（D1 状态诚实 + D2 每模型治理）。
 *
 * 两段：供应商 → 模型。每行带可用性（缺密钥禁用 / 发现失败标黄 / 就绪）、
 * 上下文窗口与默认思考档；隐藏模型已由 `buildModelGroups` 过滤，不会出现。
 * 加载中/零可用模型给出可读空态，而不是一张空菜单。
 */

import React, { useEffect, useState } from 'react';
import type { ChatModelPreset } from '@/hooks/useAiSettings';
import { getApiPrefix } from '@/lib/env';
import {
  formatContextWindow,
  groupSelectableRows,
  isSelectableRow,
  type CatalogSummary,
  type ModelCatalogGroup,
} from '@/lib/model-catalog';

interface ModelMenuProps {
  mode: 'supplier' | 'model';
  groups: ModelCatalogGroup[];
  selectedGroup: ModelCatalogGroup | undefined;
  activeModelId: string;
  summary: CatalogSummary;
  autoModel?: boolean;
  autoPreview?: string;
  autoError?: string | null;
  onToggleAuto?: () => void;
  onClose: () => void;
  onPickSupplier: (group: ModelCatalogGroup) => void;
  onPickModel: (preset: ChatModelPreset) => void;
}

const THINKING_LABELS: Record<string, string> = { off: '关闭思考', standard: '标准思考', high: '高思考' };

interface ModelPrice { input: number; output: number }
type PricingTable = Record<string, ModelPrice>;

/** BLOCK-259 D1 — 价格来自后端单一源 /api/ai/pricing；取不到就不显示，不猜价。 */
function useModelPricing(): PricingTable {
  const [pricing, setPricing] = useState<PricingTable>({});
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch(`${getApiPrefix()}/ai/pricing`);
        const data = await response.json() as { pricing?: PricingTable };
        if (alive && data && data.pricing && typeof data.pricing === 'object') setPricing(data.pricing);
      } catch {
        // 价格不可用不影响选择器
      }
    };
    void load();
    return () => { alive = false; };
  }, []);
  return pricing;
}

function formatPrice(price: ModelPrice | undefined): string | null {
  if (!price || typeof price.input !== 'number') return null;
  const output = typeof price.output === 'number' ? price.output : 0;
  return `¥${price.input}/¥${output} 每 1M`;
}

function presetMeta(preset: ChatModelPreset, active: boolean, pricing: PricingTable): string {
  const parts: string[] = [];
  if (active) parts.push('当前使用');
  const context = formatContextWindow(preset.contextWindow);
  if (context) parts.push(context);
  if (preset.defaultThinkingLevel) parts.push(THINKING_LABELS[preset.defaultThinkingLevel] || preset.defaultThinkingLevel);
  const price = formatPrice(pricing[preset.model]);
  if (price) parts.push(price);
  return parts.length > 0 ? parts.join(' · ') : active ? '当前使用' : '点击切换';
}


/** BLOCK-264（C-37）— 模型白名单单一源 /api/ai/model-access；取不到=open 全放行。 */
interface ModelAccessState { mode: 'open' | 'allowlist'; allowedModels: string[]; reasonNotes: Record<string, string> }
const OPEN_ACCESS: ModelAccessState = { mode: 'open', allowedModels: [], reasonNotes: {} };
function useModelAccess(): ModelAccessState {
  const [access, setAccess] = useState<ModelAccessState>(OPEN_ACCESS);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch(`${getApiPrefix()}/ai/model-access`);
        const data = await response.json() as { mode?: 'open' | 'allowlist'; allowedModels?: string[]; reasonNotes?: Record<string, string> };
        if (alive && data) {
          setAccess({
            mode: data.mode === 'allowlist' ? 'allowlist' : 'open',
            allowedModels: Array.isArray(data.allowedModels) ? data.allowedModels : [],
            reasonNotes: data.reasonNotes || {},
          });
        }
      } catch {
        // 权限面不可用不拦截选择（open 语义）
      }
    };
    void load();
    return () => { alive = false; };
  }, []);
  return access;
}

export function ModelMenu({
  mode,
  groups,
  selectedGroup,
  activeModelId,
  summary,
  autoModel = false,
  autoPreview = '',
  autoError = null,
  onToggleAuto,
  onClose,
  onPickSupplier,
  onPickModel,
}: ModelMenuProps): React.ReactElement {
  const pricing = useModelPricing();
  const access = useModelAccess();
  const accessDenied = (model: string): string | null => {
    if (access.mode !== 'allowlist') return null;
    if (access.allowedModels.includes(model)) return null;
    const note = access.reasonNotes[model];
    return note ? `未列入本机允许清单（${note}）` : '未列入本机允许清单';
  };
  return (
    <>
      <div className="sc-model-overlay" onClick={onClose} />
      <div className="sc-model-menu" role="menu" aria-label="模型选择" data-testid="model-menu">
        {summary.text && (
          <div
            className={`sc-model-menu-status sc-model-menu-status-${summary.level}`}
            role="status"
            data-testid="model-menu-status"
          >
            {summary.text}
          </div>
        )}
        {onToggleAuto && (
          <button
            type="button"
            className={`sc-model-option ${autoModel ? 'sc-model-option-active' : ''}`}
            onClick={onToggleAuto}
            data-testid="model-menu-auto"
            title="开启后每轮按任务与附件解析模型（不改变手动选择）"
          >
            <span className="sc-model-option-title">自动（按任务选择）</span>
            <span className="sc-model-option-meta">
              {autoModel ? `开启 · ${autoPreview || '暂无可用模型'}` : '关闭'}
            </span>
          </button>
        )}
        {autoError && (
          <div className="sc-model-menu-status sc-model-menu-status-degraded" role="alert">
            {autoError}
          </div>
        )}
        {summary.level === 'empty' && groups.length === 0 ? null : mode === 'supplier' ? (
          groups.map((group) => {
            const selectable = groupSelectableRows(group);
            const disabled = selectable.length === 0;
            return (
              <button
                type="button"
                key={group.key}
                className={`sc-model-option ${group.key === selectedGroup?.key ? 'sc-model-option-active' : ''} ${disabled ? 'sc-model-option-disabled' : ''}`}
                disabled={disabled}
                title={disabled ? '该渠道没有可用模型' : group.supplier}
                onClick={() => onPickSupplier(group)}
              >
                <span className="sc-model-option-title">{group.supplier}</span>
                <span className="sc-model-option-meta">
                  {disabled ? '无可用模型' : `${selectable.length}/${group.rows.length} 个模型`}
                </span>
              </button>
            );
          })
        ) : (
          (selectedGroup?.rows || []).map((row) => {
            const active = row.preset.id === activeModelId;
            const accessReason = accessDenied(row.preset.model);
            const effectiveReason = row.reason || accessReason;
            const disabled = !isSelectableRow(row) || accessReason !== null;
            const price = formatPrice(pricing[row.preset.model]);
            const meta = effectiveReason
              ? `${effectiveReason}${price ? ` · ${price}` : ''}`
              : presetMeta(row.preset, active, pricing);
            return (
              <button
                type="button"
                key={row.preset.id}
                className={`sc-model-option ${active ? 'sc-model-option-active' : ''} ${disabled ? 'sc-model-option-disabled' : ''}`}
                disabled={disabled}
                title={effectiveReason || row.preset.model}
                onClick={() => onPickModel(row.preset)}
              >
                <span className="sc-model-option-title">{row.preset.model}</span>
                <span className={`sc-model-option-meta ${effectiveReason ? 'sc-model-option-warning' : ''}`}>
                  {meta}
                </span>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}
