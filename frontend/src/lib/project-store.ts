// ============================================================
// Global Project store — UI-REFACTOR Phase1
// Unified project CRUD + project-scoped tool jobs + datasets.
// All modules import from here instead of module-specific stores.
// ============================================================

import type { Project, ToolJob, Dataset, ProjectModality } from './project-types';
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

async function api(path: string, opts?: RequestInit): Promise<any> {
  const resp = await fetch(API_BASE() + path, {
    ...opts,
    headers: {
      ...authHeaders(),
      ...(opts?.headers || {}),
    },
  });
  const data = await resp.json();
  if (data.status !== 'ok') throw new Error(data.error || '请求失败');
  return data;
}

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
  const data = await api(`/projects${qs}`);
  return (data.projects || []).map(mapProject);
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    const data = await api(`/projects/${id}`);
    return mapProject(data.project);
  } catch {
    return null;
  }
}

export async function createProject(input: {
  name: string;
  description?: string;
  modality?: ProjectModality;
  workspacePath?: string;
}): Promise<Project> {
  const data = await api('/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return mapProject(data.project);
}

export async function updateProject(
  id: string,
  patch: { name?: string; description?: string; workspacePath?: string }
): Promise<Project | null> {
  try {
    const data = await api(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    return mapProject(data.project);
  } catch {
    return null;
  }
}

export async function deleteProject(id: string): Promise<void> {
  await api(`/projects/${id}`, { method: 'DELETE' });
}

export async function setProjectStatus(
  id: string,
  status: 'active' | 'archived'
): Promise<Project | null> {
  try {
    const data = await api(`/projects/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    return mapProject(data.project);
  } catch {
    return null;
  }
}

// ============================================================
// Project-scoped Tool Jobs
// ============================================================

export async function listProjectJobs(projectId: string): Promise<ToolJob[]> {
  const data = await api(`/projects/${projectId}/jobs`);
  return (data.jobs || []).map(mapToolJob);
}

export async function listAllJobs(): Promise<ToolJob[]> {
  // Uses /api/tools/history (not /data router)
  const resp = await fetch(getPlatformApiPrefix() + '/tools/history', {
    headers: authHeaders(),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(data.error || '请求失败');
  return (data.jobs || []).map(mapToolJob);
}

// ============================================================
// Datasets (project-scoped)
// ============================================================

export async function listDatasetsByProject(projectId: string): Promise<Dataset[]> {
  const data = await api(`/projects/${projectId}/datasets`);
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
  const data = await api('/datasets', { method: 'POST', body: JSON.stringify(input) });
  return mapDataset(data.dataset);
}

export async function deleteDataset(id: string): Promise<void> {
  await api(`/datasets/${id}`, { method: 'DELETE' });
}

// ============================================================
// Mappers (snake_case → camelCase)
// ============================================================

function mapProject(p: Record<string, unknown>): Project {
  return {
    id: String(p.id),
    name: String(p.name || ''),
    description: p.description ? String(p.description) : undefined,
    createdAt: String(p.created_at || ''),
    updatedAt: String(p.updated_at || ''),
    modality: p.modality ? String(p.modality) : undefined,
    workspacePath: p.workspace_path ? String(p.workspace_path) : undefined,
    status: p.status === 'archived' ? 'archived' : 'active',
  };
}

function mapToolJob(j: Record<string, unknown>): ToolJob {
  return {
    id: String(j.id),
    tool_id: String(j.tool_id || ''),
    status: normalizeToolJobStatus(j.status),
    created_at: Number(j.created_at || 0),
    completed_at: j.completed_at ? Number(j.completed_at) : undefined,
    error: j.error ? String(j.error) : undefined,
    name: j.name ? String(j.name) : undefined,
    project_id: j.project_id ? String(j.project_id) : null,
  };
}

function normalizeToolJobStatus(status: unknown): ToolJob['status'] {
  if (status === 'completed' || status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  return 'pending';
}

function mapDataset(d: Record<string, unknown>): Dataset {
  return {
    id: String(d.id),
    projectId: String(d.project_id || ''),
    name: String(d.name || ''),
    ossUrl: String(d.oss_url || ''),
    size: Number(d.size || 0),
    uploadedAt: String(d.uploaded_at || ''),
    description: d.description ? String(d.description) : undefined,
    nCells: d.n_cells ? Number(d.n_cells) : undefined,
    nGenes: d.n_genes ? Number(d.n_genes) : undefined,
    metaUrl: d.meta_url ? String(d.meta_url) : undefined,
    featuresUrl: d.features_url ? String(d.features_url) : undefined,
    parentDatasetId: d.parent_dataset_id ? String(d.parent_dataset_id) : undefined,
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
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter((item) => item.length > 0);
      }
    } catch {
      // Not JSON — fall through.
    }
  }
  return undefined;
}
