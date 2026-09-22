// ============================================================
// Global Project store — UI-REFACTOR Phase1
// Unified project CRUD + project-scoped tool jobs + datasets.
// All modules import from here instead of module-specific stores.
// ============================================================

import type { Project, ProjectG0Baseline, ToolJob, Dataset, ProjectModality } from './project-types';
import { getPlatformApiPrefix } from './authClient';

const API_BASE = () => getPlatformApiPrefix() + '/data';

// ============================================================
// Auth headers (desktop: fixed token)
// ============================================================
function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer desktop-local',
  };
}

// BLOCK-105 §7 Batch-6 — api() 返回 unknown（出站边界）：调用点按各自 wire 形状收窄。
async function api(path: string, opts?: RequestInit): Promise<unknown> {
  const resp = await fetch(API_BASE() + path, {
    ...opts,
    headers: {
      ...authHeaders(),
      ...(opts?.headers || {}),
    },
  });
  const data = (await resp.json()) as ApiEnvelope;
  if (data.status !== 'ok') throw new Error(((data).error as string) || '请求失败');
  return data;
}

// BLOCK-105 §7 Batch-7 — 各 REST 面 wire 形状（JSON 解析出站边界契约文档；字段按站点定型，
// 运行时防御与抛错语义保持原样——字段缺失时的抛错路径不变）。
type ApiEnvelope = { status?: unknown; error?: unknown; [key: string]: unknown };
type SshEnvelope = { ok?: unknown; error?: unknown; retryable?: unknown; home?: unknown; path?: unknown; dirs?: Array<{ name: string; path: string }>; sample?: unknown; targets?: unknown };
type JobsEnvelope = { ok?: unknown; error?: unknown; jobs?: Array<Record<string, unknown>> | null };

// ============================================================
// Projects CRUD
// ============================================================

export async function listProjects(
  modality?: ProjectModality,
  status: 'active' | 'archived' = 'active'
): Promise<Project[]> {
  const params = new URLSearchParams();
  if (modality) params.set('modality', modality);
  if (status === 'archived') params.set('status', status);
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  const data = (await api(`/projects${qs}`)) as { projects?: Array<Record<string, unknown>> | null };
  return (data.projects || []).map(mapProject);
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    const data = (await api(`/projects/${id}`)) as { project?: Record<string, unknown> };
    return mapProject(data.project as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function createProject(input: {
  name: string;
  description?: string;
  modality?: ProjectModality;
  workspacePath?: string;
  workspaceKind?: 'local' | 'ssh';
  sshHost?: string;
  remotePath?: string;
}): Promise<Project> {
  const data = (await api('/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  })) as { project?: Record<string, unknown> };
  return mapProject(data.project as Record<string, unknown>);
}

export async function updateProject(
  id: string,
  patch: { name?: string; description?: string; workspacePath?: string }
): Promise<Project | null> {
  try {
    const data = (await api(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(patch) })) as { project?: Record<string, unknown> };
    return mapProject(data.project as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function deleteProject(id: string): Promise<void> {
  await api(`/projects/${id}`, { method: 'DELETE' });
}

// ============================================================
// BLOCK-67 — SSH 远程项目（创建支持面）
// ============================================================

export interface SshTargetCandidate {
  alias: string;
  label: string;
  registered: boolean;
  status?: string;
}

export async function listSshTargetCandidates(): Promise<SshTargetCandidate[]> {
  const resp = await fetch(getPlatformApiPrefix() + '/ssh-projects/targets', {
    headers: authHeaders(),
  });
  const data = (await resp.json()) as SshEnvelope;
  if (!data.ok) throw new Error((data.error as string) || '请求失败');
  return (data.targets || []) as SshTargetCandidate[];
}

export interface SshValidateResult {
  ok: boolean;
  error?: string;
  retryable?: boolean;
  sampleCount?: number;
}

// UI-327 向导 —— 先连接、后浏览选路径
export async function connectSshHost(alias: string): Promise<{ ok: boolean; home?: string; error?: string; retryable?: boolean }> {
  const resp = await fetch(getPlatformApiPrefix() + '/ssh-projects/connect', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ alias }),
  });
  const data = (await resp.json()) as SshEnvelope;
  if (!data.ok) return { ok: false, error: (data.error as string) || '连接失败', retryable: data.retryable as boolean | undefined };
  return { ok: true, home: data.home as string | undefined };
}

export async function listSshRemoteDirs(alias: string, path: string): Promise<{ ok: boolean; path?: string; dirs?: Array<{ name: string; path: string }>; error?: string; retryable?: boolean }> {
  const resp = await fetch(getPlatformApiPrefix() + '/ssh-projects/list', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ alias, path }),
  });
  const data = (await resp.json()) as SshEnvelope;
  if (!data.ok) return { ok: false, error: (data.error as string) || '浏览失败', retryable: data.retryable as boolean | undefined };
  return { ok: true, path: data.path as string | undefined, dirs: data.dirs };
}

