import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export type WorkspaceMode = 'cloud' | 'chat' | 'search' | 'scheduled' | 'tools' | 'figcode' | 'plugins' | 'settings';

export const WORKSPACE_MODES: ReadonlySet<WorkspaceMode> = new Set([
  'cloud',
  'chat',
  'search',
  'scheduled',
  'tools',
  'figcode',
  'plugins',
  'settings',
]);

export function parseWorkspaceMode(raw: string | null | undefined): WorkspaceMode | null {
  if (!raw) return null;
  return (WORKSPACE_MODES as Set<string>).has(raw) ? (raw as WorkspaceMode) : null;
}

export interface UseWorkspaceRoutingResult {
  mode: WorkspaceMode;
  setMode: (next: WorkspaceMode, replace?: boolean) => void;
}

/**
 * Bidirectionally syncs the workspace `mode` with the `?mode=` URL param.
 * `setMode('chat')` removes the param (chat is the default landing mode).
 */
export function useWorkspaceRouting(defaultMode: WorkspaceMode = 'chat'): UseWorkspaceRoutingResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setModeState] = useState<WorkspaceMode>(
    () => parseWorkspaceMode(searchParams.get('mode')) || defaultMode,
  );

  // URL → state
  useEffect(() => {
    const next = parseWorkspaceMode(searchParams.get('mode')) || defaultMode;
    setModeState((current) => (current === next ? current : next));
  }, [searchParams, defaultMode]);

  const setMode = useCallback(
    (nextMode: WorkspaceMode, replace = true) => {
      setModeState(nextMode);
      const nextParams = new URLSearchParams(searchParams);
      if (nextMode === defaultMode) nextParams.delete('mode');
      else nextParams.set('mode', nextMode);
      setSearchParams(nextParams, { replace });
    },
    [searchParams, setSearchParams, defaultMode],
  );

  return { mode, setMode };
}