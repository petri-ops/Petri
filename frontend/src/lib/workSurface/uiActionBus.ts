import type { PackUiActionDescriptor } from './types';

export const WORK_SURFACE_UI_ACTION_EVENT = 'petri:work-surface-ui-action';
export const WORK_SURFACE_UI_ACTION_RESULT_EVENT = 'petri:work-surface-ui-action-result';

export interface WorkSurfaceUiActionDetail {
  actionId: string;
  payload?: Record<string, unknown>;
  /** Correlation id so the host can ack the exact backend request. */
  requestId?: string;
}

export interface WorkSurfaceUiActionResultDetail extends WorkSurfaceUiActionDetail {
  ok: boolean;
  message?: string;
}

/** Host → PackSurfaceFrame dispatch (one correlation id per backend request). */
export function dispatchWorkSurfaceUiAction(detail: WorkSurfaceUiActionDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WORK_SURFACE_UI_ACTION_EVENT, { detail }));
}

/** Pack iframe result → host ack/audit listener. */
export function dispatchWorkSurfaceUiActionResult(detail: WorkSurfaceUiActionResultDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WORK_SURFACE_UI_ACTION_RESULT_EVENT, { detail }));
}

export function actionsForSurface(
  actions: readonly PackUiActionDescriptor[],
  surfaceId: string
): PackUiActionDescriptor[] {
  return actions.filter((action) => !action.surfaceId || action.surfaceId === surfaceId);
}
