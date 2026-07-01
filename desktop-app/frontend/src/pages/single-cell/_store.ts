// ============================================================
// Data store — fetches from R Server SQLite backend.
// Falls back to localStorage if server is unreachable.
// ============================================================

import type {
  Project,
  Dataset,
  Analysis,
  AnalysisStatus,
  AnalysisType,
  Subset,
  LabelsSummary,
} from './_types';
import { getApiPrefix } from './_config';
import { getAuthHeaders } from './_auth';

const API_BASE = () => getApiPrefix() + '/data';

const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 3000]; // ms

async function api(path: string, opts?: RequestInit): Promise<Record<string, unknown>> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(API_BASE() + path, {
        ...opts,
        headers: {
          ...getAuthHeaders(),
          ...(opts?.headers || {}),
        },
      });
      // 5xx = server error, retry
      if (resp.status >= 500 && attempt < MAX_RETRIES) {
        lastError = new Error(`服务器错误 (${resp.status})`);
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }
      const data = await resp.json();
      if (data.status !== 'ok') throw new Error(data.error || '请求失败');
      return data;
    } catch (e: unknown) {
      // Network error (fetch throws TypeError on network failure)
      if (e instanceof TypeError && attempt < MAX_RETRIES) {
        lastError = new Error('网络连接失败，正在重试...');
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }
      throw e;
    }
  }
  throw lastError || new Error('请求失败');
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// Projects
// ============================================================

// W3-D (2026-05-28): filter by modality so /single-cell only sees single-cell
// projects (mirrors spatial's _store which filters by modality='spatial').
// 后端 W1-4 已支持 ?modality= 参数；缺省返回全部，加了之后只回单细胞项目。
const SC_MODALITY = 'single-cell';

