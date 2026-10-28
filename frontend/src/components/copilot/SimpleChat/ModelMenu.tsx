/**
 * ModelMenu — BLOCK-224 模型选择器（D1 状态诚实 + D2 每模型治理）。
 *
 * 两段：供应商 → 模型。每行带可用性（缺密钥禁用 / 发现失败标黄 / 就绪）、
 * 上下文窗口与默认思考档；隐藏模型已由 `buildModelGroups` 过滤，不会出现。
 * 加载中/零可用模型给出可读空态，而不是一张空菜单。
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChatModelPreset } from '@/hooks/useAiSettings';
import { Icon } from '@/components/icons/Icon';
import { getApiPrefix } from '@/lib/env';
import {
  formatContextWindow,
  groupSelectableRows,
  isSelectableRow,
  type CatalogSummary,
  type ModelCatalogGroup,
} from '@/lib/model-catalog';

interface ModelMenuProps {
  mode: 'supplier' | 'model' | 'all';
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

/** UI-619 — 供应商第二卡：与主卡分离，默认贴主卡右侧；右侧放不下向左开。 */
const SUPPLIER_PANEL_WIDTH = 248;
const SUPPLIER_PANEL_GAP = 8;
const SUPPLIER_PANEL_MARGIN = 12;
const SUPPLIER_PANEL_MAX_HEIGHT = 360;

export function supplierPanelPosition(
  anchor: { left: number; top: number; right: number },
  viewport: { width: number; height: number },
): { left: number; top: number; width: number; placement: 'right' | 'left' } {
  const width = Math.min(SUPPLIER_PANEL_WIDTH, Math.max(0, viewport.width - SUPPLIER_PANEL_MARGIN * 2));
  const openRight = anchor.right + SUPPLIER_PANEL_GAP + width <= viewport.width - SUPPLIER_PANEL_MARGIN;
  const left = openRight
    ? anchor.right + SUPPLIER_PANEL_GAP
    : Math.max(
        SUPPLIER_PANEL_MARGIN,
        Math.min(anchor.left - SUPPLIER_PANEL_GAP - width, viewport.width - width - SUPPLIER_PANEL_MARGIN),
      );
  const maxHeight = Math.min(SUPPLIER_PANEL_MAX_HEIGHT, Math.max(160, viewport.height - SUPPLIER_PANEL_MARGIN * 2));
  const top = Math.min(
    Math.max(SUPPLIER_PANEL_MARGIN, anchor.top),
    Math.max(SUPPLIER_PANEL_MARGIN, viewport.height - maxHeight - SUPPLIER_PANEL_MARGIN),
  );
  return { left, top, width, placement: openRight ? 'right' : 'left' };
}

interface ModelPrice { input: number; output: number }
type PricingTable = Record<string, ModelPrice>;

/**
 * BLOCK-266 并钮——组合菜单行渲染。UI-613（用户裁决「供应商模型列表应该是新的
 * 页面」）：mode=all 两页下钻——供应商页只列供应商行，点供应商整页切到该渠道
 * 模型页（返回行 + 标题/数量）；不再左右两列混排，也不铺灰底容器。
 * 纯投影：模型行点击=选该模型（selectModel 连带切渠道默认，供应商级联隐式成立）；
 * 白名单禁行与价格元信息与 model 分支同源。
 */
