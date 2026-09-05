/**
 * useWorkspacePanels — shared shell state for the Codex-like desktop chrome
 */

import { useCallback, useState } from 'react';
import type { IconName } from '@/components/icons/Icon';

export interface TitleBarTab {
  id: string;
  label: string;
  icon: IconName;
  closable?: boolean;
}

export interface TitleBarToolItem {
  id: string;
  label: string;
  icon: IconName;
  isOpen?: boolean;
}

export interface TitleBarResultItem {
  id: string;
  label: string;
  status: string;
}

export interface TitleBarState {
  title: string;
  leftPanelWidth: number;
  rightPanelWidth: number;
  tabs: TitleBarTab[];
  activeTabId: string | null;
  onSelectTab: ((id: string) => void) | null;
  onCloseTab: ((id: string) => void) | null;
  onMoreAction: (() => void) | null;
  toolMenuOpen: boolean;
  toolMenuItems: TitleBarToolItem[];
  onSelectToolItem: ((id: string) => void) | null;
  resultItems: TitleBarResultItem[];
  activeResultId: string | null;
  onSelectResult: ((id: string) => void) | null;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: (() => void) | null;
  onGoForward: (() => void) | null;
  // Conversations for TitleBar selector
  conversations?: Array<{ id: string; title: string | null; parent_id: string | null }>;
  activeConvId?: string | null;
  onSelectConversation?: (id: string) => void;
}

export interface WorkspacePanels {
  leftOpen: boolean;
  rightOpen: boolean;
  bottomTerminalOpen: boolean;
  summaryOpen: boolean;
  setLeftOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setBottomTerminalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSummaryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleLeft: () => void;
  toggleRight: () => void;
  toggleBottomTerminal: () => void;
  toggleSummary: () => void;
  titleBar: TitleBarState;
  setTitleBar: React.Dispatch<React.SetStateAction<TitleBarState>>;
  updateTitleBar: (patch: Partial<TitleBarState>) => void;
}

const DEFAULT_TITLE_BAR: TitleBarState = {
  title: 'Gewu',
  leftPanelWidth: 240,
  rightPanelWidth: 340,
  tabs: [],
  activeTabId: null,
  onSelectTab: null,
  onCloseTab: null,
  onMoreAction: null,
  toolMenuOpen: false,
  toolMenuItems: [],
  onSelectToolItem: null,
  resultItems: [],
  activeResultId: null,
  onSelectResult: null,
  canGoBack: false,
  canGoForward: false,
  onGoBack: null,
  onGoForward: null,
  conversations: undefined,
  activeConvId: null,
  onSelectConversation: undefined,
};

function titleBarDataEqual(a: TitleBarState, b: TitleBarState): boolean {
  return (
    a.title === b.title &&
    a.leftPanelWidth === b.leftPanelWidth &&
    a.rightPanelWidth === b.rightPanelWidth &&
    a.activeTabId === b.activeTabId &&
    a.toolMenuOpen === b.toolMenuOpen &&
    a.activeResultId === b.activeResultId &&
    a.canGoBack === b.canGoBack &&
    a.canGoForward === b.canGoForward &&
    JSON.stringify(a.tabs) === JSON.stringify(b.tabs) &&
    JSON.stringify(a.toolMenuItems) === JSON.stringify(b.toolMenuItems) &&
    JSON.stringify(a.resultItems) === JSON.stringify(b.resultItems)
  );
}

export function useWorkspacePanels(): WorkspacePanels {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [bottomTerminalOpen, setBottomTerminalOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [titleBar, setTitleBar] = useState<TitleBarState>(DEFAULT_TITLE_BAR);

  const toggleLeft = useCallback(() => setLeftOpen((v) => !v), []);
  const toggleRight = useCallback(() => setRightOpen((v) => !v), []);
  const toggleBottomTerminal = useCallback(() => setBottomTerminalOpen((v) => !v), []);
  const toggleSummary = useCallback(() => setSummaryOpen((v) => !v), []);
  const updateTitleBar = useCallback((patch: Partial<TitleBarState>) => {
    setTitleBar((current) => {
      const next = { ...current, ...patch };
      return titleBarDataEqual(current, next) ? current : next;
    });
  }, []);

  return {
    leftOpen,
    rightOpen,
    bottomTerminalOpen,
    summaryOpen,
    setLeftOpen,
    setRightOpen,
    setBottomTerminalOpen,
    setSummaryOpen,
    toggleLeft,
    toggleRight,
    toggleBottomTerminal,
    toggleSummary,
    titleBar,
    setTitleBar,
    updateTitleBar,
  };
}
