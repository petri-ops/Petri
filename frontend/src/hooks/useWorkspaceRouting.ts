
// UI-347 — 'search' 已从模式集合移除（左栏入口与搜索面退役）；历史深链
// /project/:id/search 经 parseWorkspaceMode 落 null → 'chat'（fail-closed）。
// UI-364 — 'plugins' 同口径移除（插件商店独立页化 /plugins；插件装卸是
// 设备级能力，与项目无语义绑定），历史深链 /project/:id/plugins → 'chat'。
// UI-365 — 'settings' 同口径移除（设置独立页化 /settings），历史深链
// /project/:id/settings → 'chat'。
export type WorkspaceMode = 'chat' | 'scheduled' | 'result' | 'code' | 'compare' | 'history';

const WORKSPACE_MODES: ReadonlySet<WorkspaceMode> = new Set([
  'chat',
  'scheduled',
  'result',
  'code',
  'compare',
  'history',
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

