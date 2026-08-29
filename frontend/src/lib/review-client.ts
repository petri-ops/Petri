// BLOCK-25 — review sub-agent client (renderer).
//
// Launches POST /api/agent/review and consumes the shared
// GET /api/ai/agent/task/:taskId SSE. Deliberately separate from
// copilotClient's stream parsing: the review stream cares about only four
// event kinds (delta / agent_status / review_output / done) and must not
// drag in chat card dispatch.

import { getApiPrefix } from '@/components/copilot/copilotClient';
import type { ReviewLaunchResult, ReviewOutputEvent, ReviewTarget } from './review-types';

function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const token = localStorage.getItem('biof3_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export async function launchReview(opts: {
  projectId: string;
  target: ReviewTarget;
  modelPresetId?: string | null;
  signal?: AbortSignal;
}): Promise<ReviewLaunchResult> {
  const resp = await fetch(getApiPrefix() + '/agent/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({
      projectId: opts.projectId,
      target: opts.target,
      ...(opts.modelPresetId ? { modelPresetId: opts.modelPresetId } : {}),
    }),
    signal: opts.signal,
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    const message = typeof data.error === 'string' ? data.error : `HTTP ${resp.status}`;
    throw new Error(message);
  }
  return data as unknown as ReviewLaunchResult;
}

export interface ReviewStreamHandlers {
  onDelta?: (text: string) => void;
  onStatus?: (phase: string, detail?: Record<string, unknown>) => void;
  onReviewOutput?: (event: ReviewOutputEvent) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Subscribe to a review task's SSE stream. Resolves when the stream ends.
 * Reconnects with afterSeq are intentionally left to the caller (the review
 * panel treats a lost stream as terminal for this slice).
 */
export async function streamReviewTask(
  taskId: string,
  handlers: ReviewStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const authHeader = getAuthHeader();
  const token = authHeader.Authorization?.replace('Bearer ', '');
  const url = `${getApiPrefix()}/ai/agent/task/${taskId}?afterSeq=0${token ? '&token=' + encodeURIComponent(token) : ''}`;
  const resp = await fetch(url, { method: 'GET', headers: { ...authHeader }, signal });
  if (!resp.ok || !resp.body) {
    let errText = `HTTP ${resp.status}`;
    try {
      const t = await resp.text();
      if (t) errText += ': ' + t.slice(0, 200);
    } catch {}
    throw new Error(errText);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const handleEvent = (obj: Record<string, unknown>) => {
    const payload = (obj.payload && typeof obj.payload === 'object' ? obj.payload : obj) as Record<string, unknown>;
    const kind = typeof payload.event === 'string' ? payload.event : '';
    if (kind === 'delta') {
      const content = (payload.choices as Array<{ delta?: { content?: string } }> | undefined)?.[0]?.delta?.content;
      if (content) handlers.onDelta?.(content);
      return;
    }
    if (kind === 'agent_status') {
      handlers.onStatus?.(String(payload.phase || ''), payload);
      return;
    }
    if (kind === 'review_output') {
      const { parseLevel: _ignored, ...event } = payload as Record<string, unknown> & { parseLevel?: string };
      handlers.onReviewOutput?.(event as unknown as ReviewOutputEvent);
      return;
    }
    if (kind === 'error') {
      // Task-level failure (provider error, budget exceeded, …) persisted by
      // the task store before the stream closes. Surfacing it is mandatory —
      // otherwise a failed review renders as "no findings".
      handlers.onError?.(new Error(String(payload.error || 'review failed')));
      return;
    }
    if (kind === 'done') {
      handlers.onDone?.();
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIdx;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      for (const line of rawEvent.split('\n')) {
        const m = line.match(/^data:\s?(.*)$/);
        if (!m) continue;
        const data = m[1];
        if (data === '[DONE]') {
          handlers.onDone?.();
          return;
        }
        try {
          handleEvent(JSON.parse(data));
        } catch {
          // bad JSON — ignore
        }
      }
    }
  }
  handlers.onDone?.();
}

export async function cancelReviewTask(taskId: string): Promise<void> {
  await fetch(`${getApiPrefix()}/ai/agent/task/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
    headers: { ...getAuthHeader() },
  }).catch(() => {});
}
