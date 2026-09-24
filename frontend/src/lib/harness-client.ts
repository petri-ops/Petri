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
  proposalVersion?: number;
  repairedParams: Record<string, unknown>;
  repairs?: Array<Record<string, unknown>>;
  warnings?: Array<Record<string, unknown>>;
  inputSuggestions?: Array<Record<string, unknown>>;
  audit?: {
    userParams?: Record<string, unknown>;
    changedUserInputs?: string[];
    confirmationRequired?: boolean;
  };
}

export interface HarnessDiagnosticIssue {
  code: string;
  severity?: string; // 后端值域：'error' | 'warning'
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

export interface HarnessNextAction {
  id: string;
  label: string;
  reason?: string;
  recommended?: boolean;
}

export interface HarnessRunDiagnostics {
  ok: boolean;
  status: string; // 后端值域：'ready' | 'needs_review' | 'blocked'
  readiness?: string; // 后端值域：'ready' | 'recoverable' | 'blocked'
  toolId?: string | null;
  repairs?: Array<Record<string, unknown>>;
  warnings?: Array<Record<string, unknown>>;
  issues?: HarnessDiagnosticIssue[];
  repairedParams?: Record<string, unknown>;
  inputSuggestions?: Array<Record<string, unknown>>;
  nextActions?: HarnessNextAction[];
}

export interface HarnessRepairRequest {
  scope: 'project' | 'job' | 'artifact' | 'dataset';
  projectId?: string;
  jobId?: string;
  activeArtifactName?: string;
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

export interface HarnessWorkflowStage {
  id: 'inspect' | 'infer' | 'select' | 'repair' | 'confirm' | 'run' | 'verify' | 'report';
  status: 'completed' | 'pending' | 'in_progress' | 'needs_review' | 'blocked' | 'failed' | 'cancelled';
  detail?: string | null;
}

export interface HarnessWorkflowPlan {
  harnessWorkflowVersion: number;
  requestText: string;
  toolId?: string | null;
  readiness: 'ready' | 'recoverable' | 'blocked';
  runnable: boolean;
  confirmationRequired: boolean;
  repair?: HarnessParamRepair | null;
  diagnostics?: HarnessRunDiagnostics | null;
  stages: HarnessWorkflowStage[];
}

export interface HarnessWorkflowPlanRequest extends HarnessRepairRequest {
  requestText: string;
}

export interface HarnessWorkflowPlanResponse {
  ok: boolean;
  scope?: HarnessScopeInfo;
  index?: HarnessIndexSummary;
  plan?: HarnessWorkflowPlan;
  error?: string;
}

export interface HarnessWorkflowJobState {
  harnessWorkflowStateVersion: number;
  jobId?: string | null;
  toolId?: string | null;
  jobStatus: string;
  ackStatus?: string | null;
  terminal: boolean;
  recoverable: boolean;
  resumeFrom?: HarnessWorkflowStage['id'] | null;
  artifactTruth?: Record<string, unknown> | null;
  artifactDiagnostics?: HarnessDiagnosticIssue[];
  artifactCount: number;
  error?: string | null;
  recoveryHistory?: Array<{
    id?: string;
    actionId?: string;
    confirmedAt?: string;
    requestedBy?: string;
    source?: string;
  }>;
  nextActions?: Array<{
    id: string;
    label: string;
    stage: HarnessWorkflowStage['id'];
  }>;
  stages: HarnessWorkflowStage[];
}

export interface HarnessWorkflowStatusResponse {
  ok: boolean;
  workflow?: HarnessWorkflowJobState;
  error?: string;
}

export interface HarnessWorkflowActionResponse {
  ok: boolean;
  needsConfirmation?: boolean;
  confirmationToken?: string;
  expiresAt?: number;
  cancelled?: boolean;
  actionId?: string;
  jobId?: string;
  workflow?: HarnessWorkflowJobState;
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

export async function planHarnessWorkflow(
  input: HarnessWorkflowPlanRequest,
): Promise<HarnessWorkflowPlanResponse> {
  const resp = await fetch(`${getPlatformApiPrefix()}/harness/workflow/plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(input),
  });
  const data = (await resp.json()) as HarnessWorkflowPlanResponse;
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || 'Harness workflow planning failed');
  }
  return data;
}

export async function fetchHarnessWorkflowStatus(jobId: string): Promise<HarnessWorkflowStatusResponse> {
  const resp = await fetch(`${getPlatformApiPrefix()}/harness/workflow/status/${encodeURIComponent(jobId)}`, {
    headers: authHeaders(),
  });
  const data = (await resp.json()) as HarnessWorkflowStatusResponse;
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || 'Harness workflow status failed');
  }
  return data;
}

export async function runHarnessWorkflowAction(input: {
  jobId: string;
  actionId: string;
  confirmationToken?: string;
  confirm?: boolean;
}): Promise<HarnessWorkflowActionResponse> {
  const resp = await fetch(
    `${getPlatformApiPrefix()}/harness/workflow/action/${encodeURIComponent(input.jobId)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({
        actionId: input.actionId,
        ...(input.confirmationToken ? { confirmationToken: input.confirmationToken } : {}),
        ...(input.confirm != null ? { confirm: input.confirm } : {}),
      }),
    },
  );
  const data = (await resp.json()) as HarnessWorkflowActionResponse;
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || 'Harness workflow action failed');
  }
  return data;
}
