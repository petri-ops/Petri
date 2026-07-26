import { getApiPrefix, getToken } from '@/lib/authClient';
import type {
  ArtifactInteractionManifest,
  ArtifactSelection,
  SelectionFilterExpression,
  SelectionSortSpec,
} from '@/lib/artifact-selection';
import { fromPersistedSelection, toPersistPayload } from '@/lib/artifact-selection';

export interface ResultTableColumn {
  field: string;
  type: 'number' | 'string';
  sortable: boolean;
  filterable: boolean;
}

export interface ResultTableQuery {
  tableQueryVersion: 1;
  columns: ResultTableColumn[];
  rows: Array<Record<string, string>>;
  totalRows: number;
  matchedCount: number;
  offset: number;
  nextOffset: number | null;
  limit: number;
  virtualized: boolean;
  filterExpression: SelectionFilterExpression;
  sort: SelectionSortSpec[];
  filterHash: string;
  selectionEvidence: {
    idField: string | null;
    entityIdsHash: string | null;
    sampleEntityIds: string[];
    entityIdCount: number;
  };
}

export interface InteractionResponse {
  manifest: ArtifactInteractionManifest;
  revision?: Record<string, unknown> | null;
  backingTable?: ResultTableQuery | null;
}

function headers(json = false): HeadersInit {
  const token = getToken();
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
  return data as T;
}

export async function fetchArtifactInteraction(input: {
  language: 'r' | 'python'; jobId: string; artifact: string;
}): Promise<InteractionResponse> {
  const query = new URLSearchParams({ jobId: input.jobId, artifact: input.artifact });
  return parseResponse(await fetch(`${getApiPrefix(input.language)}/result-studio/interaction?${query}`, {
    headers: headers(),
  }));
}

export async function queryResultStudioTable(input: {
  language: 'r' | 'python'; jobId: string; artifact: string;
  filterExpression?: SelectionFilterExpression | null;
  sort?: SelectionSortSpec[]; offset?: number; limit?: number;
}): Promise<ResultTableQuery> {
  return parseResponse(await fetch(`${getApiPrefix(input.language)}/result-studio/table/query`, {
    method: 'POST', headers: headers(true), body: JSON.stringify(input),
  }));
}

export async function saveResultStudioSelection(input: {
  language: 'r' | 'python'; selection: ArtifactSelection; selectionId: string;
  projectId: string; conversationId?: string | null;
}): Promise<ArtifactSelection> {
  const data = await parseResponse<{ selection: Record<string, unknown> }>(await fetch(
    `${getApiPrefix(input.language)}/result-studio/selection`, {
      method: 'POST', headers: headers(true),
      body: JSON.stringify(toPersistPayload(input.selection, input)),
    },
  ));
  return fromPersistedSelection(data.selection) as ArtifactSelection;
}

export async function restoreResultStudioSelection(input: {
  language: 'r' | 'python'; projectId: string; conversationId?: string | null;
  artifactId: string; revisionId?: string | null; selectionDurable: boolean;
}): Promise<ArtifactSelection | null> {
  const query = new URLSearchParams({
    projectId: input.projectId,
    artifactId: input.artifactId,
    selectionDurable: String(input.selectionDurable),
  });
  if (input.conversationId) query.set('conversationId', input.conversationId);
  if (input.revisionId) query.set('revisionId', input.revisionId);
  const response = await fetch(`${getApiPrefix(input.language)}/result-studio/selection/current?${query}`, { headers: headers() });
  if (response.status === 404) return null;
  const data = await parseResponse<{
    selection: Record<string, unknown>;
    compatibility: { status: 'compatible' | 'stale' | 'invalid' };
  }>(response);
  const selection = fromPersistedSelection(data.selection);
  if (selection) selection.compatibility = data.compatibility.status;
  return selection;
}

export async function deleteResultStudioSelection(input: {
  language: 'r' | 'python'; selectionId: string;
}): Promise<void> {
  await parseResponse(await fetch(`${getApiPrefix(input.language)}/result-studio/selection/${encodeURIComponent(input.selectionId)}`, {
    method: 'DELETE', headers: headers(),
  }));
}

/**
 * G0-RS-P3 — ResultStudioContextEnvelope 的前端有界投影。
 *
 * 前端不自己拼装这些坐标：envelope 由后端从 SQLite / tool_jobs / 插件
 * descriptor 重新解析，前端只提供"用户打开了哪个 Job 的哪个文件"这一线索。
 * contextToken 是不透明字符串，前端不解析、不推导，只在 Composer 里透传。
 */
export interface ResultStudioContextAgentView {
  contextVersion: 1;
  contextToken: string | null;
  artifact: {
    name: string | null;
    kind: string | null;
    entityType: string | null;
    interactionMode: string | null;
  };
  tool: string | null;
  revisionOrdinal: number | null;
  isCurrent: boolean;
  validation: { artifactTruthStatus: string | null; revisionValidationStatus: string | null };
  reproducibility: { status: string | null; scriptAvailable: boolean };
  selection: {
    entityType: string | null;
    entityIdCount: number;
    truncated: boolean;
    sampleEntityIds: string[];
    hasFilter: boolean;
    filterDescription: string | null;
  } | null;
  selectionState: {
    present: boolean;
    compatibility: 'compatible' | 'stale' | 'invalid' | null;
    reason: string | null;
    usableByAgent: boolean;
  };
  editableParameters: Array<{ name: string; type: string | null; impact: string | null }>;
  actions: string[];
  workflow: { available: boolean; nodeId: string | null; stepCount: number | null; downstreamNodeIds: string[] };
  publicPhases: string[];
}

export interface ResultStudioContextDiagnostic {
  code: string;
  message: string;
}

export interface ResultStudioContextResult {
  status: 'ready' | 'blocked';
  agentView: ResultStudioContextAgentView | null;
  diagnostics: ResultStudioContextDiagnostic[];
}

/**
 * 读取当前结果的上下文投影。
 *
 * 后端在缺少正式 Revision、归因只能到 Job 或跨项目时返回 409 与可行动诊断；
 * 这里把它归一化成 `blocked`，让 UI 如实显示原因而不是静默退化。
 */
export async function fetchResultStudioContext(input: {
  language: 'r' | 'python';
  projectId: string;
  conversationId?: string | null;
  jobId?: string | null;
  artifact?: string | null;
  revisionId?: string | null;
}): Promise<ResultStudioContextResult> {
  const query = new URLSearchParams({ projectId: input.projectId });
  if (input.conversationId) query.set('conversationId', input.conversationId);
  if (input.jobId) query.set('jobId', input.jobId);
  if (input.artifact) query.set('artifact', input.artifact);
  if (input.revisionId) query.set('revisionId', input.revisionId);
  const response = await fetch(
    `${getApiPrefix(input.language)}/result-studio/context-envelope?${query}`,
    { headers: headers() },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const diagnostics = Array.isArray(data?.diagnostics) && data.diagnostics.length > 0
      ? (data.diagnostics as ResultStudioContextDiagnostic[])
      : [{ code: String(data?.error || 'context_unavailable'), message: String(data?.message || '无法读取当前结果上下文。') }];
    return { status: 'blocked', agentView: null, diagnostics };
  }
  return {
    status: 'ready',
    agentView: (data.agentView as ResultStudioContextAgentView) || null,
    diagnostics: [],
  };
}
