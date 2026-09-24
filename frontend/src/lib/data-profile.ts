import { unknownText } from './unknownText';
import { getApiPrefix, getToken } from '@/lib/authClient';

/** A structural hypothesis produced by the bounded backend profiler. */
export interface DataProfileCandidate {
  candidate: string;
  confidence: number;
  evidence?: Record<string, unknown>;
  basis?: string;
}

export type DataProfileDiagnosticSeverity = string; // 后端值域：'warning' | 'blocked' | 'error' | 'info'

/** A diagnostic may contain bounded, code-specific evidence from the backend. */
export interface DataProfileDiagnostic {
  code: string;
  severity: DataProfileDiagnosticSeverity;
  message: string;
  [key: string]: unknown;
}

export interface DataProfileBound {
  min?: number;
  max?: number;
  observed?: number;
  sampled?: number;
  truncated?: boolean;
}

export interface DataProfileObservation {
  profilerVersion?: string;
  version?: string;
  schemaVersion?: number;
  headers?: string[];
  sample?: {
    rows?: string[][];
    dataRows?: string[][];
    rowCount?: number;
    totalRowCount?: number;
    dataRowCount?: number;
    columnCount?: number;
    bounds?: {
      rows?: DataProfileBound;
      columns?: DataProfileBound;
    };
  };
  sampleRows?: string[][];
  sampleRowCount?: number;
  sampledRowCount?: number;
  totalRowCount?: number;
  rowBounds?: DataProfileBound;
  columnBounds: DataProfileBound;
  sampleBounds?: {
    rows?: DataProfileBound;
    columns?: DataProfileBound;
  };
  fileRoleCandidates: DataProfileCandidate[];
  diagnostics?: DataProfileDiagnostic[];
}

export interface DataProfileSnapshot {
  projectId?: string | null;
  relativePath: string | null;
  size: number | null;
  modifiedAt?: number | null;
  mtime?: number | null;
  mtimeIso?: string | null;
  sha256: string | null;
  hash?: string | null;
  version?: string;
  schemaVersion?: number;
  encoding: string;
  delimiter: string | null;
  [key: string]: unknown;
}

export interface DataProfileResult {
  status: 'ok' | 'blocked';
  blocked: boolean;
  snapshot: DataProfileSnapshot;
  observation: DataProfileObservation;
  diagnostics: DataProfileDiagnostic[];
  diagnosticCodes: string[];
}

export interface ImportedDataFile {
  name: string;
  relativePath: string;
  size: number;
  profile: DataProfileResult;
}

export interface DataProfileRequestResponse<T> {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
  data?: T;
}

export class DataProfileRequestError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'DataProfileRequestError';
    this.status = status;
    this.payload = payload;
  }
}

export interface DataRoleMatch {
  file: ImportedDataFile;
  candidate: DataProfileCandidate;
}

export type DataReadinessIssueSeverity = 'blocked' | 'ambiguous';

export interface DataReadinessIssue {
  code:
  | 'missing_counts_matrix'
  | 'missing_sample_metadata'
  | 'blocked_profile'
  | 'ambiguous_counts_matrix'
  | 'ambiguous_sample_metadata'
  | 'same_file_for_roles'
  | 'sample_identity_unverifiable'
  | 'duplicate_sample_id'
  | 'sample_id_mismatch';
  severity: DataReadinessIssueSeverity;
  role?: 'counts_matrix' | 'sample_metadata';
  relativePaths?: string[];
  message: string;
}

export interface DataReadiness {
  status: 'ready' | 'blocked' | 'ambiguous';
  ready: boolean;
  canStart: boolean;
  countsMatrix: DataRoleMatch | null;
  sampleMetadata: DataRoleMatch | null;
  /** Compatibility projections for simple workspace controls. */
  countsFile: ImportedDataFile | null;
  metadataFile: ImportedDataFile | null;
  reasons: string[];
  roleCandidates: {
    countsMatrix: DataRoleMatch[];
    sampleMetadata: DataRoleMatch[];
  };
  issues: DataReadinessIssue[];
  blocked: boolean;
  ambiguous: boolean;
}

