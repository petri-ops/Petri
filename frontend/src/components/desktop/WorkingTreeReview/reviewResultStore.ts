// BLOCK-26 P3 — detached review results.
//
// The review runs as a backend task, so it survives the drawer (and the
// page). This module-level store keeps the latest outcome per project so
// reopening the Working Tree Review drawer restores the last review, and a
// still-running task can be re-attached by taskId through the SSE replay.
// Intentionally in-memory: closing the app discards it (backend truth lives
// in the task store; replay-on-demand remains available).

import type { ReviewFinding, ReviewOutputEvent } from '@/lib/review-types';

export interface PersistedReviewState {
  phase: 'running' | 'done' | 'error';
  taskId: string | null;
  findings: ReviewFinding[];
  output: ReviewOutputEvent | null;
  error: string | null;
  startedAt: number | null;
  channelLabel: string | null;
  targetHint: string | null;
}

const store = new Map<string, PersistedReviewState>();

export function saveReviewState(projectId: string, state: PersistedReviewState): void {
  if (!projectId) return;
  store.set(projectId, state);
}

export function loadReviewState(projectId: string): PersistedReviewState | null {
  return store.get(projectId) ?? null;
}

export function clearReviewState(projectId: string): void {
  store.delete(projectId);
}
