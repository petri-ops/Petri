import type {
  ToolCallEvent,
  ToolResultEvent,
  ToolSideEffects,
} from './copilotClient';

export type ToolActivityStatus = 'running' | 'awaiting_confirmation' | 'success' | 'error' | 'denied';

export interface ToolActivityItem {
  key: string;
  callId?: string;
  traceId?: string;
  name: string;
  status: ToolActivityStatus;
  durationMs?: number;
  truncated?: boolean;
  terminationReason?: string;
  sideEffects?: ToolSideEffects;
  summary?: string;
}

function legacyKey(name: string, traceId?: string): string {
  return `${traceId || 'legacy'}:${name}`;
}

function callKey(event: ToolCallEvent): string {
  return event.callId || legacyKey(event.name, event.traceId);
}

function nextLegacyCallKey(current: ToolActivityItem[], event: ToolCallEvent): string {
  const base = callKey(event);
  const occurrence = current.filter((item) => item.key === base || item.key.startsWith(`${base}:`)).length + 1;
  return `${base}:${occurrence}`;
}

function resultKey(event: ToolResultEvent): string {
  const result = event.toolResult;
  return result?.callId || legacyKey(result?.tool || event.name, result?.traceId);
}

export function mergeToolCallActivity(
  current: ToolActivityItem[],
  event: ToolCallEvent
): ToolActivityItem[] {
  const baseKey = callKey(event);
  const index = current.findIndex((item) => item.key === baseKey);
  if (index >= 0) {
    // Structured task-mode SSE can replay a call after its result. Never
    // downgrade a terminal item back to running when that happens.
    if (event.callId && current[index].status !== 'running') return current;
    if (current[index].status === 'running') {
      const next = current.slice();
      next[index] = {
        ...current[index],
        callId: event.callId || current[index].callId,
        traceId: event.traceId || current[index].traceId,
        name: event.name,
      };
      return next;
    }
  }
  const key = event.callId ? baseKey : nextLegacyCallKey(current, event);
  return [
    ...current,
    {
      key,
      callId: event.callId,
      traceId: event.traceId,
      name: event.name,
      status: 'running',
    },
  ];
}

function inferLegacyStatus(event: ToolResultEvent): ToolActivityStatus {
  return /^错误[:：]/.test(event.summary || '') || Boolean(event.actError)
    ? 'error'
    : 'success';
}

export function mergeToolResultActivity(
  current: ToolActivityItem[],
  event: ToolResultEvent
): ToolActivityItem[] {
  const result = event.toolResult;
  const name = result?.tool || event.name;
  const key = resultKey(event);
  let index = current.findIndex((item) => item.key === key);

  // Legacy events have no callId. Correlate them with the newest running call
  // of the same tool instead of creating duplicate rows.
  if (!result?.callId && index < 0) {
    for (let i = current.length - 1; i >= 0; i -= 1) {
      if (current[i].name === name && current[i].status === 'running') {
        index = i;
        break;
      }
    }
  }

  const item: ToolActivityItem = {
    key: index >= 0 ? current[index].key : key,
    callId: result?.callId || (index >= 0 ? current[index].callId : undefined),
    traceId: result?.traceId || (index >= 0 ? current[index].traceId : undefined),
    name,
    status: result?.terminationReason === 'approval_required'
      ? 'awaiting_confirmation'
      : result?.status || inferLegacyStatus(event),
    durationMs: result?.durationMs,
    truncated: result?.truncated,
    terminationReason: result?.terminationReason,
    sideEffects: result?.sideEffects,
    summary: event.summary,
  };

  if (index < 0) return [...current, item];
  const next = current.slice();
  next[index] = { ...current[index], ...item };
  return next;
}

export function formatToolDuration(durationMs?: number): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

export function formatToolSideEffects(sideEffects?: ToolSideEffects): string | null {
  if (!sideEffects || sideEffects.type === 'none') return null;
  const resources = sideEffects.resources.length > 0
    ? ` · ${sideEffects.resources.join(', ')}`
    : '';
  return `${sideEffects.type} · ${sideEffects.riskTier}${resources}`;
}
