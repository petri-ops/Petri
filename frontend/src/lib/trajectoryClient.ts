// ============================================================
// trajectoryClient.ts — BLOCK-248（Q3）执行轨迹只读客户端
//
// 只消费后端单源的分类/摘要（helpers/trajectory-events.js）；前端不解释 payload。
// 三种读法：默认最新一页（tail）/ afterSeq 增量 / beforeSeq 往更早。
// ============================================================

import { getApiPrefix } from '@/lib/env';
import { getToken } from '@/lib/authClient';

export type TrajectoryGroup =
  | 'tool'
  | 'text'
  | 'reasoning'
  | 'error'
  | 'compaction'
  | 'user'
  | 'assistant'
  | 'system';

export interface TrajectoryEvent {
  seq: number;
  at: string | null;
  type: string;
  group: TrajectoryGroup;
  summary: string;
  detail?: string;
  status?: string;
  durationMs?: number;
}

interface TrajectoryStats {
  events: number;
  toolCalls: number;
  toolFailures: number;
  errors: number;
  compactions: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  models: string[];
}

interface TrajectoryTask {
  taskId: string;
  status: string | null;
  agentStatus: string | null;
  createdAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

type TrajectoryAvailability = 'available' | 'no_task' | 'no_events';
type TrajectoryMode = 'tail' | 'delta' | 'older';

export interface TrajectoryResponse {
  ok: true;
  availability: TrajectoryAvailability;
  recordedOnly: true;
  mode: TrajectoryMode;
  conversationId: string | null;
  task: TrajectoryTask | null;
  events: TrajectoryEvent[];
  truncated: boolean;
  hasMoreOlder: boolean;
  nextAfterSeq: number;
  oldestSeq: number | null;
  stats: TrajectoryStats | null;
}

export interface FetchTrajectoryInput {
  conversationId?: string | null;
  taskId?: string | null;
  afterSeq?: number;
  beforeSeq?: number;
  limit?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function fetchTrajectory(input: FetchTrajectoryInput): Promise<TrajectoryResponse> {
  const params = new URLSearchParams();
  if (input.conversationId) params.set('conversationId', input.conversationId);
  if (input.taskId) params.set('taskId', input.taskId);
  if (input.afterSeq && input.afterSeq > 0) params.set('afterSeq', String(input.afterSeq));
  if (input.beforeSeq && input.beforeSeq > 0) params.set('beforeSeq', String(input.beforeSeq));
  if (input.limit) params.set('limit', String(input.limit));
  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl(`${getApiPrefix()}/ai/agent/trajectory?${params.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
    signal: input.signal,
  });
  const payload = (await response.json().catch(() => null)) as (TrajectoryResponse & { error?: unknown }) | null;
  if (!response.ok || !payload || payload.ok !== true) {
    const code = payload && typeof payload.error === 'string' ? payload.error : `http_${response.status}`;
    throw new Error(code);
  }
  return payload;
}