/** 创建前校验：远程路径存在且为目录（含 agent 引导部署）；fail-closed。 */
export async function validateSshProject(input: { alias: string; remotePath: string }): Promise<SshValidateResult> {
  const resp = await fetch(getPlatformApiPrefix() + '/ssh-projects/validate', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  const data = (await resp.json()) as SshEnvelope;
  if (!data.ok) return { ok: false, error: (data.error as string) || '校验失败', retryable: data.retryable as boolean | undefined };
  return { ok: true, sampleCount: (Array.isArray(data.sample) ? data.sample : []).length };
}

export async function setProjectStatus(
  id: string,
  status: 'active' | 'archived'
): Promise<Project | null> {
  try {
    const data = (await api(`/projects/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    })) as { project?: Record<string, unknown> };
    return mapProject(data.project as Record<string, unknown>);
  } catch {
    return null;
  }
}

// ============================================================
// Project-scoped Tool Jobs
// ============================================================

export async function listProjectJobs(projectId: string, conversationId?: string): Promise<ToolJob[]> {
  const query = conversationId === undefined
    ? ''
    : `?${new URLSearchParams({ conversationId }).toString()}`;
  const data = (await api(`/projects/${projectId}/jobs${query}`)) as { jobs?: Array<Record<string, unknown>> | null };
  return (data.jobs || []).map(mapToolJob);
}

export async function listAllJobs(): Promise<ToolJob[]> {
  // Uses /api/tools/history (not /data router)
  const resp = await fetch(getPlatformApiPrefix() + '/tools/history', {
    headers: authHeaders(),
  });
  const data = (await resp.json()) as JobsEnvelope;
  if (!data.ok) throw new Error((data.error as string) || '请求失败');
  return (data.jobs || []).map(mapToolJob);
}

// ============================================================
// Datasets (project-scoped)
// ============================================================

export async function listDatasetsByProject(projectId: string): Promise<Dataset[]> {
  const data = (await api(`/projects/${projectId}/datasets`)) as { datasets?: Array<Record<string, unknown>> | null };
  return (data.datasets || []).map(mapDataset);
}

export async function createDataset(input: {
  projectId: string;
  name: string;
  ossUrl: string;
  size: number;
  description?: string;
  sourceDatasetIds?: string[];
}): Promise<Dataset> {
  const data = (await api('/datasets', { method: 'POST', body: JSON.stringify(input) })) as { dataset?: Record<string, unknown> };
  return mapDataset(data.dataset as Record<string, unknown>);
}

export async function deleteDataset(id: string): Promise<void> {
  await api(`/datasets/${id}`, { method: 'DELETE' });
}

// ============================================================
// Mappers (snake_case → camelCase)
// ============================================================

function mapProject(p: Record<string, unknown>): Project {
  const baseline = p.g0_baseline && typeof p.g0_baseline === 'object'
    ? p.g0_baseline as Record<string, unknown>
    : null;
  return {
    id: String(p.id),
    name: String((p.name as string) || ''),
    description: p.description ? String((p.description)) : undefined,
    createdAt: String((p.created_at as string) || ''),
    updatedAt: String((p.updated_at as string) || ''),
    modality: p.modality ? String((p.modality)) : undefined,
    workspacePath: p.workspace_path ? String((p.workspace_path)) : undefined,
    workspaceKind: p.workspace_kind === 'ssh' ? 'ssh' : 'local',
    sshHost: p.ssh_host ? String((p.ssh_host)) : undefined,
    remotePath: p.remote_path ? String((p.remote_path)) : undefined,
    status: p.status === 'archived' ? 'archived' : 'active',
    g0Baseline: baseline ? mapProjectG0Baseline(baseline) : undefined,
  };
}

function mapProjectG0Baseline(value: Record<string, unknown>): ProjectG0Baseline {
  const compatibilityStatus = value.compatibilityStatus;
  return {
    recordVersion: Number(value.recordVersion || 1),
    createdBaselineId: String((value.createdBaselineId || 'legacy-unversioned')),
    createdBaselineVersion: value.createdBaselineVersion ? String((value.createdBaselineVersion)) : null,
    createdManifestDigest: value.createdManifestDigest ? String((value.createdManifestDigest)) : null,
    createdBundleDigest: value.createdBundleDigest ? String((value.createdBundleDigest)) : null,
    openedBaselineId: String((value.openedBaselineId || '')),
    openedBaselineVersion: String((value.openedBaselineVersion || '')),
    openedManifestDigest: String((value.openedManifestDigest || '')),
    openedBundleDigest: String((value.openedBundleDigest || '')),
    compatibilityStatus:
      compatibilityStatus === 'blocked' || compatibilityStatus === 'migration_required'
        ? compatibilityStatus
        : 'compatible',
    compatibilityReason: String((value.compatibilityReason || '')),
    executionAllowed: value.executionAllowed === true,
    migrationRequired: value.migrationRequired === true,
    firstRecordedAt: value.firstRecordedAt ? String((value.firstRecordedAt)) : null,
    lastOpenedAt: value.lastOpenedAt ? String((value.lastOpenedAt)) : null,
  };
}

function mapToolJob(j: Record<string, unknown>): ToolJob {
  const conversationId = Object.prototype.hasOwnProperty.call(j, 'conversationId')
    ? j.conversationId
    : j.conversation_id;
  return {
    id: String(j.id),
    tool_id: String((j.tool_id as string) || ''),
    status: normalizeToolJobStatus(j.status),
    created_at: Number(j.created_at || 0),
    completed_at: j.completed_at ? Number(j.completed_at) : undefined,
    error: j.error ? String((j.error)) : undefined,
    name: j.name ? String((j.name)) : undefined,
    project_id: j.project_id ? String((j.project_id)) : null,
    conversationId: conversationId == null ? null : String((conversationId)),
    // BLOCK-64 P1-a：后端 history SELECT 显式返回该列，此前 mapper 漏映射
    // → 指挥中心/结果库「远程」徽章生产环境永不渲染（测试手工注入掩盖断链）。
    execution_target_id: j.execution_target_id != null ? String((j.execution_target_id)) : null,
  };
}

function normalizeToolJobStatus(status: unknown): ToolJob['status'] {
  if (status === 'completed' || status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  if (status === 'cancelled') return 'cancelled';
  return 'pending';
}

function mapDataset(d: Record<string, unknown>): Dataset {
  return {
    id: String(d.id),
    projectId: String((d.project_id as string) || ''),
    name: String((d.name as string) || ''),
    ossUrl: String((d.oss_url as string) || ''),
    size: Number(d.size || 0),
    uploadedAt: String((d.uploaded_at as string) || ''),
    description: d.description ? String((d.description)) : undefined,
    nCells: d.n_cells ? Number(d.n_cells) : undefined,
    nGenes: d.n_genes ? Number(d.n_genes) : undefined,
    metaUrl: d.meta_url ? String((d.meta_url)) : undefined,
    featuresUrl: d.features_url ? String((d.features_url)) : undefined,
    parentDatasetId: d.parent_dataset_id ? String((d.parent_dataset_id)) : undefined,
    sourceDatasetIds: parseSourceDatasetIds(d.source_dataset_ids),
  };
}

function parseSourceDatasetIds(raw: unknown): string[] | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item)).filter((item) => item.length > 0);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter((item) => item.length > 0);
      }
    } catch {
      // Not JSON — fall through.
    }
  }
  return undefined;
}
