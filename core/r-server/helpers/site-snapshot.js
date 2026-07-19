/**
 * helpers/site-snapshot.js — SITE_SNAPSHOT_v1
 *
 * Extracted from server.js. Pure module: depends only on ../db.
 *
 * Public API:
 *   buildSiteSnapshotAsync(userId, opts) → Promise<{projects, datasets, analyses}|null>
 *   renderSiteSnapshotForPrompt(snap, maxChars) → string
 *
 * Async helpers use the Promise facade over desktop SQLite.
 */
const dbMod = require('../db');

async function buildSiteSnapshotAsync(userId, opts) {
  if (!userId) return null;
  const o = opts || {};
  const maxAnalyses = o.maxAnalyses || 100;
  const maxDatasets = o.maxDatasets || 50;
  const maxProjects = o.maxProjects || 30;
  const projectId = o.projectId ? String(o.projectId) : null;

  const adb = dbMod.getAsyncDatabase();

  try {
    const projects = projectId
      ? await adb.prepare(`
      SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
        (SELECT COUNT(*) FROM datasets d WHERE d.project_id = p.id) AS dataset_count,
        (SELECT COUNT(*) FROM analyses a WHERE a.dataset_id IN (SELECT id FROM datasets WHERE project_id = p.id)) AS analysis_count
      FROM projects p
      WHERE p.user_id = ? AND p.id = ?
      LIMIT 1
    `).all(userId, projectId)
      : await adb.prepare(`
      SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
        (SELECT COUNT(*) FROM datasets d WHERE d.project_id = p.id) AS dataset_count,
        (SELECT COUNT(*) FROM analyses a WHERE a.dataset_id IN (SELECT id FROM datasets WHERE project_id = p.id)) AS analysis_count
      FROM projects p
      WHERE p.user_id = ?
      ORDER BY p.updated_at DESC
      LIMIT ?
    `).all(userId, maxProjects);

    if (projects.length === 0) return {projects: [], datasets: [], analyses: [], scopeProjectId: projectId};

    const projectIds = projects.map(p => p.id);
    const placeholders = projectIds.map(() => '?').join(',');

    const datasets = await adb.prepare(`
      SELECT id, project_id, name, n_cells, n_genes, size, uploaded_at, description
      FROM datasets
      WHERE project_id IN (${placeholders})
      ORDER BY uploaded_at DESC
      LIMIT ?
    `).all(...projectIds, maxDatasets);

    const datasetIds = datasets.map(d => d.id);
    let analyses = [];
    if (datasetIds.length > 0) {
      const dsPh = datasetIds.map(() => '?').join(',');
      analyses = await adb.prepare(`
        SELECT id, dataset_id, type, name, status, parent_analysis_id, summary, created_at, finished_at, error
        FROM analyses
        WHERE dataset_id IN (${dsPh})
        ORDER BY created_at DESC
        LIMIT ?
      `).all(...datasetIds, maxAnalyses);
    }

    analyses = analyses.map(a => {
      let sum = null;
      try {
        const raw = typeof a.summary === 'string' ? JSON.parse(a.summary) : a.summary;
        if (raw && typeof raw === 'object') {
          sum = {
            nCells: raw.nCells,
            nGenes: raw.nGenes,
            nClusters: raw.nClusters,
            nDEGs: raw.nDEGs,
            nGOTerms: raw.nGOTerms,
          };
          Object.keys(sum).forEach(k => sum[k] === undefined && delete sum[k]);
          if (Object.keys(sum).length === 0) sum = null;
        }
      } catch {}
      return {
        id: a.id,
        datasetId: a.dataset_id,
        type: a.type,
        name: a.name,
        status: a.status,
        parentAnalysisId: a.parent_analysis_id,
        summary: sum,
        createdAt: a.created_at,
        finishedAt: a.finished_at,
        hasError: !!a.error,
      };
    });

    return {
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        datasetCount: p.dataset_count,
        analysisCount: p.analysis_count,
        updatedAt: p.updated_at,
      })),
      datasets: datasets.map(d => ({
        id: d.id,
        projectId: d.project_id,
        name: d.name,
        description: d.description,
        nCells: d.n_cells,
        nGenes: d.n_genes,
        sizeMB: d.size ? Math.round(d.size / 1048576) : null,
        uploadedAt: d.uploaded_at,
      })),
      analyses,
      scopeProjectId: projectId,
    };
  } catch (e) {
    console.log('[site-snapshot] err:', e.message);
    return null;
  }
}

/**
 * Render snapshot as compact text for prompt injection.
 */