const CONFIDENCE_THRESHOLD = 0.7;
const MAX_PROMPT_FILES = 12;
const MAX_PROMPT_CANDIDATES_PER_FILE = 4;
const MAX_PROMPT_DIMENSION = 100_000;
const MAX_PROMPT_TEXT = 8_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asFiniteNumber(value: unknown, fallback: number | null = null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNonNegativeInteger(value: unknown, fallback: number | null = null): number | null {
  const number = asFiniteNumber(value, fallback);
  return number !== null && Number.isInteger(number) && number >= 0 ? number : fallback;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function isProjectRelativePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  if (normalized.split('/').some((part) => part === '..' || part === '.')) return false;
  return !normalized.includes('\0');
}

function normalizedRelativePath(value: unknown): string | null {
  if (!isProjectRelativePath(value)) return null;
  return value.replace(/\\/g, '/').trim();
}

function normalizeCandidate(value: unknown): DataProfileCandidate | null {
  if (!isRecord(value) || typeof value.candidate !== 'string') return null;
  const confidence = asFiniteNumber(value.confidence);
  if (confidence === null) return null;
  return {
    candidate: value.candidate.slice(0, 160),
    confidence: Math.max(0, Math.min(1, confidence)),
    ...(isRecord(value.evidence) ? { evidence: value.evidence } : {}),
    ...(typeof value.basis === 'string' ? { basis: value.basis.slice(0, 500) } : {}),
  };
}

function normalizeDiagnostic(value: unknown): DataProfileDiagnostic | null {
  if (!isRecord(value) || typeof value.code !== 'string' || typeof value.message !== 'string') return null;
  return {
    ...value,
    code: value.code,
    severity: typeof value.severity === 'string' ? value.severity : 'warning',
    message: value.message,
  };
}

function normalizeRows(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((row) => (
    Array.isArray(row)
      ? row.slice(0, 256).map((cell) => (typeof cell === 'string' ? cell.slice(0, 512) : ''))
      : []
  ));
}

function normalizeProfile(value: unknown): DataProfileResult {
  if (!isRecord(value) || (value.status !== 'ok' && value.status !== 'blocked')) {
    throw new Error('服务器返回了无效的数据画像');
  }
  const rawSnapshot = isRecord(value.snapshot) ? value.snapshot : {};
  const rawObservation = isRecord(value.observation) ? value.observation : {};
  const diagnostics = Array.isArray(value.diagnostics)
    ? value.diagnostics.map(normalizeDiagnostic).filter((item): item is DataProfileDiagnostic => Boolean(item))
    : [];
  const fileRoleCandidates = Array.isArray(rawObservation.fileRoleCandidates)
    ? rawObservation.fileRoleCandidates
      .map(normalizeCandidate)
      .filter((item): item is DataProfileCandidate => Boolean(item))
    : [];
  const relativePath = normalizedRelativePath(rawSnapshot.relativePath);
  if (rawSnapshot.relativePath !== null && rawSnapshot.relativePath !== undefined && !relativePath) {
    throw new Error('服务器返回了无效的项目相对路径');
  }
  const snapshot: DataProfileSnapshot = {
    ...rawSnapshot,
    projectId: typeof rawSnapshot.projectId === 'string' ? rawSnapshot.projectId : null,
    relativePath,
    size: asNonNegativeInteger(rawSnapshot.size),
    modifiedAt: asFiniteNumber(rawSnapshot.modifiedAt),
    sha256: typeof rawSnapshot.sha256 === 'string' ? rawSnapshot.sha256 : null,
    encoding: asString(rawSnapshot.encoding, 'unknown'),
    delimiter: typeof rawSnapshot.delimiter === 'string' ? rawSnapshot.delimiter : null,
  };
  const observation: DataProfileObservation = {
    ...rawObservation,
    headers: Array.isArray(rawObservation.headers)
      ? rawObservation.headers.filter((item): item is string => typeof item === 'string').slice(0, 256)
      : [],
    columnBounds: isRecord(rawObservation.columnBounds) ? rawObservation.columnBounds : {},
    sample: isRecord(rawObservation.sample) ? {
      ...rawObservation.sample,
      rows: normalizeRows(rawObservation.sample.rows),
      dataRows: normalizeRows(rawObservation.sample.dataRows),
      bounds: isRecord(rawObservation.sample.bounds) ? rawObservation.sample.bounds : undefined,
    } : undefined,
    sampleRows: normalizeRows(rawObservation.sampleRows),
    fileRoleCandidates,
    diagnostics: Array.isArray(rawObservation.diagnostics)
      ? rawObservation.diagnostics.map(normalizeDiagnostic).filter((item): item is DataProfileDiagnostic => Boolean(item))
      : [],
  };
  return {
    status: value.status,
    blocked: value.blocked === true || value.status === 'blocked',
    snapshot,
    observation,
    diagnostics,
    diagnosticCodes: Array.isArray(value.diagnosticCodes)
      ? value.diagnosticCodes.filter((item): item is string => typeof item === 'string')
      : diagnostics.map((item) => item.code),
  };
}

function normalizeImportedFile(value: unknown): ImportedDataFile {
  if (!isRecord(value) || typeof value.name !== 'string' || !isProjectRelativePath(value.relativePath)) {
    throw new Error('服务器返回了无效的导入文件路径');
  }
  const profile = normalizeProfile(value.profile);
  return {
    name: value.name.slice(0, 256),
    relativePath: normalizedRelativePath(value.relativePath) || value.relativePath,
    size: asNonNegativeInteger(value.size, profile.snapshot.size || 0) || 0,
    profile,
  };
}

function requestHeaders(json = false): HeadersInit {
  const token = getToken();
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parsePayload(response: Response): Promise<unknown> {
  // Keep the client testable with small fetch doubles while preferring the
  // single-read text path for real Responses (including non-JSON errors).
  const body = typeof response.text === 'function'
    ? await response.text()
    : typeof response.json === 'function'
      ? JSON.stringify(await response.json())
      : '';
  if (!body.trim()) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function payloadError(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim().slice(0, 500);
  if (isRecord(payload)) {
    for (const key of ['error', 'message', 'detail']) {
      if (typeof payload[key] === 'string' && payload[key].trim()) return payload[key].trim().slice(0, 500);
    }
  }
  return `请求失败（HTTP ${status}）`;
}

async function request<T>(url: string, init: RequestInit, extract: (payload: unknown) => T): Promise<T> {
  const response = await fetch(url, init);
  const payload = await parsePayload(response);
  if (!response.ok) throw new DataProfileRequestError(payloadError(payload, response.status), response.status, payload);
  try {
    return extract(payload);
  } catch (error) {
    if (error instanceof DataProfileRequestError) throw error;
    throw new DataProfileRequestError(error instanceof Error ? error.message : '服务器返回了无效响应', response.status, payload);
  }
}

function endpoint(projectId: string, action: 'import' | 'profile'): string {
  const id = projectId.trim();
  if (!id) throw new Error('projectId 不能为空');
  return `${getApiPrefix().replace(/\/$/, '')}/workspaces/${encodeURIComponent(id)}/${action}`;
}

export async function importProjectData(
  projectId: string,
  files: readonly File[] | FileList,
  signal?: AbortSignal,
): Promise<ImportedDataFile[]> {
  const list = Array.from(files || []);
  if (list.length === 0) throw new Error('请选择至少一个数据文件');
  const form = new FormData();
  list.forEach((file) => form.append('files', file, file.name));
  return request(
    endpoint(projectId, 'import'),
    { method: 'POST', headers: requestHeaders(), body: form, signal },
    (payload) => {
      if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.imported)) {
        throw new Error(payloadError(payload, 200));
      }
      return payload.imported.map(normalizeImportedFile);
    },
  );
}

export async function profileProjectData(
  projectId: string,
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<DataProfileResult[]> {
  const normalizedPaths = paths.map((path) => normalizedRelativePath(path)).filter((path): path is string => Boolean(path));
  if (normalizedPaths.length === 0) throw new Error('请提供至少一个项目相对路径');
  return request(
    endpoint(projectId, 'profile'),
    {
      method: 'POST',
      headers: requestHeaders(true),
      body: JSON.stringify({ paths: normalizedPaths }),
      signal,
    },
    (payload) => {
      if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.profiles)) {
        throw new Error(payloadError(payload, 200));
      }
      return payload.profiles.map(normalizeProfile);
    },
  );
}

