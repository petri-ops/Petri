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
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const detail = typeof data.message === 'string' && data.message
      ? data.message
      : typeof data.error === 'string' && data.error ? data.error : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return data as T;
}

export async function fetchArtifactInteraction(input: {
  language: 'r' | 'python'; jobId: string; artifact: string; revisionId?: string | null;
}): Promise<InteractionResponse> {
  const query = new URLSearchParams({ jobId: input.jobId, artifact: input.artifact });
  if (input.revisionId) query.set('revisionId', input.revisionId);
  return parseResponse(await fetch(`${getApiPrefix(input.language)}/result-studio/interaction?${query}`, {
    headers: headers(),
  }));
}

export async function queryResultStudioTable(input: {
  language: 'r' | 'python'; jobId: string; artifact: string;
  filterExpression?: SelectionFilterExpression | null;
  sort?: SelectionSortSpec[]; offset?: number; limit?: number; signal?: AbortSignal;
}): Promise<ResultTableQuery> {
  return parseResponse(await fetch(`${getApiPrefix(input.language)}/result-studio/table/query`, {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify({ ...input, signal: undefined }),
    signal: input.signal,
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
    fields: string[];
    sort: Array<{ field: string; direction: 'asc' | 'desc' }>;
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

/**
 * G0-RS-P4 — Schema 驱动的参数控件。
 *
 * 控件完全由后端从受信插件 descriptor 投影，前端不硬编码任何插件的参数集合，
 * 也不自行推断 impact。`scientificallyNeutral` 只在 presentation 分组为真，
 * UI 只能在为真时声称"不改变科学结论"。
 */
export interface ResultStudioEditControl {
  name: string;
  controlType: 'number' | 'text' | 'select' | 'color' | 'boolean';
  impact: string;
  group: 'presentation' | 'data' | 'scientific' | 'workflow';
  default: unknown;
  required: boolean;
  minimum?: number | null;
  maximum?: number | null;
  options?: string[];
  scientificallyNeutral: boolean;
}

export interface ResultStudioEditControlGroup {
  group: 'presentation' | 'data' | 'scientific' | 'workflow';
  label: string;
  parameterNames: string[];
}

export interface ResultStudioEditControls {
  controlsVersion: 1;
  groups: ResultStudioEditControlGroup[];
  controls: ResultStudioEditControl[];
  diagnostics: ResultStudioContextDiagnostic[];
  /** 该 Job 真实执行过的归一化参数值；不是 descriptor 默认值。 */
  currentValues: Record<string, unknown>;
}

export interface ResultStudioContextResult {
  status: 'ready' | 'blocked';
  agentView: ResultStudioContextAgentView | null;
  editControls: ResultStudioEditControls | null;
  /**
   * BLOCK-139 T2 — ready 时后端 envelope 重投影出的权威 Revision 坐标
   * （envelope.artifact.artifactId + envelope.revision.revisionId，与 agent
   * 上下文同一真相源）。交互 manifest 缺 revisionId（validator fail-closed）
   * 时由调用方以它补锚选择；调用方必须核对 artifactId 一致才可采纳。
   * blocked / 坐标缺失时为 null——前端绝不伪造 revision 身份。
   */
  resolvedRevision: { artifactId: string; revisionId: string } | null;
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
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const diagnosticsRaw = data.diagnostics;
    const diagnostics = Array.isArray(diagnosticsRaw) && diagnosticsRaw.length > 0
      ? (diagnosticsRaw as ResultStudioContextDiagnostic[])
      : [{
          code: typeof data.error === 'string' && data.error ? data.error : 'context_unavailable',
          message: typeof data.message === 'string' && data.message ? data.message : '无法读取当前结果上下文。',
        }];
    return { status: 'blocked', agentView: null, editControls: null, resolvedRevision: null, diagnostics };
  }
  // BLOCK-139 T2：端点同时返回完整 envelope（context.js 直接透出 resolved.envelope）。
  // 这里只取重投影出的 Revision 坐标供交互 manifest 补锚；坐标缺一即不透出。
  const envelope = data.envelope as {
    artifact?: { artifactId?: unknown };
    revision?: { revisionId?: unknown };
  } | null;
  const envelopeArtifactId = typeof envelope?.artifact?.artifactId === 'string'
    ? envelope.artifact.artifactId.trim()
    : '';
  const envelopeRevisionId = typeof envelope?.revision?.revisionId === 'string'
    ? envelope.revision.revisionId.trim()
    : '';
  return {
    status: 'ready',
    agentView: (data.agentView as ResultStudioContextAgentView) || null,
    editControls: (data.editControls as ResultStudioEditControls) || null,
    resolvedRevision: envelopeArtifactId && envelopeRevisionId
      ? { artifactId: envelopeArtifactId, revisionId: envelopeRevisionId }
      : null,
    diagnostics: [],
  };
}
