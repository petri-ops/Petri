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
import {
  preferredModelPreset,
  type ChatModelPreset,
} from '@/hooks/useAiSettings';

export interface ChatModelGroup {
  key: string;
  supplier: string;
  defaultModel: string;
  lastSelectedModel: string;
  presets: ChatModelPreset[];
}

export type AccessMode = 'full' | 'workspace-write' | 'plan' | 'read';

export interface ModelAccessMenusController {
  modelMenuOpen: 'supplier' | 'model' | null;
  setModelMenuOpen: React.Dispatch<React.SetStateAction<'supplier' | 'model' | null>>;
  modelSupplierKey: string | null;
  setModelSupplierKey: React.Dispatch<React.SetStateAction<string | null>>;
  accessMenuOpen: boolean;
  setAccessMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  accessMode: AccessMode;
  setAccessMode: React.Dispatch<React.SetStateAction<AccessMode>>;
  planMode: boolean;
  prePlanAccessModeRef: React.MutableRefObject<'full' | 'workspace-write' | 'read' | null>;
  accessModeLabel: string;
  modelGroups: ChatModelGroup[];
  activeSupplierGroup: ChatModelGroup | undefined;
  selectedSupplierGroup: ChatModelGroup | undefined;
  preferredPresetForSupplier: (group: ChatModelGroup) => ChatModelPreset | undefined;
  selectModel: (preset: ChatModelPreset) => Promise<void>;
}

export function useModelAccessMenus({
  modelPresets,
  activeModelId,
  setActiveModelId,
}: {
  modelPresets: ChatModelPreset[];
  activeModelId: string;
  setActiveModelId: (id: string) => Promise<unknown>;
}): ModelAccessMenusController {
  const [modelMenuOpen, setModelMenuOpen] = useState<'supplier' | 'model' | null>(null);
  const [modelSupplierKey, setModelSupplierKey] = useState<string | null>(null);
  const [accessMenuOpen, setAccessMenuOpen] = useState(false);
  const [accessMode, setAccessMode] = useState<AccessMode>('full');
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
  const modelGroups = modelPresets.reduce<ChatModelGroup[]>(
    (groups, preset) => {
      const supplier = preset.label || preset.provider;
      const key = preset.endpointProfileId || preset.provider;
      const existing = groups.find((group) => group.key === key);
      if (existing) existing.presets.push(preset);
      else groups.push({
        key,
        supplier,
        defaultModel: preset.defaultModel || preset.model,
        lastSelectedModel: preset.lastSelectedModel || preset.model,
        presets: [preset],
      });
      return groups;
    },
    []
  );
  const activeSupplierGroup = modelGroups.find((group) =>
    group.presets.some((preset) => preset.id === activeModelId)
  ) || modelGroups[0];
  const selectedSupplierGroup = modelGroups.find((group) => group.key === modelSupplierKey)
    || activeSupplierGroup;
  const preferredPresetForSupplier = useCallback((group: ChatModelGroup) => {
    return preferredModelPreset(
      group.presets,
      group.key === activeSupplierGroup?.key ? activeModelId : undefined,
      group.lastSelectedModel,
      group.defaultModel
    );
  }, [activeModelId, activeSupplierGroup?.key]);
  const selectModel = useCallback(async (preset: ChatModelPreset) => {
    setModelMenuOpen(null);
    setModelSupplierKey(null);
    // Hook persists the new active id + llm_provider via electron
    // bridge (Plan 1.6 §4.5 — replaces the local get-then-save).
    await setActiveModelId(preset.id);
  }, [setActiveModelId]);

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
    preferredPresetForSupplier,
    selectModel,
  };
}