function profileIsBlocked(profile: DataProfileResult): boolean {
  return profile.status !== 'ok'
    || profile.blocked
    || profile.diagnostics.some((item) => item.severity === 'blocked');
}

function roleMatches(files: readonly ImportedDataFile[], role: 'counts_matrix' | 'sample_metadata'): DataRoleMatch[] {
  const matches: DataRoleMatch[] = [];
  files.forEach((file) => {
    if (profileIsBlocked(file.profile)) return;
    file.profile.observation.fileRoleCandidates
      .filter((candidate) => candidate.candidate === role && Number.isFinite(candidate.confidence)
        && candidate.confidence >= CONFIDENCE_THRESHOLD)
      .forEach((candidate) => matches.push({ file, candidate }));
  });
  return matches.sort((left, right) => {
    const confidenceOrder = right.candidate.confidence - left.candidate.confidence;
    return confidenceOrder || left.file.relativePath.localeCompare(right.file.relativePath);
  });
}

function sourceKey(file: ImportedDataFile): string {
  return normalizedRelativePath(file.relativePath) || file.name;
}

function normalizedSampleIds(values: readonly string[]): { ids: string[]; duplicate: boolean } {
  const ids = values.map((value) => value.trim()).filter(Boolean);
  return { ids, duplicate: new Set(ids).size !== ids.length };
}

