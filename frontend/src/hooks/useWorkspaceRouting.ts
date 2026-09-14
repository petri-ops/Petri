import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// UI-347 — 'search' 已从模式集合移除（左栏入口与搜索面退役）；历史深链
// /project/:id/search 经 parseWorkspaceMode 落 null → 'chat'（fail-closed）。
// UI-364 — 'plugins' 同口径移除（插件商店独立页化 /plugins；插件装卸是
// 设备级能力，与项目无语义绑定），历史深链 /project/:id/plugins → 'chat'。
export type WorkspaceMode = 'chat' | 'scheduled' | 'result' | 'code' | 'compare' | 'history' | 'settings';

export const WORKSPACE_MODES: ReadonlySet<WorkspaceMode> = new Set([
  'chat',
  'scheduled',
  'result',
  'code',
  'compare',
  'history',
  'settings',
]);

export function parseWorkspaceMode(raw: string | null | undefined): WorkspaceMode | null {
  if (!raw) return null;
  return (WORKSPACE_MODES as Set<string>).has(raw) ? (raw as WorkspaceMode) : null;
}

// T85: mode now lives in the URL sub-path (`/project/:id/<mode>`) instead of
// the `?mode=` query param. `chat` is the default landing mode and carries no
// segment, so deep links stay clean (`/project/:id` === `/project/:id/chat`).
export function segmentToMode(seg: string | null | undefined): WorkspaceMode {
  return parseWorkspaceMode(seg) || 'chat';
}

export function modeToSegment(mode: WorkspaceMode): string {
  return mode === 'chat' ? '' : mode;
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
