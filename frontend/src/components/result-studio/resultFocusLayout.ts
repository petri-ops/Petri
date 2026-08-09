import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';

export type ResultFocusTransition = 'enter' | 'stay' | 'exit' | 'idle';

export function isResultWorkspaceMode(mode: WorkspaceMode): boolean {
  return mode === 'result' || mode === 'code' || mode === 'compare' || mode === 'history';
}

export function resultFocusTransition(
  focusActive: boolean,
  mode: WorkspaceMode,
): ResultFocusTransition {
  if (isResultWorkspaceMode(mode)) return focusActive ? 'stay' : 'enter';
  return focusActive ? 'exit' : 'idle';
}