export async function listProjects(): Promise<Project[]> {
  const data = await api(`/projects?modality=${SC_MODALITY}`);
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

export async function createProject(name: string, description?: string): Promise<Project> {
  // Explicitly tag modality='single-cell' (server default is also 'single-cell',
  // so this is belt-and-suspenders — but makes intent clear and lets us tighten the
  // server default later without breaking single-cell.)
  const data = await api('/projects', {
    method: 'POST',
    body: JSON.stringify({ name, description, modality: SC_MODALITY }),
  });
  return mapProject(data.project);
}

export async function updateProject(
  id: string,
  patch: { name?: string; description?: string }
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

export async function getProjectStats(id: string): Promise<{ datasets: number; analyses: number }> {
  try {
    const data = await api(`/projects/${id}`);
    return data.stats || { datasets: 0, analyses: 0 };
  } catch {
    return { datasets: 0, analyses: 0 };
  }
}

// ============================================================
// Datasets
// ============================================================

export async function listDatasetsByProject(projectId: string): Promise<Dataset[]> {
  const data = await api(`/projects/${projectId}/datasets`);
  return (data.datasets || []).map(mapDataset);
}

export async function getDataset(id: string): Promise<Dataset | null> {
  try {
    const data = await api(`/datasets/${id}`);
    return mapDataset(data.dataset);
  } catch {
    return null;
  }
}

export async function createDataset(input: {
  projectId: string;
  name: string;
  ossUrl: string;
  size: number;
  description?: string;
  parentDatasetId?: string;
}): Promise<Dataset> {
  const data = await api('/datasets', { method: 'POST', body: JSON.stringify(input) });
  return mapDataset(data.dataset);
}

export async function updateDataset(
  id: string,
  patch: { name?: string; nCells?: number; nGenes?: number; description?: string }
): Promise<Dataset | null> {
  try {
    const data = await api(`/datasets/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    return mapDataset(data.dataset);
  } catch {
    return null;
  }
}

export async function deleteDataset(id: string): Promise<void> {
  await api(`/datasets/${id}`, { method: 'DELETE' });
}

export async function getDatasetStats(
  id: string
): Promise<{ analyses: number; lastAnalysisAt?: string }> {
  try {
    const data = await api(`/datasets/${id}`);
    return data.stats || { analyses: 0 };
  } catch {
    return { analyses: 0 };
  }
}

// ============================================================
// Analyses
// ============================================================

export async function listAnalysesByDataset(datasetId: string): Promise<Analysis[]> {
  const data = await api(`/datasets/${datasetId}/analyses`);
  return (data.analyses || []).map(mapAnalysis);
}

export async function getAnalysis(id: string): Promise<Analysis | null> {
  try {
    const data = await api(`/analyses/${id}`);
    return mapAnalysis(data.analysis);
  } catch {
    return null;
  }
}

export async function createAnalysis(input: {
  datasetId: string;
  taskId: string;
  type: AnalysisType;
  name: string;
  parentAnalysisId?: string;
  params: Record<string, unknown>;
  status: AnalysisStatus;
}): Promise<Analysis> {
  const data = await api('/analyses', { method: 'POST', body: JSON.stringify(input) });
  return mapAnalysis(data.analysis);
}

export async function updateAnalysis(
  id: string,
  patch: {
    name?: string;
    status?: string;
    summary?: Record<string, unknown>;
    error?: string;
    finishedAt?: string;
  }
): Promise<Analysis | null> {
  try {
    const data = await api(`/analyses/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    return mapAnalysis(data.analysis);
  } catch {
    return null;
  }
}

export async function updateAnalysisByTaskId(
  taskId: string,
  patch: {
    status?: string;
    summary?: Record<string, unknown>;
    results?: Record<string, unknown>;
    error?: string;
    finishedAt?: string;
  }
): Promise<Analysis | null> {
  try {
    const data = await api(`/analyses/by-task/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    return mapAnalysis(data.analysis);
  } catch {
    return null;
  }
}

export async function deleteAnalysis(id: string): Promise<void> {
  await api(`/analyses/${id}`, { method: 'DELETE' });
}

// ============================================================
// Subsets
// ============================================================

export async function listSubsets(datasetId: string): Promise<Subset[]> {
  const data = await api(`/datasets/${datasetId}/subsets`);
  return (data.subsets || []).map(mapSubset);
}

export async function createSubset(input: {
  datasetId: string;
  name: string;
  description?: string;
  cellIds: string[];
}): Promise<Subset> {
  const data = await api(`/datasets/${input.datasetId}/subsets`, {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      cellIds: input.cellIds,
    }),
  });
  return mapSubset(data.subset);
}

export async function deleteSubset(id: string): Promise<void> {
  await api(`/subsets/${id}`, { method: 'DELETE' });
}

// ============================================================
// Cell labels
// ============================================================

export async function listLabels(datasetId: string): Promise<LabelsSummary> {
  const data = await api(`/datasets/${datasetId}/labels`);
  return data.labels || {};
}

export async function createLabel(input: {
  datasetId: string;
  labelName: string;
  labelValue: string;
  cellIds: string[];
}): Promise<void> {
  await api(`/datasets/${input.datasetId}/labels`, {
    method: 'POST',
    body: JSON.stringify({
      labelName: input.labelName,
      labelValue: input.labelValue,
      cellIds: input.cellIds,
    }),
  });
}

export async function deleteLabel(id: string): Promise<void> {
  await api(`/labels/${id}`, { method: 'DELETE' });
}

// ============================================================
// Helpers
// ============================================================

export function getNextAnalysisName(existingAnalyses: Analysis[], type: string): string {
  const count = existingAnalyses.filter((a) => a.type === type).length;
  const typeName =
    type === 'scrna_standard'
      ? '标准分析'
      : type === 'deg'
        ? 'DEG'
        : type === 'enrichment'
          ? '富集分析'
          : type === 'cell_annotation'
            ? '细胞注释'
            : type === 'scrna_integration'
              ? '多样本整合'
              : type === 'trajectory'
                ? '轨迹分析'
                : type === 'communication'
                  ? '细胞通讯'
                  : type;
  return `${typeName} v${count + 1}`;
}

// ---- Field mapping (snake_case from DB → camelCase for frontend) ----
// ponytail: DB rows are loosely-typed snake_case from backend; use a permissive
// record type instead of any to avoid no-explicit-any while keeping field access ergonomic.
type DbRow = Record<string, unknown>;

function mapProject(row: DbRow | null): Project | null {
  if (!row) return row as null;
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    createdAt: (row.created_at || row.createdAt) as string,
    updatedAt: (row.updated_at || row.updatedAt) as string,
    isPublic: !!(row.is_public || row.isPublic),
  };
}

function mapDataset(row: DbRow | null): Dataset | null {
  if (!row) return row as null;
  return {
    id: row.id as string,
    projectId: (row.project_id || row.projectId) as string,
    name: row.name as string,
    ossUrl: (row.oss_url || row.ossUrl) as string,
    size: row.size as number,
    description: row.description as string,
    nCells: (row.n_cells || row.nCells) as number,
    nGenes: (row.n_genes || row.nGenes) as number,
    metaUrl: (row.meta_url || row.metaUrl) as string,
    featuresUrl: (row.features_url || row.featuresUrl) as string,
    parentDatasetId: (row.parent_dataset_id || row.parentDatasetId) as string | undefined,
    uploadedAt: (row.uploaded_at || row.uploadedAt) as string,
  };
}

function mapAnalysis(row: DbRow | null): Analysis | null {
  if (!row) return row as null;
  return {
    id: row.id as string,
    datasetId: (row.dataset_id || row.datasetId) as string,
    taskId: (row.task_id || row.taskId) as string,
    type: row.type as AnalysisType,
    name: row.name as string,
    parentAnalysisId: (row.parent_analysis_id || row.parentAnalysisId) as string | undefined,
    params:
      typeof row.params === 'string'
        ? JSON.parse(row.params)
        : (row.params as Record<string, unknown>) || {},
    status: row.status as AnalysisStatus,
    summary:
      typeof row.summary === 'string'
        ? JSON.parse(row.summary)
        : (row.summary as Record<string, unknown> | undefined),
    results:
      typeof row.results === 'string'
        ? JSON.parse(row.results)
        : (row.results as
            | { plots?: unknown[]; files?: unknown[]; summary?: Record<string, unknown> }
            | undefined),
    error: row.error as string | undefined,
    createdAt: (row.created_at || row.createdAt) as string,
    finishedAt: (row.finished_at || row.finishedAt) as string | undefined,
  };
}

function mapSubset(row: DbRow | null): Subset | null {
  if (!row) return row as null;
  return {
    id: row.id as string,
    datasetId: (row.dataset_id || row.datasetId) as string,
    name: row.name as string,
    description: row.description as string,
    cellIds: Array.isArray(row.cell_ids)
      ? (row.cell_ids as string[])
      : Array.isArray(row.cellIds)
        ? (row.cellIds as string[])
        : [],
    nCells: (row.n_cells ?? row.nCells ?? 0) as number,
    createdAt: (row.created_at || row.createdAt) as string,
  };
}
