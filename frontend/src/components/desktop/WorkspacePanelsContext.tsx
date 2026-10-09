/**
 * WorkspacePanelsContext — shared shell state between TitleBar and ProjectWorkspace
 */

import React, { createContext, useContext } from 'react';
import { useWorkspacePanels, type WorkspacePanels } from '@/hooks/useWorkspacePanels';
import { useAppRailOptional } from './AppRailContext';
import { useResponsivePanelCollapse } from '@/hooks/useResponsivePanelCollapse';

const WorkspacePanelsCtx = createContext<WorkspacePanels | null>(null);

export function WorkspacePanelsProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const panels = useWorkspacePanels();
  // UI-479 — 侧栏自适应收起：窗口/列宽低于阈值时自动收起（带还原+迟滞+手动优先）。
  // 列宽单真相在 AppRail 的 resizable（本 Provider 的外层）；裸 Provider 场景
  //（无 AppRail，如 TitleBar.test）enabled=false 完全旁路，行为零变化。
  const appRail = useAppRailOptional();
  useResponsivePanelCollapse(
    {
      leftOpen: panels.leftOpen,
      rightOpen: panels.rightOpen,
      setLeftOpen: panels.setLeftOpen,
      setRightOpen: panels.setRightOpen,
    },
    {
      leftWidth: appRail ? appRail.resizable.leftWidth : 0,
      rightWidth: appRail ? appRail.resizable.rightWidth : 0,
      setLeftWidth: appRail ? appRail.resizable.setLeftWidth : () => {},
      setRightWidth: appRail ? appRail.resizable.setRightWidth : () => {},
    },
    Boolean(appRail),
  );
  return <WorkspacePanelsCtx.Provider value={panels}>{children}</WorkspacePanelsCtx.Provider>;
}

export function useWorkspacePanelsContext(): WorkspacePanels {
  const ctx = useContext(WorkspacePanelsCtx);
  if (!ctx) {
    throw new Error('useWorkspacePanelsContext must be used inside WorkspacePanelsProvider');
  }
  return ctx;
}
