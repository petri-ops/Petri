/**
 * frontend/src/lib/loop-client.ts
 * HLE-C4R: typed REST client for the Harness Loop durable API (/api/loop/*).
 *
 * Mirrors the compact projections exposed by core/biof3-server/routes/ai-loop.js.
 * The UI consumes THIS + the live SSE loop events as the single source of loop
 * truth — it must never maintain a second completion state. All completion /
 * recovery decisions come from the backend loopStatus + recovery projection.
 */

import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

// ---------------------------------------------------------------------------
// Types — must match ai-loop.js compact projections
// ---------------------------------------------------------------------------

/** Terminal + in-flight loop statuses as persisted by the backend ledger. */
export type LoopStatus = 'planned' | 'running' | 'waiting_for_user' | 'completed' | 'failed' | 'cancelled' | 'blocked';

/** Controller decision outcomes surfaced per iteration. */
export type LoopDecision = 'continue' | 'retry' | 'block' | 'wait' | 'complete' | 'cancel';

export interface LoopRunCompact {
  loopRunId: string;
  projectId: string;
  conversationId: string;
  taskSpecRef: string | null;
  automationMode: string | null;
  executionIntent: 'task_draft' | 'task_execute' | null;
  loopStatus: LoopStatus;
  hash: string;
  isPartial: boolean;
  partialReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** AGENT-CONCURRENCY: primary vs subagent identity of this LoopRun. */
  kind?: string | null; // 后端值域：'primary' | 'subagent'
  /** Parent primary LoopRun when kind === 'subagent'. */
  parentLoopRunId?: string | null;
  /** Backend task id that drives this LoopRun (used for event-stream resubscription). */
  taskId?: string | null;
}

export interface LoopIterationCompact {
  iterationId: string;
  loopRunId: string;
  sequence: number;
  decision: string; // LoopDecision 字符串形式
  decisionReasonCode: string;
  status: string;
  publicConclusion: string | null;
  hash?: string;
  createdAt: string;
}

/** Expanded run projection (?expanded=1) — adds durable recovery detail. */
export interface LoopRunExpanded extends LoopRunCompact {
  recoveryRequired?: boolean;
  recoveryReason?: string | null;
  abortedByUser?: boolean;
  recentIterations?: LoopIterationCompact[];
  evidenceCount?: number;
}

export interface LoopActionCompact {
  actionId: string;
  loopRunId: string;
  sequence: number;
  actionKey: string;
  actionType: string;
  toolId: string | null;
  attempt: number;
  hash?: string;
  createdAt: string;
}

export interface LoopEvidenceCompact {
  evidenceId: string;
  loopRunId: string;
  iterationId: string | null;
  kind: string;
  ref: string;
  summaryDigest: string | null;
  hash?: string;
  createdAt: string;
}

export interface LoopRecovery {
  loopRunId: string;
  projectId: string;
  conversationId: string;
  loopStatus: LoopStatus;
  automationMode: string | null;
  executionIntent: 'task_draft' | 'task_execute' | null;
  isTerminal: boolean;
  needsRecovery: boolean;
  recoveryRequired: boolean;
  canResume: boolean;
  lastIteration: {
    iterationId: string;
    sequence: number;
    decision: string; // LoopDecision 字符串形式
    decisionReasonCode: string;
    status: string;
    publicConclusion: string | null;
  } | null;
  statusJson: Record<string, unknown>;
  recoveryHint: string;
}

export interface LoopUsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estimatedCostCny: number;
  unknownCostCalls: number;
  failedCalls: number;
  cacheHitRate: number;
  costStatus: 'partial' | 'estimated';
}

export interface LoopSessionSummary {
  run: (LoopRunCompact & {
    recoveryRequired: boolean;
    recoveryReason: string | null;
  }) | null;
  iterations: LoopIterationCompact[];
  activeCount: number;
  backgroundCount: number;
  usage: LoopUsageSummary;
}

