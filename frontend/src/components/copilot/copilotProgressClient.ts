// ============================================================
// Client for /api/ai/progress (Phase α — learning progress tracking)
//
// Authors normally don't call this directly — they mount the
// <CopilotProgressTracker /> component (see ./CopilotProgressTracker.tsx)
// or call `reportProgress(event, resource)` from page-level effects.
// ============================================================

import { getApiPrefix } from '@/components/copilot/copilotClient';

export type ProgressEvent = 'started' | 'completed';
export type ProgressType = 'doc' | 'figcode' | 'act' | 'unknown';
export type ProgressStatus = 'started' | 'completed';

export interface ProgressRow {
  resource: string;
  type: ProgressType;
  status: ProgressStatus;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface ProgressSummary {
  total: number;
  completed: number;
  byType: { type: ProgressType; status: ProgressStatus; n: number }[];
  recent: Pick<ProgressRow, 'resource' | 'type' | 'status' | 'updated_at'>[];
}

function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const token = localStorage.getItem('biof3_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function isLoggedIn(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return !!localStorage.getItem('biof3_token');
  } catch {
    return false;
  }
}

/**
 * In-tab dedupe — avoids hammering the server when a user navigates back to
 * the same doc within seconds. Backend is also idempotent, but this saves a
 * round-trip and reduces noise in logs.
 */
const _recentSends = new Map<string, number>();
const DEDUPE_TTL_MS = 30_000;

function _shouldSend(key: string): boolean {
  const now = Date.now();
  const last = _recentSends.get(key) ?? 0;
  if (now - last < DEDUPE_TTL_MS) return false;
  _recentSends.set(key, now);
  // Trim opportunistically
  if (_recentSends.size > 200) {
    for (const [k, ts] of _recentSends) {
      if (now - ts > DEDUPE_TTL_MS) _recentSends.delete(k);
    }
  }
  return true;
}

/**
 * Report a progress event. Fire-and-forget; never throws.
 * Returns false if the call was skipped (anonymous / dedupe / bad input).
 */
export async function reportProgress(event: ProgressEvent, resource: string): Promise<boolean> {
  if (!isLoggedIn()) return false;
  if (!resource || typeof resource !== 'string') return false;
  if (event !== 'started' && event !== 'completed') return false;

  const key = event + '|' + resource;
  if (!_shouldSend(key)) return false;

  try {
    const resp = await fetch(getApiPrefix() + '/ai/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ event, resource }),
      keepalive: true, // survives page-unload during 'completed' on close
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function listMyProgress(limit = 200): Promise<ProgressRow[]> {
  if (!isLoggedIn()) return [];
  try {
    const resp = await fetch(getApiPrefix() + '/ai/progress/mine?limit=' + limit, {
      headers: getAuthHeader(),
    });
    if (!resp.ok) return [];
    const j = await resp.json();
    return Array.isArray(j.progress) ? j.progress : [];
  } catch {
    return [];
  }
}

export async function getProgressSummary(): Promise<ProgressSummary | null> {
  if (!isLoggedIn()) return null;
  try {
    const resp = await fetch(getApiPrefix() + '/ai/progress/summary', {
      headers: getAuthHeader(),
    });
    if (!resp.ok) return null;
    const j = await resp.json();
    if (j.status !== 'ok') return null;
    return {
      total: j.total ?? 0,
      completed: j.completed ?? 0,
      byType: j.byType ?? [],
      recent: j.recent ?? [],
    };
  } catch {
    return null;
  }
}
