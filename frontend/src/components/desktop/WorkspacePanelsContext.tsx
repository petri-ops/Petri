/**
 * WorkspacePanelsContext — shared shell state between TitleBar and ProjectWorkspace
 */

import React, { createContext, useContext } from 'react';
import { useWorkspacePanels, type WorkspacePanels } from '@/hooks/useWorkspacePanels';

const WorkspacePanelsCtx = createContext<WorkspacePanels | null>(null);

export function WorkspacePanelsProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const panels = useWorkspacePanels();
  return <WorkspacePanelsCtx.Provider value={panels}>{children}</WorkspacePanelsCtx.Provider>;
}

export function useWorkspacePanelsContext(): WorkspacePanels {
  const ctx = useContext(WorkspacePanelsCtx);
  if (!ctx) {
    throw new Error('useWorkspacePanelsContext must be used inside WorkspacePanelsProvider');
  }
  return ctx;
}
