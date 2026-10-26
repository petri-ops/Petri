// ============================================================
// useModelAccessMenus — 模型菜单 + 访问档位菜单状态簇（UI-305 P0.3）
//
// 从 SimpleChat.tsx 整簇平移，簇内 hook 相对顺序保持原样，零行为变化：
// - 4 个 useState（modelMenuOpen / modelSupplierKey / accessMenuOpen /
//   accessMode）+ prePlanAccessModeRef（原 322-330）
// - planMode 派生（UI-303：计划模式是档位菜单第四档，单一事实源）
// - accessModeLabel（原 1322-1328）
// - modelGroups / activeSupplierGroup / selectedSupplierGroup /
//   preferredPresetForSupplier（原 1329-1364，纯派生不引入 memo）
// - selectModel（原 1365-1371，经 setActiveModelId 持久化）
// 调用点须在本 hook 全部依赖（useAiSettings 解构）声明之后。
// ============================================================
import { useCallback, useRef, useState } from 'react';
import type { ChatModelPreset } from '@/hooks/useAiSettings';
import {
  buildModelGroups,
  catalogSummary as summarizeCatalog,
  groupSelectableRows,
  preferredRowForGroup,
  type CatalogSummary,
  type ModelCatalogGroup,
  type ModelCatalogState,
} from '@/lib/model-catalog';

export type AccessMode = 'full' | 'workspace-write' | 'plan' | 'read';

export interface ModelAccessMenusController {
  modelMenuOpen: 'supplier' | 'model' | 'all' | null;
  setModelMenuOpen: React.Dispatch<React.SetStateAction<'supplier' | 'model' | 'all' | null>>;
  modelSupplierKey: string | null;
  setModelSupplierKey: React.Dispatch<React.SetStateAction<string | null>>;
  accessMenuOpen: boolean;
  setAccessMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  accessMode: AccessMode;
  setAccessMode: React.Dispatch<React.SetStateAction<AccessMode>>;
  planMode: boolean;
  prePlanAccessModeRef: React.MutableRefObject<'full' | 'workspace-write' | 'read' | null>;
  accessModeLabel: string;
  modelGroups: ModelCatalogGroup[];
  activeSupplierGroup: ModelCatalogGroup | undefined;
  selectedSupplierGroup: ModelCatalogGroup | undefined;
  catalogSummary: CatalogSummary;
  preferredPresetForSupplier: (group: ModelCatalogGroup) => ChatModelPreset | undefined;
  selectModel: (preset: ChatModelPreset) => Promise<void>;
}

export function useModelAccessMenus({
  modelPresets,
  activeModelId,
  setActiveModelId,
  catalog,
  onModelSelected,
  lockedAccessMode,
}: {
  modelPresets: ChatModelPreset[];
  activeModelId: string;
  setActiveModelId: (id: string) => Promise<unknown>;
  /** BLOCK-224 — 目录状态（加载/发现失败/凭据）；缺省空态=全部 ready。 */
  catalog?: ModelCatalogState;
  /** BLOCK-224 — 选中模型后的旁路回调（如应用该模型默认思考档）。 */
  onModelSelected?: (preset: ChatModelPreset) => void;
  /**
   * UI-448 加映 v2 — 档位锁定（悬挂聊天面仅聊天）：初始档位即锁定值，
   * setAccessMode 失效（选择器改不动）。锁定档的工具放行口径由后端
   * agent-tool-policy 权威门禁裁决，前端档位仅同步呈现。
   */
  lockedAccessMode?: AccessMode;
}): ModelAccessMenusController {
  const [modelMenuOpen, setModelMenuOpen] = useState<'supplier' | 'model' | 'all' | null>(null);
  const [modelSupplierKey, setModelSupplierKey] = useState<string | null>(null);
  const [accessMenuOpen, setAccessMenuOpen] = useState(false);
  const [accessMode, setAccessModeState] = useState<AccessMode>(lockedAccessMode ?? 'full');
  const setAccessMode = useCallback<React.Dispatch<React.SetStateAction<AccessMode>>>(
    (value) => {
      // UI-448 加映 v2 — 锁定档：setter 失效（含函数式更新一并不受理）
      if (lockedAccessMode) return;
      setAccessModeState(value);
    },
    [lockedAccessMode]
  );
  // BLOCK-55 P1 — Spec 门计划模式：只读探索 + 起草计划（写类工具被 policy 拒绝）。
  // UI-303 — 计划模式并入档位菜单成为第四档：planMode 由 accessMode 派生（单一事实源），
  // prePlanAccessModeRef 记录进入计划档前的档位，批准执行后恢复。
  const planMode = accessMode === 'plan';
  const prePlanAccessModeRef = useRef<'full' | 'workspace-write' | 'read' | null>(null);

  const accessModeLabel = accessMode === 'full'
    ? '完全访问'
    : accessMode === 'workspace-write'
      ? '项目写'
      : accessMode === 'plan'
        ? '计划模式'
        : '只读模式';
  const modelGroups = buildModelGroups(modelPresets, catalog);
  const activeSupplierGroup = modelGroups.find((group) =>
    group.rows.some((row) => row.preset.id === activeModelId)
  ) || modelGroups.find((group) => groupSelectableRows(group).length > 0) || modelGroups[0];
  const selectedSupplierGroup = modelGroups.find((group) => group.key === modelSupplierKey)
    || activeSupplierGroup;
  const preferredPresetForSupplier = useCallback(
    (group: ModelCatalogGroup) => preferredRowForGroup(group, activeModelId)?.preset,
    [activeModelId]
  );
  const modelCatalogSummary = summarizeCatalog(catalog, modelGroups);
  const selectModel = useCallback(async (preset: ChatModelPreset) => {
    setModelMenuOpen(null);
    setModelSupplierKey(null);
    // Hook persists the new active id + llm_provider via electron
    // bridge (Plan 1.6 §4.5 — replaces the local get-then-save).
    await setActiveModelId(preset.id);
    if (preset.defaultThinkingLevel && onModelSelected) onModelSelected(preset);
  }, [onModelSelected, setActiveModelId]);

  return {
    modelMenuOpen,
    setModelMenuOpen,
    modelSupplierKey,
    setModelSupplierKey,
    accessMenuOpen,
    setAccessMenuOpen,
    accessMode,
    setAccessMode,
    planMode,
    prePlanAccessModeRef,
    accessModeLabel,
    modelGroups,
    activeSupplierGroup,
    selectedSupplierGroup,
    catalogSummary: modelCatalogSummary,
    preferredPresetForSupplier,
    selectModel,
  };
}