// ---------------------------------------------------------------------------
// SSE event shapes — emitted live by agent-runner during a run. These mirror
// the onLoopPhase / onLoopIteration callback payloads in copilotClient.ts so
// the store, client, and UI share one loop vocabulary.
// ---------------------------------------------------------------------------

export interface LoopPhaseEvent {
  phase: string; // started | resumed | cancelled | blocked | completed | running
  loopRunId?: string;
  publicConclusion?: string;
  reason?: string;
  automationMode?: string;
  executionIntent?: 'task_draft' | 'task_execute';
}

export interface LoopIterationEvent {
  loopRunId: string;
  iterationId: string;
  sequence: number;
  decision: string; // LoopDecision 字符串形式
  decisionReasonCode: string;
  publicConclusion: string;
  status: string;
  proposedActionKey: string | null;
  actionKeyHash: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function loopBase(): string {
  return `${getPlatformApiPrefix()}/loop`;
}

async function getJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, { headers: authHeaders() });
  const data = (await resp.json()) as T & { ok?: boolean; error?: string };
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || `loop request failed: HTTP ${resp.status}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** GET /api/loop/runs/:loopRunId — compact by default, expanded when requested. */
export async function fetchLoopRun(
  loopRunId: string,
  opts: { expanded?: boolean } = {}
): Promise<LoopRunExpanded> {
  const suffix = opts.expanded ? '?expanded=1' : '';
  const data = await getJson<{ run: LoopRunExpanded }>(
    `${loopBase()}/runs/${encodeURIComponent(loopRunId)}${suffix}`
  );
  return data.run;
}

/** GET /api/loop/runs?conversationId=&projectId=&limit= */
export async function fetchLoopRuns(input: {
  conversationId?: string;
  projectId?: string;
  limit?: number;
}): Promise<LoopRunCompact[]> {
  const params = new URLSearchParams();
  if (input.conversationId) params.set('conversationId', input.conversationId);
  if (input.projectId) params.set('projectId', input.projectId);
  if (input.limit) params.set('limit', String(input.limit));
  const data = await getJson<{ runs: LoopRunCompact[] }>(`${loopBase()}/runs?${params.toString()}`);
  return data.runs || [];
}

/** GET /api/loop/session-summary — bounded cold-start/reopen projection. */
export async function fetchLoopSessionSummary(input: {
  conversationId: string;
  projectId: string;
}): Promise<LoopSessionSummary> {
  const params = new URLSearchParams({
    conversationId: input.conversationId,
    projectId: input.projectId,
  });
  const data = await getJson<{ summary: LoopSessionSummary }>(
    `${loopBase()}/session-summary?${params.toString()}`
  );
  return data.summary;
}

/** GET /api/loop/iterations/:loopRunId */
export async function fetchLoopIterations(loopRunId: string): Promise<LoopIterationCompact[]> {
  const data = await getJson<{ iterations: LoopIterationCompact[] }>(
    `${loopBase()}/iterations/${encodeURIComponent(loopRunId)}`
  );
  return data.iterations || [];
}

/** GET /api/loop/actions/:loopRunId */
export async function fetchLoopActions(loopRunId: string): Promise<LoopActionCompact[]> {
  const data = await getJson<{ actions: LoopActionCompact[] }>(
    `${loopBase()}/actions/${encodeURIComponent(loopRunId)}`
  );
  return data.actions || [];
}

/** GET /api/loop/evidence/:loopRunId */
export async function fetchLoopEvidence(loopRunId: string): Promise<LoopEvidenceCompact[]> {
  const data = await getJson<{ evidence: LoopEvidenceCompact[] }>(
    `${loopBase()}/evidence/${encodeURIComponent(loopRunId)}`
  );
  return data.evidence || [];
}

/** GET /api/loop/recovery/:loopRunId */
export async function fetchLoopRecovery(loopRunId: string): Promise<LoopRecovery> {
  const data = await getJson<{ recovery: LoopRecovery }>(
    `${loopBase()}/recovery/${encodeURIComponent(loopRunId)}`
  );
  return data.recovery;
}

/** POST /api/loop/runs/:loopRunId/abort — request the loop stop on next pre-turn check. */
export async function abortLoopRun(
  loopRunId: string
): Promise<{ loopRunId: string; aborted: boolean; updatedAt: string }> {
  const resp = await fetch(`${loopBase()}/runs/${encodeURIComponent(loopRunId)}/abort`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  const data = (await resp.json()) as {
    ok?: boolean;
    error?: string;
    loopRunId: string;
    aborted: boolean;
    updatedAt: string;
  };
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || `loop abort failed: HTTP ${resp.status}`);
  }
  return { loopRunId: data.loopRunId, aborted: data.aborted, updatedAt: data.updatedAt };
}

// ---------------------------------------------------------------------------
// Presentation helpers — pure, shared by chat + summary so completion state
// has ONE derivation (never a second source of truth).
// ---------------------------------------------------------------------------

/** A loop is "done successfully" ONLY when the backend says completed. */
export function isLoopComplete(status: string | null | undefined): boolean {
  return status === 'completed';
}

/** failed/blocked/cancelled are terminal-but-not-success; must never show green. */
export function isLoopUnsuccessfulTerminal(status: string | null | undefined): boolean {
  return status === 'failed' || status === 'blocked' || status === 'cancelled';
}

/** Map a loop status to a compact, honest phase label for the chat/summary. */
export function loopStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'planned': return '已规划';
    case 'running': return '执行中';
    case 'completed': return '已完成';
    case 'failed': return '失败';
    case 'blocked': return '已阻断';
    case 'cancelled': return '已取消';
    default: return '未知';
  }
}

// ---------------------------------------------------------------------------
// Loop display derivation — ONE honest mapping from live loop state to a
// compact status chip. Shared by chat + summary so they never disagree, and
// so a blocked / false-success run can NEVER render as a green completion.
// ---------------------------------------------------------------------------

export interface LoopDisplay {
  status: 'running' | 'completed' | 'blocked' | 'cancelled' | 'retrying' | 'idle';
  label: string;
  /** visual tone: success is the ONLY green; blocked is warning, never green. */
  tone: 'running' | 'success' | 'warning' | 'neutral';
  /** number of recorded iterations (attempts) this run. */
  attempts: number;
}

export function deriveLoopDisplay(
  loop:
    | { phase?: string; iterations?: LoopIterationEvent[]; lastDecision?: string }
    | null
    | undefined,
  pending?: boolean
): LoopDisplay {
  const iterations = loop?.iterations || [];
  const attempts = iterations.length;
  const phase = loop?.phase;
  const lastDecision = loop?.lastDecision || iterations[iterations.length - 1]?.decision;

  // A validator block or false-success detection must win over everything —
  // it can never be shown as a green completion.
  const anyBlocked = iterations.some((it) => it.decision === 'block' || it.status === 'blocked');
  if (anyBlocked || phase === 'blocked') {
    return { status: 'blocked', label: '已阻断', tone: 'warning', attempts };
  }
  if (phase === 'cancelled' || lastDecision === 'cancel') {
    return { status: 'cancelled', label: '已取消', tone: 'neutral', attempts };
  }
  if (phase === 'completed' || lastDecision === 'complete') {
    return { status: 'completed', label: '已完成', tone: 'success', attempts };
  }
  if (lastDecision === 'retry') {
    return { status: 'retrying', label: '重试中', tone: 'running', attempts };
  }
  if (pending || phase === 'started' || phase === 'resumed' || phase === 'running') {
    return { status: 'running', label: '执行中', tone: 'running', attempts };
  }
  return { status: 'idle', label: '等待中', tone: 'neutral', attempts };
}

export function loopDecisionLabel(decision: string | null | undefined): string {
  switch (decision) {
    case 'continue': return '继续';
    case 'retry': return '重试';
    case 'block': return '阻断';
    case 'wait': return '等待确认';
    case 'complete': return '完成';
    case 'cancel': return '取消';
    default: return decision || '';
  }
}
