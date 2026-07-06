// ============================================================
// /spatial Data store
//
// 复用 r-server /api/data/* 共享端点（跨模态），仅在两处加 modality='spatial':
//   1) listProjects → ?modality=spatial
//   2) createProject → body.modality='spatial'
//
// 其他 CRUD（datasets / analyses / subsets / labels）走同一份 single-cell store
// （直接 import 复用，零代码改动）。
// ============================================================

import type { Project } from './_types';
import { getApiPrefix } from '../single-cell/_config';
import { getAuthHeaders } from '../single-cell/_auth';

// ============================================================
// 通用 CRUD：直接复用 single-cell store（datasets / analyses / subsets / labels）
// ============================================================
export {
  // datasets
  listDatasetsByProject,
  getDataset,
  createDataset,
  updateDataset,
  deleteDataset,
  getDatasetStats,
  // analyses
  listAnalysesByDataset,
  getAnalysis,
  createAnalysis,
  updateAnalysis,
  updateAnalysisByTaskId,
  deleteAnalysis,
  // subsets
  listSubsets,
  createSubset,
  deleteSubset,
  // labels
  listLabels,
  createLabel,
  deleteLabel,
  // helpers
  getNextAnalysisName,
  // project read 单个项目（通用，不需要模态过滤）
  getProject,
  updateProject,
  deleteProject,
  getProjectStats,
} from '../single-cell/_store';

// ============================================================
// 空间专属：项目列表 / 创建（带 modality 过滤）
// ============================================================

const API_BASE = () => getApiPrefix() + '/data';
const SPATIAL_MODALITY = 'spatial';
const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 3000];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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
      if (resp.status >= 500 && attempt < MAX_RETRIES) {
        lastError = new Error(`服务器错误 (${resp.status})`);
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }
      const data = await resp.json();
      if (data.status !== 'ok') throw new Error(data.error || '请求失败');
      return data;
    } catch (e: unknown) {
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

function mapProject(row: Record<string, unknown>): Project {
  if (!row) return row;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
    isPublic: !!(row.is_public || row.isPublic),
  };
}

/** 列出当前用户的空间组学项目（仅 modality='spatial'）。 */
export async function listProjects(): Promise<Project[]> {
  const data = await api(`/projects?modality=${SPATIAL_MODALITY}`);
  return (data.projects || []).map(mapProject);
}

/** 创建空间组学项目（自动写入 modality='spatial'）。 */
export async function createProject(name: string, description?: string): Promise<Project> {
  const data = await api('/projects', {
    method: 'POST',
    body: JSON.stringify({ name, description, modality: SPATIAL_MODALITY }),
  });
  return mapProject(data.project);
}
