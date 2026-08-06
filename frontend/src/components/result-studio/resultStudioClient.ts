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
    scientific?: {
      scientificComparisonVersion?: number;
      status: 'available' | 'unavailable';
      kind: string;
      reason?: string;
      thresholds?: { before: { padjCutoff: number; lfcCutoff: number }; after: { padjCutoff: number; lfcCutoff: number } };
      significantGenes?: { before: ScientificCount; after: ScientificCount; membership: ScientificMembership };
      classifications?: { before: ScientificCount; after: ScientificCount; membership: ScientificMembership };
      terms?: { beforeCount: number; afterCount: number; membership: ScientificMembership; topBefore: ScientificTerm[]; topAfter: ScientificTerm[] };
      direction?: { status: 'available' | 'unavailable'; reason?: string };
    } | null;
  }>;
  histories: Array<{ artifactFamilyId: string; revisions: ArtifactRevision[]; currentRevisionId: string | null }>;
  resourceSummary: ResultStudioTaskResourceSummary;
  git: { baseCommit: string; candidateCommit: string | null; workingBranchRef: string };
}

interface ResourceMeasurement<T = number> {
  status: 'measured' | 'partial' | 'unavailable';
  value: T | null;
  unit: string | null;
  reason: string | null;
}

export interface ResultStudioTaskResourceSummary {
  resultStudioResourceSummaryVersion: number;
  scope: 'change_set_candidate_jobs';
  jobs: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    peakConcurrent: ResourceMeasurement;
  };
  cpu: { peakPercent: ResourceMeasurement };
  memory: {
    processPeakRssBytes: ResourceMeasurement;
    minimumSystemAvailableBytes: ResourceMeasurement;
  };
  disk: {
    outputPeakBytes: ResourceMeasurement;
    minimumSystemAvailableBytes: ResourceMeasurement;
  };
  sampling: { status: 'measured'; sampleCount: number }
    | { status: 'partial'; sampleCount: number; reason: string }
    | { status: 'unavailable'; sampleCount: null; reason: string };
  provider: {
    tokens: ResourceMeasurement<{ input: number; output: number }>;
    cache: ResourceMeasurement<{ read: number }>;
    cost: ResourceMeasurement;
  };
}

interface ScientificCount {
  significantCount: number;
  upCount: number;
  downCount: number;
  nonSignificantCount?: number;
}

interface ScientificMembership {
  gainedCount: number;
  lostCount: number;
  retainedCount: number;
  gained: string[];
  lost: string[];
}

interface ScientificTerm {
  rank: number;
  id: string;
  adjustedPValue: number;
}

interface ChangeSetListResponse {
  changeSets: ResultStudioChangeSet[];
  currentRevision: ArtifactRevision | null;
  revisions: ArtifactRevision[];
  nextRevisionOffset?: number | null;
}

interface ResultStudioLifecycleItem {
  status: ChangeSetStatus;
  recovery: string;
  checkpointStage?: string | null;
  preservedRevisionCount?: number;
}

export interface ResultStudioWorkspaceStatus {
  lifecycle: {
    status: 'ready' | 'recovery_available' | 'blocked';
    interrupted: ResultStudioLifecycleItem[];
    activeOperations?: ResultStudioLifecycleItem[];
    pendingDecisions?: ResultStudioLifecycleItem[];
    pendingIssues?: Array<{ kind: string }>;
    checkpoint: {
      changeSetStatus?: ChangeSetStatus | null;
      pendingPreview?: { stage?: string; recovery?: string; revisionCount?: number } | null;
      updatedAt?: string;
    } | null;
    revisionIntegrity: {
      revisionCount: number;
      intact: boolean;
      issues: Array<{ kind: string; blocking?: boolean; recoverable?: boolean }>;
    };
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

export interface RevisionSourceProjection {
  revisionId: string;
  artifactId: string;
  revisionOrdinal: number;
  relativePath: string;
  entryPoint: string;
  language: 'r' | 'python' | string;
  origin: 'canonical_plugin' | 'execution_snapshot' | 'project_materialized' | 'unknown_legacy' | string;
  rendererId: string;
  scope: 'artifact_specific_materialization' | 'job_shared_execution_snapshot' | 'canonical_plugin_shared' | 'unknown_legacy' | string;
  content: string;
  sha256: string;
  openableRelativePath: string | null;
  parameters: { relativePath: string; sha256: string; values: Record<string, unknown> } | null;
  reproduction: {
    status: 'unavailable' | 'available' | 'verified' | string;
    requiresConfirmation: boolean;
    replayable: boolean;
    inputDrift: Array<{ artifactId: string | null; role: string | null; sha256: string | null; status: string }>;
    inputs: Array<{ artifactId: string | null; role: string | null; sha256: string | null; status: string }>;
    runtime: { name: string | null; version: string | null; readiness: boolean | null };
    plugin: { id: string | null; version: string | null; language: string | null; packageConstraints: Record<string, unknown> };
  };
}

export class ResultStudioRequestError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = 'ResultStudioRequestError';
  }
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
  if (!response.ok) throw new ResultStudioRequestError(
    String(data.error || 'result_studio_request_failed'),
    response.status,
    data.message || data.error || `Result Studio request failed (${response.status})`,
  );
  return data as T;
}

