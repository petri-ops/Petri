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
