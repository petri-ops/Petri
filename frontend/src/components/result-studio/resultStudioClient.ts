import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

export type ChangeSetStatus =
  | 'draft'
  | 'running'
  | 'preview_ready'
  | 'validation_failed'
  | 'adopted'
  | 'reverted'
  | 'abandoned';

export interface ResultStudioChangeSet {
  changeSetId: string;
  projectId: string;
  intentRef?: string | null;
  status: ChangeSetStatus;
  statusReason?: string | null;
  candidateCommit?: string | null;
  workingBranchRef: string;
  changedPaths: Array<{ relativePath: string; changeType: string; beforeHash?: string | null; afterHash?: string | null }>;
  validationSummary?: Record<string, unknown> | null;
  createdBy: 'user' | 'agent';
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRevision {
  revisionId: string;
  projectId: string;
  artifactFamilyId: string;
  artifactId: string;
  parentRevisionIds: string[];
  sourceCommit?: string | null;
  toolJobId?: string | null;
  outputPath: string;
  outputHash?: string | null;
  validationStatus: 'valid' | 'degraded' | 'blocked';
  reproducibilityStatus: 'unavailable' | 'available' | 'verified';
  changeSetId: string;
  revisionOrdinal: number;
  isCurrent: boolean;
  createdAt: string;
}

export interface ResultStudioComparison {
  changeSet: ResultStudioChangeSet;
  summary: {
    status: ChangeSetStatus;
    createdBy: 'user' | 'agent';
    changedFileCount: number;
    additions: number;
    deletions: number;
    candidateRevisionCount: number;
    validationStatus: 'valid' | 'degraded' | 'blocked';
  };
  textDiff: { patch: string; truncated: boolean; additions: number; deletions: number };
  jsonDiffs: Array<{
    relativePath: string;
    status: 'available' | 'unavailable';
    reason?: string;
    changes: Array<{ field: string; changeType: 'added' | 'removed' | 'changed'; before: unknown; after: unknown }>;
    truncated: boolean;
  }>;
  artifacts: Array<{
    artifactId: string;
    artifactFamilyId: string;
    kind: 'table' | 'visual' | 'binary';
    beforeRevisionId: string | null;
    afterRevisionId: string;
    beforeHash: string | null;
    afterHash: string | null;
    validationStatus: string;
    table?: {
      status: string;
      before?: { columns: string[]; rowCount: number; rowCountIsLowerBound: boolean; bytes: number };
      after?: { columns: string[]; rowCount: number; rowCountIsLowerBound: boolean; bytes: number };
      addedColumns?: string[];
      removedColumns?: string[];
      sampleChanges?: Array<{ row: number; before: unknown; after: unknown }>;
      truncated?: boolean;
    } | null;
  }>;
  histories: Array<{ artifactFamilyId: string; revisions: ArtifactRevision[]; currentRevisionId: string | null }>;
  git: { baseCommit: string; candidateCommit: string | null; workingBranchRef: string };
}

interface ChangeSetListResponse {
  changeSets: ResultStudioChangeSet[];
  currentRevision: ArtifactRevision | null;
  revisions: ArtifactRevision[];
}

export interface ResultStudioWorkspaceStatus {
  lifecycle: {
    status: 'ready' | 'recovery_available' | 'blocked';
    interrupted: Array<{ changeSetId: string; status: ChangeSetStatus; recovery: string; revisionIds: string[] }>;
    checkpoint: { checkpointId: string; changeSetId?: string | null; pendingPreview?: { stage?: string; recovery?: string } | null } | null;
    revisionIntegrity: { revisionCount: number; intact: boolean; issues: Array<{ revisionId: string; kind: string }> };
  };
  storage: {
    revisionCount: number;
    logicalArtifactBytes: number;
    uniqueArtifactBytes: number;
    deduplicableBytes: number;
    duplicateGroupCount: number;
    privateStorage: { bytes: number; files: number; truncated: boolean };
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const response = await fetch(`${getPlatformApiPrefix()}/result-studio${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Result Studio request failed (${response.status})`);
  return data as T;
}

export function listResultChangeSets(projectId: string, artifactFamilyId: string): Promise<ChangeSetListResponse> {
  return requestJson(`/changesets?projectId=${encodeURIComponent(projectId)}&artifactFamilyId=${encodeURIComponent(artifactFamilyId)}`);
}

export function compareResultChangeSet(changeSetId: string): Promise<ResultStudioComparison> {
  return requestJson(`/changesets/${encodeURIComponent(changeSetId)}/compare`);
}

export function getResultStudioWorkspaceStatus(projectId: string): Promise<ResultStudioWorkspaceStatus> {
  return requestJson(`/workspace/status?projectId=${encodeURIComponent(projectId)}`);
}

export function recoverResultStudioWorkspace(projectId: string): Promise<{ ok: boolean; recovered: boolean; repaired: unknown[]; after: ResultStudioWorkspaceStatus['lifecycle'] }> {
  return requestJson('/workspace/recover', { method: 'POST', body: JSON.stringify({ projectId }) });
}

export interface ResultStudioTablePage {
  columns: string[];
  rows: string[][];
  cursor: number;
  nextCursor: number | null;
  limit: number;
  totalRows: null;
  totalRowsIsUnknown: true;
  virtualized: boolean;
  caveat: string;
}

export function readRevisionTablePage(revisionId: string, cursor = 0, limit = 100): Promise<ResultStudioTablePage> {
  return requestJson(`/revisions/${encodeURIComponent(revisionId)}/table-page?cursor=${cursor}&limit=${limit}`);
}

export function adoptResultChangeSet(changeSetId: string): Promise<{ ok: true; changeSet: ResultStudioChangeSet; currentRevisions: ArtifactRevision[] }> {
  return requestJson(`/changesets/${encodeURIComponent(changeSetId)}/adopt`, { method: 'POST', body: '{}' });
}

export function revertResultChangeSet(changeSetId: string): Promise<{ ok: true; changeSet: ResultStudioChangeSet; restoredRevisionIds: string[] }> {
  return requestJson(`/changesets/${encodeURIComponent(changeSetId)}/revert`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'user_reverted' }),
  });
}

export function restoreArtifactRevision(revisionId: string): Promise<{ ok: true; revision: ArtifactRevision; changeSet: ResultStudioChangeSet }> {
  return requestJson(`/revisions/${encodeURIComponent(revisionId)}/restore`, { method: 'POST', body: '{}' });
}

export function revisionArtifactUrl(revisionId: string): string {
  const token = getToken();
  return `${getPlatformApiPrefix()}/result-studio/revisions/${encodeURIComponent(revisionId)}/artifact${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}
