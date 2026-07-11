/**
 * useRightPanelTabs — right panel tab state and the open/close handlers.
 *
 * State owned here:
 * - rightTab       — active tab
 * - openRightTabs  — ordered list of open tabs
 * - rightToolMenuOpen — tools flyout
 * - browserUrl      — embedded browser URL
 */
import { useCallback, useState } from 'react';
import type { RightPanelMode } from '@/pages/project-workspace';

export interface UseRightPanelTabsResult {
  rightTab: RightPanelMode;
  setRightTab: React.Dispatch<React.SetStateAction<RightPanelMode>>;
  openRightTabs: RightPanelMode[];
  setOpenRightTabs: React.Dispatch<React.SetStateAction<RightPanelMode[]>>;
  rightToolMenuOpen: boolean;
  setRightToolMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  browserUrl: string;
  setBrowserUrl: React.Dispatch<React.SetStateAction<string>>;
  openRightPanel: (tab: RightPanelMode, compactLayout?: boolean) => void;
  closeRightPanelTab: (tab: RightPanelMode) => void;
}

export function useRightPanelTabs(): UseRightPanelTabsResult {
  const [rightTab, setRightTab] = useState<RightPanelMode>('home');
  const [openRightTabs, setOpenRightTabs] = useState<RightPanelMode[]>(['home']);
  const [rightToolMenuOpen, setRightToolMenuOpen] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('https://biof3.com/');

  const openRightPanel = useCallback(
    (tab: RightPanelMode, _compactLayout?: boolean) => {
      setOpenRightTabs((current) =>
        current.includes(tab) ? current : [...current, tab],
      );
      setRightTab(tab);
    },
    [],
  );

  const closeRightPanelTab = useCallback((tab: RightPanelMode) => {
    setOpenRightTabs((current) => {
      if (current.length <= 1) return current;
      const closingIndex = current.indexOf(tab);
      const next = current.filter((item) => item !== tab);
      setRightTab((active) =>
        active === tab
          ? next[Math.min(Math.max(closingIndex, 0), next.length - 1)] || next[0]
          : active,
      );
      return next;
    });
  }, []);

  return {
    rightTab,
    setRightTab,
    openRightTabs,
    setOpenRightTabs,
    rightToolMenuOpen,
    setRightToolMenuOpen,
    browserUrl,
    setBrowserUrl,
    openRightPanel,
    closeRightPanelTab,
  };
}