function sampleIdentityCheck(counts: ImportedDataFile, metadata: ImportedDataFile): DataReadinessIssue | null {
  const countsObservation = counts.profile.observation;
  const metadataObservation = metadata.profile.observation;
  const countsColumnsTruncated = countsObservation.sample?.bounds?.columns?.truncated
    || countsObservation.sampleBounds?.columns?.truncated;
  const metadataRowsTruncated = metadataObservation.sample?.bounds?.rows?.truncated
    || metadataObservation.sampleBounds?.rows?.truncated;
  const countsIds = normalizedSampleIds((countsObservation.headers || []).slice(1));
  const metadataRows = metadataObservation.sample?.dataRows || [];
  const metadataIds = normalizedSampleIds(metadataRows.map((row) => row[0] || ''));

  if (countsColumnsTruncated || metadataRowsTruncated || countsIds.ids.length === 0 || metadataIds.ids.length === 0) {
    return {
      code: 'sample_identity_unverifiable',
      severity: 'blocked',
      relativePaths: [counts.relativePath, metadata.relativePath],
      message: '当前有界画像无法完整核对两份文件的样本 ID。',
    };
  }
  if (countsIds.duplicate || metadataIds.duplicate) {
    return {
      code: 'duplicate_sample_id',
      severity: 'blocked',
      relativePaths: [counts.relativePath, metadata.relativePath],
      message: '计数矩阵或样本信息中存在重复的样本 ID。',
    };
  }
  const countsSet = new Set(countsIds.ids);
  const metadataSet = new Set(metadataIds.ids);
  const matched = countsSet.size === metadataSet.size
    && [...countsSet].every((sampleId) => metadataSet.has(sampleId));
  if (!matched) {
    return {
      code: 'sample_id_mismatch',
      severity: 'blocked',
      relativePaths: [counts.relativePath, metadata.relativePath],
      message: `样本 ID 不一致：计数矩阵 ${countsSet.size} 个，样本信息 ${metadataSet.size} 个。`,
    };
  }
  return null;
}

/**
 * Derive a fail-closed handoff from structural candidates.  A batch is ready
 * only when each role has exactly one eligible candidate and the two files are
 * distinct.  Confidence never resolves a tie or supplies scientific meaning.
 */
