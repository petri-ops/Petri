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
  // BLOCK-62 P2 — leftPanelWidth/rightPanelWidth 已退役：列体化后顶栏由三个列内
  // ColumnHeader 承载（宽度=各自 aside 宽，同一次 commit，无跨树同步）；fixed 整条
  // 只在 compact/loading/error/非工作区路由渲染，这些态无真实可拖列，宽度推送成死链。
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
};

function titleBarDataEqual(a: TitleBarState, b: TitleBarState): boolean {
  return (
    a.title === b.title &&
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
  // BLOCK-87 L3 — 投影+窄屏（手机浏览器）初始收起两侧栏：中栏全屏，
  // 侧栏经顶栏按钮展开为浮层（compactLayout 机制已有）。桌面端不受影响
  // （无 __projection 标志；UI-341「侧栏常驻」裁决仅针对桌面窗口）。
  const projectionNarrow = (() => {
    try {
      const projection = (window.biof3Desktop as { __projection?: boolean } | undefined)?.__projection === true;
      return projection && window.matchMedia('(max-width: 767px)').matches;
    } catch {
      return false;
    }
  })();
  const [leftOpen, setLeftOpen] = useState(!projectionNarrow);
  const [rightOpen, setRightOpen] = useState(!projectionNarrow);
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