function renderGroupModelRows(opts: {
  group: ModelCatalogGroup;
  activeModelId: string;
  accessDenied: (model: string) => string | null;
  pricing: Record<string, { input: number; output: number }>;
  onPickModel: (preset: ChatModelPreset) => void;
}): React.ReactElement[] {
  const { group, activeModelId, accessDenied, pricing, onPickModel } = opts;
  // 与 model 分支同源：全部行都渲染（缺密钥/白名单禁行带理由），不只渲染可选行
  return group.rows.map((row) => {
    const active = row.preset.id === activeModelId;
    const accessReason = accessDenied(row.preset.model);
    const effectiveReason = row.reason || accessReason;
    const disabled = !isSelectableRow(row) || accessReason !== null;
    const price = formatPrice(pricing[row.preset.model]);
    const meta = effectiveReason
      ? effectiveReason + (price ? ` · ${price}` : '')
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
  });
}

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
  // UI-619 — 一级卡（模型/自动）与二级卡（供应商）物理分离：供应商卡 portal 到 body，
  // 默认贴主卡右侧、右侧放不下向左开；切换供应商后主卡换模型列表、供应商卡保持可见。
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [supplierPanelOpen, setSupplierPanelOpen] = useState(false);
  const [supplierPanelPos, setSupplierPanelPos] = useState<ReturnType<typeof supplierPanelPosition> | null>(null);
  // UI-617 — 默认选中当前模型所在供应商（打开即见可用模型，无需先点）。菜单关闭即卸载，状态自然复位。
  const [selectedSupplierKey, setSelectedSupplierKey] = useState<string | null>(null);
  const activeSupplierGroup = groups.find((group) => group.rows.some((row) => row.preset.id === activeModelId));
  const effectiveSupplierGroup = groups.find((group) => group.key === selectedSupplierKey)
    || activeSupplierGroup
    || groups[0];
  useEffect(() => {
    if (!supplierPanelOpen) return undefined;
    const reposition = () => {
      const rect = menuRef.current?.getBoundingClientRect();
      if (rect) {
        setSupplierPanelPos(supplierPanelPosition(rect, { width: window.innerWidth, height: window.innerHeight }));
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSupplierPanelOpen(false);
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('keydown', onKey);
    };
  }, [supplierPanelOpen]);
  const toggleSupplierPanel = () => {
    if (supplierPanelOpen) {
      setSupplierPanelOpen(false);
      return;
    }
    const rect = menuRef.current?.getBoundingClientRect();
    if (rect) {
      setSupplierPanelPos(supplierPanelPosition(rect, { width: window.innerWidth, height: window.innerHeight }));
    }
    setSupplierPanelOpen(true);
  };
  const accessDenied = (model: string): string | null => {
    if (access.mode !== 'allowlist') return null;
    if (access.allowedModels.includes(model)) return null;
    const note = access.reasonNotes[model];
    return note ? `未列入本机允许清单（${note}）` : '未列入本机允许清单';
  };
  return (
    <>
      <div className="sc-model-overlay" onClick={onClose} />
      <div className="sc-model-menu" role="menu" aria-label="模型选择" data-testid="model-menu" ref={menuRef}>
        {summary.text && (
          <div
            className={`sc-model-menu-status sc-model-menu-status-${summary.level}`}
            role="status"
            data-testid="model-menu-status"
          >
            {summary.text}
          </div>
        )}
        {mode === 'all' && (
          <div className="sc-model-menu-head">
            <button
              type="button"
              className="sc-model-supplier-trigger"
              data-testid="model-menu-supplier-trigger"
              aria-haspopup="menu"
              aria-expanded={supplierPanelOpen}
              title="选择供应商"
              onClick={toggleSupplierPanel}
            >
              <span className="sc-model-supplier-trigger-main">
                <span className="sc-model-option-title">{effectiveSupplierGroup?.supplier || '选择供应商'}</span>
                <span className="sc-model-option-meta">
                  {effectiveSupplierGroup
                    ? groupSelectableRows(effectiveSupplierGroup).length === 0
                      ? '无可用模型'
                      : `${groupSelectableRows(effectiveSupplierGroup).length} 个模型`
                    : '未配置供应商'}
                </span>
              </span>
              <Icon name="chevron-right" size={15} />
            </button>
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
        {summary.level === 'empty' && groups.length === 0 ? null : mode === 'all' ? (
          /* UI-619（用户「一级和二级页面不要在同一个卡片中」）——主卡只放模型，
             供应商列表在独立第二卡（portal），切换供应商不再遮挡其它供应商。 */
          <div className="sc-model-menu-models" data-testid="model-menu-models">
            <div className="sc-model-section-label">模型</div>
            {effectiveSupplierGroup ? (
              renderGroupModelRows({
                group: effectiveSupplierGroup,
                activeModelId,
                accessDenied,
                pricing,
                onPickModel,
              })
            ) : (
              <div className="sc-model-two-pane-empty">
                <span className="sc-model-option-meta">选择供应商查看模型</span>
              </div>
            )}
          </div>
        ) : mode === 'supplier' ? (

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
      {mode === 'all' && supplierPanelOpen && supplierPanelPos && createPortal(
        <div
          className="sc-model-supplier-panel"
          role="menu"
          aria-label="供应商"
          data-testid="model-menu-supplier-panel"
          data-placement={supplierPanelPos.placement}
          style={{ left: supplierPanelPos.left, top: supplierPanelPos.top, width: supplierPanelPos.width }}
        >
          <div className="sc-model-supplier-panel-head">供应商</div>
          {groups.map((group) => {
            const selectable = groupSelectableRows(group);
            const current = group.rows.some((row) => row.preset.id === activeModelId);
            const selected = effectiveSupplierGroup?.key === group.key;
            return (
              <button
                type="button"
                key={group.key}
                role="menuitem"
                className={`sc-model-supplier${selected ? ' sc-model-supplier-selected' : ''}`}
                title={`查看 ${group.supplier} 的模型`}
                data-active={selected ? 'true' : 'false'}
                data-testid={`model-menu-supplier-${group.key}`}
                onClick={() => setSelectedSupplierKey(group.key)}
              >
                <span className="sc-model-supplier-main">
                  <span className="sc-model-option-title">{group.supplier}</span>
                  <span className="sc-model-option-meta">
                    {current ? '当前使用 · ' : ''}
                    {selectable.length === 0 ? '无可用模型' : `${selectable.length} 个模型`}
                  </span>
                </span>
                {current && <Icon name="check" size={14} />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