export function deriveDataReadiness(files: readonly ImportedDataFile[]): DataReadiness {
  const countsMatrixCandidates = roleMatches(files, 'counts_matrix');
  const sampleMetadataCandidates = roleMatches(files, 'sample_metadata');
  const issues: DataReadinessIssue[] = [];
  const blockedFiles = files.filter((file) => profileIsBlocked(file.profile));

  if (countsMatrixCandidates.length === 0) {
    issues.push({
      code: 'missing_counts_matrix',
      severity: 'blocked',
      role: 'counts_matrix',
      message: '未找到置信度至少为 0.70 且未被阻断的 counts_matrix 候选。',
    });
  } else if (countsMatrixCandidates.length > 1) {
    issues.push({
      code: 'ambiguous_counts_matrix',
      severity: 'ambiguous',
      role: 'counts_matrix',
      relativePaths: countsMatrixCandidates.map((match) => match.file.relativePath),
      message: '存在多个可行动的 counts_matrix 候选，不能仅按置信度自动选择。',
    });
  }
  if (sampleMetadataCandidates.length === 0) {
    issues.push({
      code: 'missing_sample_metadata',
      severity: 'blocked',
      role: 'sample_metadata',
      message: '未找到置信度至少为 0.70 且未被阻断的 sample_metadata 候选。',
    });
  } else if (sampleMetadataCandidates.length > 1) {
    issues.push({
      code: 'ambiguous_sample_metadata',
      severity: 'ambiguous',
      role: 'sample_metadata',
      relativePaths: sampleMetadataCandidates.map((match) => match.file.relativePath),
      message: '存在多个可行动的 sample_metadata 候选，不能仅按置信度自动选择。',
    });
  }
  if (blockedFiles.length > 0) {
    issues.push({
      code: 'blocked_profile',
      severity: 'blocked',
      relativePaths: blockedFiles.map((file) => file.relativePath),
      message: `有 ${blockedFiles.length} 个导入文件的画像被阻断，已排除其候选。`,
    });
  }

  const countsMatrix = countsMatrixCandidates.length === 1 ? countsMatrixCandidates[0] : null;
  const sampleMetadata = sampleMetadataCandidates.length === 1 ? sampleMetadataCandidates[0] : null;
  if (countsMatrix && sampleMetadata && sourceKey(countsMatrix.file) === sourceKey(sampleMetadata.file)) {
    issues.push({
      code: 'same_file_for_roles',
      severity: 'blocked',
      relativePaths: [countsMatrix.file.relativePath],
      message: 'counts_matrix 与 sample_metadata 候选指向同一个文件，必须分别提供文件。',
    });
  } else if (countsMatrix && sampleMetadata) {
    const identityIssue = sampleIdentityCheck(countsMatrix.file, sampleMetadata.file);
    if (identityIssue) issues.push(identityIssue);
  }

  const blocked = issues.some((issue) => issue.severity === 'blocked');
  const ambiguous = issues.some((issue) => issue.severity === 'ambiguous');
  const ready = !blocked && !ambiguous && countsMatrix !== null && sampleMetadata !== null;
  const reasons = issues.map((issue) => issue.message);
  return {
    status: ready ? 'ready' : blocked ? 'blocked' : 'ambiguous',
    ready,
    canStart: ready,
    countsMatrix,
    sampleMetadata,
    countsFile: countsMatrix?.file || null,
    metadataFile: sampleMetadata?.file || null,
    reasons,
    roleCandidates: {
      countsMatrix: countsMatrixCandidates,
      sampleMetadata: sampleMetadataCandidates,
    },
    issues,
    blocked,
    ambiguous,
  };
}

/** Return the highest-ranked structural role candidate for a file. */
export function primaryFileRole(file: ImportedDataFile): DataProfileCandidate | null {
  const candidates = file.profile.observation.fileRoleCandidates
    .filter((candidate) => Number.isFinite(candidate.confidence))
    .slice()
    .sort((left, right) => right.confidence - left.confidence || left.candidate.localeCompare(right.candidate));
  return candidates[0] || null;
}

/** Return the candidate for a specific structural role, if present. */
export function candidateFor(file: ImportedDataFile, role: string): DataProfileCandidate | null {
  return file.profile.observation.fileRoleCandidates.find((candidate) => candidate.candidate === role) || null;
}

function boundedDimension(value: unknown): string {
  const number = asNonNegativeInteger(value);
  if (number === null) return 'unknown';
  return number > MAX_PROMPT_DIMENSION ? `${MAX_PROMPT_DIMENSION}+` : String(number);
}

