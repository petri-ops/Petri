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
  iteration?: number;
  name: string;
  status: ToolActivityStatus;
  durationMs?: number;
  sourceTruncated?: boolean;
  previewTruncated?: boolean;
  truncated?: boolean;
  terminationReason?: string;
  sideEffects?: ToolSideEffects;
  summary?: string;
  actionLabel: string;
  actionDetail?: string;
}

const ACTIVITY_STATUSES: ToolActivityStatus[] = [
  'running',
  'awaiting_confirmation',
  'success',
  'error',
  'denied',
];

/** Restore only the safe, bounded activity shape persisted with a message. */
export function restoreToolActivities(value: unknown): ToolActivityItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name : '';
    const status = typeof raw.status === 'string' && ACTIVITY_STATUSES.includes(raw.status as ToolActivityStatus)
      ? raw.status as ToolActivityStatus
      : null;
    if (!name || !status) return [];
    const durationMs = typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)
      ? raw.durationMs
      : undefined;
    const sideEffects = raw.sideEffects && typeof raw.sideEffects === 'object'
      ? raw.sideEffects as ToolSideEffects
      : undefined;
    return [{
      key: typeof raw.key === 'string' ? raw.key : `restored:${index}:${name}`,
      callId: typeof raw.callId === 'string' ? raw.callId : undefined,
      traceId: typeof raw.traceId === 'string' ? raw.traceId : undefined,
      iteration: typeof raw.iteration === 'number' && Number.isFinite(raw.iteration)
        ? raw.iteration
        : undefined,
      name,
      status,
      durationMs,
      sourceTruncated: typeof raw.sourceTruncated === 'boolean' ? raw.sourceTruncated : undefined,
      previewTruncated: typeof raw.previewTruncated === 'boolean' ? raw.previewTruncated : undefined,
      truncated: typeof raw.truncated === 'boolean' ? raw.truncated : undefined,
      terminationReason: typeof raw.terminationReason === 'string' ? raw.terminationReason : undefined,
      sideEffects,
      summary: typeof raw.summary === 'string' ? raw.summary : undefined,
      actionLabel: typeof raw.actionLabel === 'string' ? raw.actionLabel : '已调用',
      actionDetail: typeof raw.actionDetail === 'string' ? raw.actionDetail : undefined,
    }];
  });
}

function legacyKey(name: string, traceId?: string): string {
  return `${traceId || 'legacy'}:${name}`;
}

function callKey(event: ToolCallEvent): string {
  return event.callId || legacyKey(event.name, event.traceId);
}

function compactDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > 140 ? `${normalized.slice(0, 137)}…` : normalized;
}

/** Convert tool arguments into a safe, user-facing Codex-style activity line. */
export function summarizeToolCall(
  name: string,
  args: Record<string, unknown> = {}
): { actionLabel: string; actionDetail?: string } {
  switch (name) {
    case 'workspace_exec':
      return { actionLabel: '已运行', actionDetail: compactDetail(args.command) || '命令' };
    case 'workspace_read': {
      const path = compactDetail(args.path) || '文件';
      const start = Number.isInteger(args.startLine) ? ` · 第 ${args.startLine} 行起` : '';
      return { actionLabel: '已读取', actionDetail: `${path}${start}` };
    }
    case 'workspace_list':
      return { actionLabel: '已读取', actionDetail: `目录 ${compactDetail(args.path) || '.'}` };
    case 'workspace_find':
      return { actionLabel: '已查找', actionDetail: compactDetail(args.pattern) || '文件' };
    case 'workspace_search':
      return { actionLabel: '已搜索', actionDetail: compactDetail(args.query) || '文本' };
    case 'workspace_write':
    case 'workspace_replace':
      return { actionLabel: '已修改', actionDetail: compactDetail(args.path) || '文件' };
    case 'run_tool':
      return { actionLabel: '已运行', actionDetail: compactDetail(args.toolId) || '分析工具' };
    default:
      return { actionLabel: '已调用', actionDetail: name };
  }
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
        ...summarizeToolCall(event.name, event.args),
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
      iteration: event.iteration,
      name: event.name,
      status: 'running',
      ...summarizeToolCall(event.name, event.args),
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

  const fallbackAction = summarizeToolCall(name);
  const item: ToolActivityItem = {
    key: index >= 0 ? current[index].key : key,
    callId: result?.callId || (index >= 0 ? current[index].callId : undefined),
    traceId: result?.traceId || (index >= 0 ? current[index].traceId : undefined),
    iteration: event.iteration || (index >= 0 ? current[index].iteration : undefined),
    name,
    status: result?.terminationReason === 'approval_required'
      ? 'awaiting_confirmation'
      : result?.status || inferLegacyStatus(event),
    durationMs: result?.durationMs,
    sourceTruncated: result?.sourceTruncated,
    previewTruncated: result?.previewTruncated,
    truncated: result?.truncated,
    terminationReason: result?.terminationReason,
    sideEffects: result?.sideEffects,
    summary: event.summary,
    actionLabel: index >= 0 ? current[index].actionLabel : fallbackAction.actionLabel,
    actionDetail: index >= 0 ? current[index].actionDetail : fallbackAction.actionDetail,
  };

  if (index < 0) return [...current, item];
  const next = current.slice();
  next[index] = { ...current[index], ...item };
  return next;
}

export function formatToolDuration(durationMs?: number): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(durationMs < 10_000 ? 1 : 0)} s`;
  const roundedSeconds = Math.round(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatToolSideEffects(sideEffects?: ToolSideEffects): string | null {
  if (!sideEffects || sideEffects.type === 'none') return null;
  const resources = sideEffects.resources.length > 0
    ? ` · ${sideEffects.resources.join(', ')}`
    : '';
  return `${sideEffects.type} · ${sideEffects.riskTier}${resources}`;
}
