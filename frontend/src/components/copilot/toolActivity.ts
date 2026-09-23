import type {
  ToolCallEvent,
  ToolOutputEvent,
  ToolResultEvent,
  ToolSideEffects,
} from './copilotClient';

export type ToolActivityStatus = 'running' | 'awaiting_confirmation' | 'success' | 'error' | 'denied';

/** BLOCK-33 P3 — 流式输出尾部（内存态，不随会话持久化）。 */
export interface ToolActivityOutput {
  tail: string;
  truncated: boolean;
}

/** UI-273 增补 — 写操作（workspace_write / workspace_replace）的逐行改动，随活动落库。 */
export type ToolChangeDiffLineType = 'ctx' | 'add' | 'del';

export interface ToolChangeDiffHunk {
  oldStart: number;
  newStart: number;
  lines: Array<{ type: ToolChangeDiffLineType; text: string }>;
}

export interface ToolActivityChangeDiff {
  added: number;
  removed: number;
  truncated?: boolean;
  hunks: ToolChangeDiffHunk[];
}

function parseChangeDiff(value: unknown): ToolActivityChangeDiff | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const added = typeof raw.added === 'number' && Number.isFinite(raw.added) ? raw.added : 0;
  const removed = typeof raw.removed === 'number' && Number.isFinite(raw.removed) ? raw.removed : 0;
  const hunks = Array.isArray(raw.hunks)
    ? raw.hunks.flatMap((hunk) => {
        if (!hunk || typeof hunk !== 'object') return [];
        const h = hunk as Record<string, unknown>;
        const lines = Array.isArray(h.lines)
          ? h.lines.flatMap((line) => {
              if (!line || typeof line !== 'object') return [];
              const l = line as Record<string, unknown>;
              if (typeof l.text !== 'string' || typeof l.type !== 'string') return [];
              const type: ToolChangeDiffLineType = l.type === 'add' || l.type === 'del' ? l.type : 'ctx';
              return [{ type, text: l.text }];
            })
          : [];
        return [{
          oldStart: typeof h.oldStart === 'number' ? h.oldStart : 1,
          newStart: typeof h.newStart === 'number' ? h.newStart : 1,
          lines,
        }];
      })
    : [];
  return {
    added,
    removed,
    truncated: raw.truncated === true,
    hunks,
  };
}