function observationDimensions(profile: DataProfileResult): { rows: string; columns: string; sampledRows: string } {
  const observation = profile.observation;
  const sample = observation.sample;
  const rows = sample?.dataRowCount ?? observation.totalRowCount ?? observation.rowBounds?.observed;
  const sampledRows = sample?.rowCount ?? observation.sampleRowCount ?? observation.rowBounds?.sampled;
  const columns = sample?.columnCount ?? observation.columnBounds?.observed;
  return {
    rows: boundedDimension(rows),
    columns: boundedDimension(columns),
    sampledRows: boundedDimension(sampledRows),
  };
}

function promptCandidateLabel(candidate: DataProfileCandidate): string {
  const label = unknownText(candidate.candidate).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80);
  const confidence = Math.max(0, Math.min(1, candidate.confidence));
  return `${label} (${confidence.toFixed(3)})`;
}

function promptFileLine(file: ImportedDataFile, selectedRoles: readonly string[]): string {
  const path = normalizedRelativePath(file.relativePath);
  if (!path) return '';
  const snapshot = file.profile.snapshot;
  const digest = typeof snapshot.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(snapshot.sha256)
    ? snapshot.sha256.toLowerCase() : 'unavailable';
  const dimensions = observationDimensions(file.profile);
  const candidates = file.profile.observation.fileRoleCandidates
    .slice()
    .sort((left, right) => right.confidence - left.confidence || left.candidate.localeCompare(right.candidate))
    .slice(0, MAX_PROMPT_CANDIDATES_PER_FILE)
    .map(promptCandidateLabel)
    .join(', ') || 'none';
  const selected = selectedRoles.length > 0 ? `; selected=${selectedRoles.join(',')}` : '';
  return `- ${path} | sha256=${digest} | dimensions=data rows ${dimensions.rows}, columns ${dimensions.columns}, sampled rows ${dimensions.sampledRows} | candidates=${candidates}${selected}`;
}

/**
 * Create a bounded, structural-only handoff for the current conversation.
 * The optional imported list lets callers retain non-selected diagnostics;
 * no file contents or absolute paths are ever copied into the prompt.
 */
export function buildFirstAnalysisPrompt(
  readiness: DataReadiness,
  imported: readonly ImportedDataFile[] = [
    ...(readiness.countsMatrix ? [readiness.countsMatrix.file] : []),
    ...(readiness.sampleMetadata ? [readiness.sampleMetadata.file] : []),
  ],
): string {
  if (!readiness.ready || !readiness.countsMatrix || !readiness.sampleMetadata) {
    throw new Error('data_not_ready');
  }
  const selectedByPath = new Map<string, string[]>();
  selectedByPath.set(normalizedRelativePath(readiness.countsMatrix.file.relativePath) || readiness.countsMatrix.file.relativePath, ['counts_matrix']);
  selectedByPath.set(normalizedRelativePath(readiness.sampleMetadata.file.relativePath) || readiness.sampleMetadata.file.relativePath, ['sample_metadata']);
  const files = imported
    .filter((file) => Boolean(normalizedRelativePath(file.relativePath)))
    .slice(0, MAX_PROMPT_FILES);
  const lines = files.map((file) => promptFileLine(
    file,
    selectedByPath.get(normalizedRelativePath(file.relativePath) || file.relativePath) || [],
  ))
    .filter(Boolean);
  if (lines.length === 0) throw new Error('data_not_ready');
  const prompt = [
    '请从这批已导入的项目数据开始首个分析。下面仅是 Data Profiler 的有界结构观察，不是科学语义结论：',
    ...lines,
    '请先通过现有 preflight 核对文件、样本匹配和输入契约；不要推断或擅自决定 contrast、control、batch、配对关系、统计单位、归一化方式或 counts/表达量含义。',
    '如果缺少必要科学信息，只询问最少必要确认；确认完成后继续使用现有 confirmation → run_tool → ToolJob → Artifact Truth 链路，不要直连 /api/tools/run，不要在前端执行分析，也不要覆盖原始文件。',
  ].join('\n');
  return prompt.length > MAX_PROMPT_TEXT ? `${prompt.slice(0, MAX_PROMPT_TEXT)}\n[摘要已截断]` : prompt;
}