function renderSiteSnapshotForPrompt(snap, maxChars) {
  if (!snap) return '';
  maxChars = maxChars || 3500;
  let out = snap.scopeProjectId
    ? '\n\n=== 当前项目资源（实时数据，仅限当前项目） ===\n'
    : '\n\n=== 用户的全部资源（实时数据，可直接引用） ===\n';
  out += '注：所有 id 都可以用于 navigate、recluster、start_analysis 等 action。优先使用这里的真实数据回答用户。\n';

  if (snap.projects.length === 0) {
    out += '\n（用户还没有项目）';
    return out;
  }

  out += '\n[项目]';
  for (const p of snap.projects) {
    out += `\n- ${p.name} (id=${p.id}, ${p.datasetCount} 数据集, ${p.analysisCount} 分析)`;
    if (p.description) out += ' — ' + String(p.description).slice(0, 80);
  }

  if (snap.datasets.length > 0) {
    out += '\n\n[数据集]';
    for (const d of snap.datasets) {
      let line = `\n- ${d.name} (id=${d.id}, projectId=${d.projectId}`;
      if (d.nCells) line += `, ${d.nCells} cells`;
      if (d.nGenes) line += `, ${d.nGenes} genes`;
      if (d.sizeMB) line += `, ${d.sizeMB}MB`;
      line += ')';
      out += line;
    }
  }

  if (snap.analyses.length > 0) {
    out += '\n\n[分析]';
    for (const a of snap.analyses) {
      let line = `\n- ${a.name} (id=${a.id}, datasetId=${a.datasetId}, type=${a.type}, status=${a.status}`;
      if (a.summary) {
        if (a.summary.nClusters) line += `, ${a.summary.nClusters} clusters`;
        if (a.summary.nDEGs) line += `, ${a.summary.nDEGs} DEGs`;
      }
      if (a.parentAnalysisId) line += ', has parent';
      line += ')';
      if (out.length + line.length > maxChars - 80) {
        out += '\n... (more truncated)';
        break;
      }
      out += line;
    }
  }
  return out;
}

// Sync wrapper using the same better-sqlite3 database.
function buildSiteSnapshot(userId, opts) {
  if (!userId) return null;
  const o = opts || {};
  const maxAnalyses = o.maxAnalyses || 100;
  const maxDatasets = o.maxDatasets || 50;
  const maxProjects = o.maxProjects || 30;
  const projectId = o.projectId ? String(o.projectId) : null;

  const sqlite = dbMod.getDatabase();

  try {
    const projects = projectId
      ? sqlite.prepare(`
      SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
        (SELECT COUNT(*) FROM datasets d WHERE d.project_id = p.id) AS dataset_count,
        (SELECT COUNT(*) FROM analyses a WHERE a.dataset_id IN (SELECT id FROM datasets WHERE project_id = p.id)) AS analysis_count
      FROM projects p
      WHERE p.user_id = ? AND p.id = ?
      LIMIT 1
    `).all(userId, projectId)
      : sqlite.prepare(`
      SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
        (SELECT COUNT(*) FROM datasets d WHERE d.project_id = p.id) AS dataset_count,
        (SELECT COUNT(*) FROM analyses a WHERE a.dataset_id IN (SELECT id FROM datasets WHERE project_id = p.id)) AS analysis_count
      FROM projects p
      WHERE p.user_id = ?
      ORDER BY p.updated_at DESC
      LIMIT ?
    `).all(userId, maxProjects);

    if (projects.length === 0) return {projects: [], datasets: [], analyses: [], scopeProjectId: projectId};

    const projectIds = projects.map(p => p.id);
    const placeholders = projectIds.map(() => '?').join(',');

    const datasets = sqlite.prepare(`
      SELECT id, project_id, name, n_cells, n_genes, size, uploaded_at, description
      FROM datasets
      WHERE project_id IN (${placeholders})
      ORDER BY uploaded_at DESC
      LIMIT ?
    `).all(...projectIds, maxDatasets);

    const datasetIds = datasets.map(d => d.id);
    let analyses = [];
    if (datasetIds.length > 0) {
      const dsPh = datasetIds.map(() => '?').join(',');
      analyses = sqlite.prepare(`
        SELECT id, dataset_id, type, name, status, parent_analysis_id, summary, created_at, finished_at, error
        FROM analyses
        WHERE dataset_id IN (${dsPh})
        ORDER BY created_at DESC
        LIMIT ?
      `).all(...datasetIds, maxAnalyses);
    }

    analyses = analyses.map(a => {
      let sum = null;
      try {
        const raw = typeof a.summary === 'string' ? JSON.parse(a.summary) : a.summary;
        if (raw && typeof raw === 'object') {
          sum = {
            nCells: raw.nCells,
            nGenes: raw.nGenes,
            nClusters: raw.nClusters,
            nDEGs: raw.nDEGs,
            nGOTerms: raw.nGOTerms,
          };
          Object.keys(sum).forEach(k => sum[k] === undefined && delete sum[k]);
          if (Object.keys(sum).length === 0) sum = null;
        }
      } catch {}
      return {
        id: a.id,
        datasetId: a.dataset_id,
        type: a.type,
        name: a.name,
        status: a.status,
        parentAnalysisId: a.parent_analysis_id,
        summary: sum,
        createdAt: a.created_at,
        finishedAt: a.finished_at,
        hasError: !!a.error,
      };
    });

    return {
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        datasetCount: p.dataset_count,
        analysisCount: p.analysis_count,
        updatedAt: p.updated_at,
      })),
      datasets: datasets.map(d => ({
        id: d.id,
        projectId: d.project_id,
        name: d.name,
        description: d.description,
        nCells: d.n_cells,
        nGenes: d.n_genes,
        sizeMB: d.size ? Math.round(d.size / 1048576) : null,
        uploadedAt: d.uploaded_at,
      })),
      analyses,
      scopeProjectId: projectId,
    };
  } catch (e) {
    console.log('[site-snapshot:sync] err:', e.message);
    return null;
  }
}

module.exports = {
  buildSiteSnapshotAsync,
  buildSiteSnapshot,
  renderSiteSnapshotForPrompt,
};