export interface ToolActivityItem {
  key: string;
  toolJobId?: string;
  toolId?: string;
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
  changeDiff?: ToolActivityChangeDiff;
  summary?: string;
  actionLabel: string;
  actionDetail?: string;
  output?: ToolActivityOutput;
  /** UI-315 — exec 类工具的完整命令（bounded 400 字符），驱动对话流内
   *  终端块（$ 命令 + 输出）的渲染；历史消息经 meta.toolActivities 恢复。 */
  command?: string;
  /** UI-315 优化 — 实际使用的 shell（powershell/cmd/bash…），头行展示 */
  shellLabel?: string;
  /** BLOCK-59 P4 — agent 管理工具（spawn/wait/list）结果携带的子 agent
   *  任务 id；活动行据此提供「详情窗」入口（弹出 agent 独立窗）。 */
  agentRunId?: string;
  /** UI-437 v5.6 — 工具返回数据本体（后端 publicData 已界定的 bounded 版本）；
   *  活动行展开时渲染「返回」详情。 */
  resultData?: unknown;
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
      toolJobId: typeof raw.toolJobId === 'string' ? raw.toolJobId : undefined,
      toolId: typeof raw.toolId === 'string' ? raw.toolId : undefined,
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
    changeDiff: parseChangeDiff(raw.changeDiff),
    summary: typeof raw.summary === 'string' ? raw.summary : undefined,
    actionLabel: typeof raw.actionLabel === 'string' ? raw.actionLabel : '已调用',
    actionDetail: typeof raw.actionDetail === 'string' ? raw.actionDetail : undefined,
    // UI-315 — 终端块恢复：完整命令 + 流式输出尾部（均为有界形状）
    command: typeof raw.command === 'string' ? raw.command.slice(0, COMMAND_MAX_CHARS) : undefined,
    output: (() => {
      const out = raw.output;
      if (!out || typeof out !== 'object') return undefined;
      const tail = typeof (out as Record<string, unknown>).tail === 'string'
        ? (out as Record<string, unknown>).tail as string
        : '';
      if (!tail) return undefined;
      return {
        tail: tail.slice(0, OUTPUT_TAIL_CHARS),
        truncated: (out as Record<string, unknown>).truncated === true,
      };
    })(),
    shellLabel: typeof raw.shellLabel === 'string' ? raw.shellLabel.slice(0, 24) : undefined,
    agentRunId: typeof raw.agentRunId === 'string' ? raw.agentRunId : undefined,
    // UI-437 v5.6 — 结果数据本体（后端 publicData 已界定的有界形状）随 meta 恢复
    resultData: 'resultData' in raw ? raw.resultData as unknown : undefined,
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

/** UI-315 — exec 类工具名单（对话流内以终端块呈现：$ 命令 + 输出）。 */
export const EXEC_TOOL_NAMES: ReadonlySet<string> = new Set([
  'workspace_exec',
  'workspace_exec_background',
]);

const COMMAND_MAX_CHARS = 400;

function execCommand(name: string, args: Record<string, unknown> = {}): string | undefined {
  if (!EXEC_TOOL_NAMES.has(name)) return undefined;
  const command = typeof args.command === 'string' ? args.command.trim() : '';
  if (!command) return undefined;
  return command.length > COMMAND_MAX_CHARS ? `${command.slice(0, COMMAND_MAX_CHARS)}…` : command;
}

/** Convert tool arguments into a safe, user-facing Codex-style activity line. */
/** UI-437 v5.4 — 未登记工具的参数摘要兜底：key=值 · …（单键截 40 字，最多 3 键）。 */
function summarizeArgsDetail(args: Record<string, unknown> = {}): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    let rendered: string;
    if (typeof value === 'string') {
      rendered = value.replace(/\s+/g, ' ').trim();
    } else if (value == null) {
      rendered = '';
    } else {
      try {
        rendered = JSON.stringify(value).replace(/\s+/g, ' ');
      } catch {
        rendered = String(value);
      }
    }
    if (!rendered) continue;
    parts.push(`${key}=${rendered.slice(0, 40)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(' · ');
}

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
    case 'system_info':
      // BLOCK-33 P1 — 环境自省：只读、无参数
      return { actionLabel: '已查询', actionDetail: '系统环境' };
    default: {
      // UI-437 v5.4（用户反馈「已调用 query 后面都是空白」）——未登记工具用
      // 参数摘要兜底：query（datasets=…）；无参数时回退工具名。
      const detail = summarizeArgsDetail(args);
      return { actionLabel: '已调用', actionDetail: detail ? `${name}（${detail}）` : name };
    }
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
        command: execCommand(event.name, event.args) || current[index].command,
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
      command: execCommand(event.name, event.args),
      ...summarizeToolCall(event.name, event.args),
    },
  ];
}

function inferLegacyStatus(event: ToolResultEvent): ToolActivityStatus {
  return /^错误[:：]/.test(event.summary || '') || Boolean(event.actError)
    ? 'error'
    : 'success';
}

// BLOCK-33 P3 — 活动条内保留的输出尾部上限；更早内容折叠为前导省略号。
const OUTPUT_TAIL_CHARS = 2000;

/**
 * 把 tool_output 增量并入对应工具活动项（按 callId 关联）。
 * 无匹配活动项时挂到最新的同工具 running 项；仍无则忽略（迟到/乱序输出）。
 */
export function mergeToolOutputActivity(
  current: ToolActivityItem[],
  event: ToolOutputEvent
): ToolActivityItem[] {
  if (!event.text) return current;
  const baseKey = event.callId || legacyKey(event.name, event.traceId);
  let index = current.findIndex((item) => item.key === baseKey);
  if (index < 0) {
    for (let i = current.length - 1; i >= 0; i -= 1) {
      if (current[i].name === event.name && current[i].status === 'running') {
        index = i;
        break;
      }
    }
  }
  if (index < 0) return current;
  const existing = current[index];
  const previous = existing.output?.tail || '';
  let tail = previous + event.text;
  if (tail.length > OUTPUT_TAIL_CHARS) {
    tail = `…${tail.slice(-(OUTPUT_TAIL_CHARS - 1))}`;
  }
  const next = current.slice();
  next[index] = {
    ...existing,
    output: {
      tail,
      truncated: Boolean(existing.output?.truncated) || event.truncated === true,
    },
  };
  return next;
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
  // BLOCK-59 P4 — agent 管理工具结果携带 agentId（子 agent 任务 id），
  // 提取供活动行「详情窗」入口；其余工具 / 既有值原样保留。
  const resultData = result?.data as Record<string, unknown> | undefined;
  // UI-315 优化 — exec 结果携带实际使用的 shell 可执行路径，派生短标签
  const resultShellLabel = (() => {
    const shell = resultData && typeof resultData.shell === 'string' ? resultData.shell : '';
    if (!shell) return undefined;
    const base = shell.split(/[\\/|]/).pop() || shell;
    const lower = base.toLowerCase().replace(/\.exe$/, '');
    if (lower === 'cmd') return 'cmd';
    if (lower.startsWith('powershell') || lower === 'pwsh') return 'powershell';
    if (lower === 'wsl') return 'wsl';
    return lower.slice(0, 16);
  })();
  const resultAgentRunId =
    (name === 'spawn_agent' || name === 'wait_agent' || name === 'list_agents') &&
    resultData &&
    typeof resultData.agentId === 'string'
      ? resultData.agentId
      : undefined;
  const item: ToolActivityItem = {
    key: index >= 0 ? current[index].key : key,
    toolJobId: event.toolJobId || (index >= 0 ? current[index].toolJobId : undefined),
    toolId: event.toolId || (index >= 0 ? current[index].toolId : undefined),
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
    changeDiff: parseChangeDiff(result?.changeDiff),
    summary: event.summary,
    // BLOCK-33 P3 — tool_result 合并时保留运行期累积的流式输出尾部
    output: index >= 0 ? current[index].output : undefined,
    // UI-315 优化 — exec 终端块：完整命令 + shell 标签（result 事件 data.shell 派生）
    command: index >= 0 ? current[index].command : undefined,
    shellLabel: (result && result.shellLabel) || resultShellLabel || (index >= 0 ? current[index].shellLabel : undefined),
    actionLabel: index >= 0 ? current[index].actionLabel : fallbackAction.actionLabel,
    actionDetail: index >= 0 ? current[index].actionDetail : fallbackAction.actionDetail,
    agentRunId: resultAgentRunId || (index >= 0 ? current[index].agentRunId : undefined),
    // UI-437 v5.6 — 结果数据本体（后端 publicData 已界定的 bounded 版本），供展开详情
    resultData: index >= 0 ? current[index].resultData : result?.data,
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

/** UI-383 — 常规只读工具：成功时折叠为汇总行（错误/运行中/等待确认仍独立可见）。 */
export const ROUTINE_READ_TOOLS: ReadonlySet<string> = new Set([
  'workspace_read',
  'workspace_list',
  'workspace_find',
  'workspace_search',
  'system_info',
]);

export function isRoutineReadActivity(activity: ToolActivityItem): boolean {
  return ROUTINE_READ_TOOLS.has(activity.name) && activity.status === 'success';
}

export interface ToolActivityGroup {
  kind: 'activity' | 'routine';
  items: ToolActivityItem[];
}

/**
 * UI-383 — 连续的常规只读成功项归并为一组（同迭代内；跨迭代/遇非常规项即断开）。
 * 折叠渲染阈值（≥3 项）由视图层决定。
 */
export function groupToolActivities(activities: ToolActivityItem[]): ToolActivityGroup[] {
  const groups: ToolActivityGroup[] = [];
  let current: ToolActivityGroup | null = null;
  let currentIteration: number | undefined;
  for (const activity of activities) {
    const routine = isRoutineReadActivity(activity);
    const iterChanged = activity.iteration !== currentIteration;
    if (routine && current && current.kind === 'routine' && !iterChanged) {
      current.items.push(activity);
      continue;
    }
    currentIteration = activity.iteration;
    current = { kind: routine ? 'routine' : 'activity', items: [activity] };
    groups.push(current);
  }
  return groups;
}
