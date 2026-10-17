import { useCallback, useMemo, useState } from 'react';
import { filterSettingsSections } from '@/lib/settingsSearch';
import { resetFamiliesFor } from '@/lib/settingsFamilies';
import { resetConfigFamilies } from '@/lib/configTransfer';

/**
 * useSettingsTransferState — 设置面板的搜索/按区重置状态（BLOCK-201 W2）。
 *
 * 从 `DesktopSettingsPanel` 抽出，理由不是"好看"，是 code-size 门禁：面板已 696 行
 * （基线=696 / 硬预算 700），搜索与重置的状态机再塞进去就顶爆预算。抽出的这层只做三件事：
 * 分区过滤、重置调用、以及"重置后让面板重挂载"的版本号；渲染与 DOM 结构留在面板。
 */

interface Options {
  activeSection: string;
  activeLabel: string;
}

export interface SettingsTransferState {
  query: string;
  setQuery: (next: string) => void;
  visibleSectionIds: Set<string>;
  resetFamilies: string[];
  resetBusy: boolean;
  notice: string | null;
  /** 重置/导入后递增：分区面板以它为 key 重挂载，重新拉取生效值。 */
  settingsVersion: number;
  bumpVersion: () => void;
  resetActiveSection: () => Promise<void>;
}

export function useSettingsTransferState({ activeSection, activeLabel }: Options): SettingsTransferState {
  const [query, setQueryState] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);

  const visibleSectionIds = useMemo(() => new Set(filterSettingsSections(query)), [query]);
  const resetFamilies = resetFamiliesFor(activeSection as Parameters<typeof resetFamiliesFor>[0]);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setNotice(null);
  }, []);

  const bumpVersion = useCallback(() => {
    setSettingsVersion((version) => version + 1);
  }, []);

  // 只清该区注册表族的覆盖层（回落代码默认）；二次确认文案明确不动对话/项目/结果/凭据。
  const resetActiveSection = useCallback(async (): Promise<void> => {
    if (resetFamilies.length === 0) return;
    const confirmed = window.confirm(
      `恢复「${activeLabel}」的默认设置？\n\n` +
      `只清除本区已保存的覆盖值（回落代码默认），不会改动对话、项目、结果与凭据。`,
    );
    if (!confirmed) return;
    setResetBusy(true);
    setNotice(null);
    const result = await resetConfigFamilies(resetFamilies);
    setResetBusy(false);
    if (result.ok) {
      setNotice(`已恢复默认：${result.applied.join('、')}（面板已刷新）`);
      bumpVersion();
    } else {
      setNotice(`恢复失败：${result.diagnostics.map((row) => row.message || row.code).join('；')}`);
    }
  }, [activeLabel, resetFamilies, bumpVersion]);

  return {
    query,
    setQuery,
    visibleSectionIds,
    resetFamilies,
    resetBusy,
    notice,
    settingsVersion,
    bumpVersion,
    resetActiveSection,
  };
}
