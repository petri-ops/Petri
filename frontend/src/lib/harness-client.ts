import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

export interface HarnessIndexColumn {
  name: string;
  likelyType?: string;
  numericRatio?: number;
  missingCount?: number;
}

export interface HarnessIndexEntry {
  relativePath: string;
  kind: string;
  role: string;
  size?: number;
  readable?: boolean;
  table?: {
    headers?: string[];
    columnCount?: number;
    rowSampleCount?: number;
    matrixOrientation?: string;
    hints?: Record<string, unknown>;
    columns?: HarnessIndexColumn[];
  };
  json?: {
    valid?: boolean;
    rootType?: string;
    keys?: string[];
  };
}

export interface HarnessIndexSummary {
  harnessIndexVersion?: number;
  root?: string;
  fileCount: number;
  truncated?: boolean;
  byKind?: Record<string, number>;
  byRole?: Record<string, number>;
  entries?: HarnessIndexEntry[];
  errors?: Array<{ path?: string; error?: string }>;
}

export interface HarnessScopeInfo {
  scope: string;
  id?: string | null;
  target?: string;
  partition?: string;
  exists?: boolean;
}

export interface HarnessIndexResponse {
  ok: boolean;
  scope?: HarnessScopeInfo;
  index?: HarnessIndexSummary;
  error?: string;
}

export interface HarnessIndexRequest {
  scope: 'project' | 'job' | 'artifact' | 'dataset';
  projectId?: string;
  jobId?: string;
  datasetId?: string;
  full?: boolean;
  maxFiles?: number;
}

export interface HarnessToolInput {
  id: string;
  label?: string;
  type?: string;
  required?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  accept?: string;
  hint?: string;
}

export interface HarnessToolManifest {
  id: string;
  title?: string;
  inputs?: HarnessToolInput[];
  inputSchema?: {
    properties?: Record<string, HarnessToolInput>;
  };
}

export interface HarnessParamRepair {
  ok: boolean;
  repairedParams: Record<string, unknown>;
  repairs?: Array<Record<string, unknown>>;
  warnings?: Array<Record<string, unknown>>;
  inputSuggestions?: Array<Record<string, unknown>>;
}

export interface HarnessDiagnosticIssue {
  code: string;
  severity?: 'error' | 'warning' | string;
  recoverable?: boolean;
  inputId?: string | null;
  message?: string;
  detail?: string | null;
  suggestedFix?: string | null;
  failureMode?: {
    code?: string;
    title?: string;
    recoverable?: boolean;
  } | null;
}

export interface HarnessRunDiagnostics {
  ok: boolean;
  status: 'ready' | 'needs_review' | 'blocked' | string;
  toolId?: string | null;
  repairs?: Array<Record<string, unknown>>;
  warnings?: Array<Record<string, unknown>>;
  issues?: HarnessDiagnosticIssue[];
  repairedParams?: Record<string, unknown>;
  inputSuggestions?: Array<Record<string, unknown>>;
}

export interface HarnessRepairRequest {
  scope: 'project' | 'job' | 'artifact' | 'dataset';
  projectId?: string;
  jobId?: string;
  datasetId?: string;
  manifest: HarnessToolManifest;
  params?: Record<string, unknown>;
  maxFiles?: number;
}

export interface HarnessRepairResponse {
  ok: boolean;
  scope?: HarnessScopeInfo;
  index?: HarnessIndexSummary;
  repair?: HarnessParamRepair;
  diagnostics?: HarnessRunDiagnostics | null;
  error?: string;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchHarnessIndex(input: HarnessIndexRequest): Promise<HarnessIndexResponse> {
  const params = new URLSearchParams();
  params.set('scope', input.scope);
  if (input.projectId) params.set('projectId', input.projectId);
  if (input.jobId) params.set('jobId', input.jobId);
  if (input.datasetId) params.set('datasetId', input.datasetId);
  if (input.full) params.set('full', '1');
  if (input.maxFiles) params.set('maxFiles', String(input.maxFiles));

  const resp = await fetch(`${getPlatformApiPrefix()}/harness/index?${params.toString()}`, {
    headers: authHeaders(),
  });
  const data = (await resp.json()) as HarnessIndexResponse;
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || 'Harness index failed');
  }
  return data;
}

export async function fetchHarnessToolManifest(toolId: string): Promise<HarnessToolManifest | null> {
  const resp = await fetch(`${getPlatformApiPrefix()}/tools/manifest`, {
    headers: authHeaders(),
  });
  const data = (await resp.json()) as { ok?: boolean; tools?: HarnessToolManifest[]; error?: string };
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || 'Tool manifest failed');
  }
  return (data.tools || []).find((tool) => tool.id === toolId) || null;
}

export async function repairHarnessParams(input: HarnessRepairRequest): Promise<HarnessRepairResponse> {
  const resp = await fetch(`${getPlatformApiPrefix()}/harness/repair`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(input),
  });
  const data = (await resp.json()) as HarnessRepairResponse;
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || 'Harness repair failed');
  }
  return data;
}