export function listResultChangeSets(projectId: string, artifactFamilyId: string, revisionOffset = 0): Promise<ChangeSetListResponse> {
  return requestJson(`/changesets?projectId=${encodeURIComponent(projectId)}&artifactFamilyId=${encodeURIComponent(artifactFamilyId)}&revisionOffset=${revisionOffset}&revisionLimit=100`);
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

export function fetchRevisionSource(
  projectId: string,
  revisionId: string,
  options: { expectSha256?: string | null; signal?: AbortSignal } = {},
): Promise<RevisionSourceProjection> {
  const query = new URLSearchParams({ projectId, ...(options.expectSha256 ? { expectSha256: options.expectSha256 } : {}) });
  return requestJson(`/revisions/${encodeURIComponent(revisionId)}/source?${query.toString()}`, { signal: options.signal });
}

export interface ControlledReplayPreflight {
  ok: true;
  controlledReplayVersion: number;
  status: 'confirmation_required';
  confirmationToken: string;
  expiresAt: number;
  fingerprint: string;
  revision: {
    revisionId: string;
    artifactId: string;
    revisionOrdinal: number;
    sourceSha256: string;
    parametersHash: string;
    inputCount: number;
  };
  execution: {
    toolId: string;
    pluginVersion: string;
    runtime: RevisionSourceProjection['reproduction']['runtime'];
    createsToolJob: true;
    createsCandidateRevision: true;
    adoptsCandidate: false;
    mutatesCurrentRevision: false;
    acceptsWorkflowPlan: false;
    acceptsShell: false;
  };
}

export interface ControlledReplayResult {
  ok: true;
  controlledReplayVersion: number;
  status: 'preview_ready';
  replayFingerprint: string;
  changeSetId: string;
  toolJobId: string;
  revisionId: string;
  parentRevisionId: string;
  adopted: false;
  idempotent: boolean;
}

export function preflightRevisionReplay(input: {
  projectId: string;
  revisionId: string;
  conversationId?: string | null;
  contextToken: string;
  expectedSourceSha256: string;
  expectedParametersHash: string;
}): Promise<ControlledReplayPreflight> {
  return requestJson(`/revisions/${encodeURIComponent(input.revisionId)}/replay`, {
    method: 'POST',
    body: JSON.stringify({ ...input, phase: 'preflight' }),
  });
}

export function confirmRevisionReplay(input: {
  projectId: string;
  revisionId: string;
  conversationId?: string | null;
  contextToken: string;
  confirmationToken: string;
}): Promise<ControlledReplayResult> {
  return requestJson(`/revisions/${encodeURIComponent(input.revisionId)}/replay`, {
    method: 'POST',
    body: JSON.stringify({ ...input, phase: 'confirm' }),
  });
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

export interface RepositoryBindingConsent {
  allowExistingRepository: boolean;
  decisionSource: string;
}

export interface RepositoryBindingStatus {
  ok: boolean;
  projectId: string;
  existingRepositoryDetected: boolean;
  managedRepositoryExists: boolean;
  decisionRequired: boolean;
  existingRepositoryConsent: RepositoryBindingConsent | null;
  binding: { mode: string; status: string; reason: string | null } | null;
}

export interface ExistingRepositoryConsentResult {
  ok: boolean;
  projectId: string;
  bindingStatus: string | null;
  mode: string | null;
  consent: RepositoryBindingConsent | null;
}

/**
 * 读取项目 Git 仓库绑定状态。后端在 `e14a8e6` 已把"是否授权附加到用户自有
 * 仓库"收敛为独立持久 consent truth，生产调用零硬编码 `true`。前端只消费这份
 * 投影，不得用直接 API 调用冒充用户同意。
 */
export function fetchRepositoryBinding(projectId: string): Promise<RepositoryBindingStatus> {
  return requestJson(`/repository-binding?projectId=${encodeURIComponent(projectId)}`);
}

/**
 * 提交对用户自有仓库的显式 opt-in。后端要求 `allowExistingRepository === true`，
 * 否则返回 400 `explicit_existing_repository_consent_required`——绝不在前端伪造
 * 同意。落库 `decisionSource: 'explicit_api'`。
 */
export function submitExistingRepositoryConsent(projectId: string): Promise<ExistingRepositoryConsentResult> {
  return requestJson('/repository-binding/consent', {
    method: 'POST',
    body: JSON.stringify({ projectId, allowExistingRepository: true }),
  });
}
