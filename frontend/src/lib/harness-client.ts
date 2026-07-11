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

