/**
 * REST API routes for projects / datasets / analyses.
 * Mounted on the main Express app.
 */

const express = require('express');
const db = require('./db');

const router = express.Router();

// ============================================================
// Projects
// ============================================================

// === Ownership check helper ===
function checkOwnership(req, res, projectId) {
  const userId = req.user?.id;
  const role = req.user?.role;
  if (!userId) {
    res.json({ status: 'error', error: '未登录' });
    return false;
  }
  if (role === 'admin') return true; // Admin can access everything
  const db = require('./db');
  const project = db.getProject(projectId);
  if (!project) {
    res.json({ status: 'error', error: '项目不存在' });
    return false;
  }
  if (project.is_public && req.method === 'GET') return true; // Public projects are readable by all
  if (project.user_id && project.user_id !== userId) {
    res.json({ status: 'error', error: '无权访问此资源' });
    return false;
  }
  return true;
}

function getProjectIdForDataset(datasetId) {
  const db = require('./db');
  const ds = db.getDataset(datasetId);
  return ds ? ds.project_id : null;
}

function getProjectIdForAnalysis(analysisId) {
  const db = require('./db');
  const a = db.getAnalysis(analysisId);
  if (!a) return null;
  const ds = db.getDataset(a.dataset_id);
  return ds ? ds.project_id : null;
}

// === Public demo projects ===
router.put('/admin/projects/:id/public', (req, res) => {
  const _userId = req.user?.id;
  const role = req.user?.role;
  if (role !== 'admin') return res.status(403).json({ status: 'error', error: '无权访问' });
  const { isPublic } = req.body;
  const db = require('./db');
  db.setProjectPublic(req.params.id, isPublic);
  res.json({ status: 'ok' });
});

// List public projects (for non-owners, read-only)
router.get('/public-projects', (req, res) => {
  const db = require('./db');
  const allProjects = db.listProjects();
  const publicProjects = allProjects.filter((p) => p.is_public);
  res.json({ status: 'ok', projects: publicProjects });
});

// === Storage quota ===
const _QUOTA_BYTES = parseInt(process.env.USER_QUOTA_MB || '500') * 1024 * 1024; // default 500MB

function getUserStorageUsage(userId) {
  const db = require('./db');
  const allProjects = db.listProjects();
  const userProjects = allProjects.filter((p) => p.user_id === userId);
  let totalBytes = 0;
  for (const p of userProjects) {
    const datasets = db.listDatasets(p.id);
    for (const d of datasets) {
      // Upload file size
      totalBytes += d.size || 0;
      // Analysis output sizes
      const analyses = db.listAnalyses(d.id);
      for (const a of analyses) {
        if (a.results) {
          try {
            const r = typeof a.results === 'string' ? JSON.parse(a.results) : a.results;
            // Estimate: each plot ~200KB, each file ~varies
            if (r.plots) totalBytes += r.plots.length * 200 * 1024;
            if (r.files) {
              for (const f of r.files) {
                if (f.size) {
                  totalBytes += f.size;
                } else if (f.name?.endsWith('.rds')) {
                  totalBytes += 30 * 1024 * 1024;
                } // ~30MB estimate
                else if (f.name?.endsWith('.csv')) {
                  totalBytes += 500 * 1024;
                } // ~500KB estimate
              }
            }
          } catch {}
        }
      }
    }
  }
  return totalBytes;
}

// GET /data/quota — check current usage
router.get('/quota', (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.json({ status: 'error', error: '未登录' });
  const isAdmin = req.user?.role === 'admin';
  const used = getUserStorageUsage(userId);
  const userRow = require('./db').getUserById(userId);
  const userQuotaMb = userRow?.quota_mb || 500;
  const limit = isAdmin ? Infinity : userQuotaMb * 1024 * 1024;
  res.json({
    status: 'ok',
    quota: {
      usedBytes: used,
      usedHuman: formatBytes(used),
      limitBytes: limit,
      limitHuman: isAdmin ? '无限制' : formatBytes(limit),
      percent: isAdmin ? 0 : Math.round((used / limit) * 100),
      remaining: isAdmin ? Infinity : Math.max(0, limit - used),
    },
    // Analysis count this month
    analysesThisMonth: (() => {
      const thisMonth = new Date().toISOString().slice(0, 7) + '-01';
      const row = require('./db').db
        .prepare(
          'SELECT COUNT(*) as cnt FROM analyses WHERE dataset_id IN (SELECT id FROM datasets WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)) AND created_at >= ?'
        )
        .get(userId, thisMonth);
      return row ? row.cnt : 0;
    })(),
    maxAnalysesMonth: (() => {
      const db2 = require('./db');
      const u = db2.getUserById(userId);
      return isAdmin ? Infinity : u?.max_analyses_month || 50;
    })(),
  });
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

router.get('/projects', (req, res) => {
  const userId = req.user?.id;
  // W1-4: optional ?modality=single-cell|spatial filter (backward-compat: omit returns all)
  const modality = req.query.modality;
  const status = req.query.status === 'archived' ? 'archived' : 'active';
  const allProjects = modality ? db.listProjectsByModality(modality, status) : db.listProjects(status);
  // Admin sees all, regular users see only their own
  const projects =
    userId === '__admin__' || req.user?.role === 'admin'
      ? allProjects
      : allProjects.filter((p) => p.is_public || !p.user_id || p.user_id === userId);
  res.json({ status: 'ok', projects });
});

router.get('/projects/:id', (req, res) => {
  if (!checkOwnership(req, res, req.params.id)) return;

  const p = db.getProject(req.params.id);
  if (!p) return res.status(404).json({ status: 'error', error: '项目不存在' });
  const stats = db.getProjectStats(p.id);
  res.json({ status: 'ok', project: p, stats });
});

router.post('/projects', (req, res) => {
  const { name, description, modality, workspacePath } = req.body;
  const userId = req.user?.id;
  if (!name) return res.status(400).json({ status: 'error', error: '缺少 name' });
  // W1-4: optional modality (single-cell | spatial). Defaults to 'single-cell' (db.js handles fallback).
  const allowedModalities = ['single-cell', 'spatial', 'bulk'];
  const m = modality && allowedModalities.includes(modality) ? modality : 'single-cell';
  const ownerId = userId && userId !== '__admin__' ? userId : null;
  const p = db.createProject({ name, description, modality: m, userId: ownerId, workspacePath });
  if (ownerId && !p.user_id) {
    try {
      db.setProjectUserId(p.id, ownerId);
      p.user_id = ownerId;
    } catch {}
  }
  res.json({ status: 'ok', project: p });
});

router.put('/projects/:id', (req, res) => {
  if (!checkOwnership(req, res, req.params.id)) return;

  const { name, description, workspacePath } = req.body;
  const p = db.updateProject(req.params.id, { name, description, workspacePath });
  if (!p) return res.status(404).json({ status: 'error', error: '项目不存在' });
  res.json({ status: 'ok', project: p });
});

router.post('/projects/:id/status', (req, res) => {
  if (!checkOwnership(req, res, req.params.id)) return;
  const status = req.body?.status === 'archived' ? 'archived' : 'active';
  const p = db.setProjectStatus(req.params.id, status);
  if (!p) return res.status(404).json({ status: 'error', error: '项目不存在' });
  res.json({ status: 'ok', project: p });
});

router.delete('/projects/:id', async (req, res) => {
  if (!checkOwnership(req, res, req.params.id)) return;
  try {
    const adb = db.getAsyncDatabase();
    const conversations = await adb.prepare('SELECT id FROM copilot_conversations WHERE project_id=?').all(req.params.id);
    for (const conversation of conversations) {
      await adb.prepare('DELETE FROM copilot_messages WHERE conversation_id=?').run(conversation.id);
    }
    await adb.prepare('DELETE FROM copilot_conversations WHERE project_id=?').run(req.params.id);
    await db.deleteProject(req.params.id);
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// ============================================================
// Project Tool Jobs (7.3: activity timeline)
// ============================================================

router.get('/projects/:id/jobs', (req, res) => {
  if (!checkOwnership(req, res, req.params.id)) return;
  const jobs = db.listProjectToolJobs(req.params.id);
  res.json({ status: 'ok', jobs });
});

// ============================================================
// Datasets
// ============================================================

router.get('/projects/:projectId/datasets', (req, res) => {
  const datasets = db.listDatasets(req.params.projectId);
  res.json({ status: 'ok', datasets });
});

router.get('/datasets/:id', (req, res) => {
  const _pid = getProjectIdForDataset(req.params.id);
  if (_pid && !checkOwnership(req, res, _pid)) return;

  const ds = db.getDataset(req.params.id);
  if (!ds) return res.status(404).json({ status: 'error', error: '数据集不存在' });
  const stats = db.getDatasetStats(ds.id);
  res.json({ status: 'ok', dataset: ds, stats });
});

router.post('/datasets', (req, res) => {
  // Quota check
  const _userId = req.user?.id;
  const _isAdmin = req.user?.role === 'admin';
  if (_userId && !_isAdmin) {
    const _used = getUserStorageUsage(_userId);
    const _fileSize = req.body.size || 0;
    const _userRow = require('./db').getUserById(_userId);
    const _userLimit = (_userRow?.quota_mb || 500) * 1024 * 1024;
    if (_used + _fileSize > _userLimit) {
      return res.status(413).json({
        status: 'error',
        error:
          '存储空间不足。当前已用 ' +
          formatBytes(_used) +
          '，限额 ' +
          formatBytes(_userLimit) +
          '。请删除不需要的数据集后重试。',
      });
    }
  }

  const { projectId, name, ossUrl, size, description, parentDatasetId } = req.body;
  if (!projectId || !name || !ossUrl) {
    return res.status(400).json({ status: 'error', error: '缺少 projectId / name / ossUrl' });
  }
  const ds = db.createDataset({ projectId, name, ossUrl, size, description, parentDatasetId });
  res.json({ status: 'ok', dataset: ds });
});

router.put('/datasets/:id', (req, res) => {
  const _pid = getProjectIdForDataset(req.params.id);
  if (_pid && !checkOwnership(req, res, _pid)) return;

  const { name, nCells, nGenes, description } = req.body;
  const ds = db.updateDataset(req.params.id, { name, nCells, nGenes, description });
  if (!ds) return res.status(404).json({ status: 'error', error: '数据集不存在' });
  res.json({ status: 'ok', dataset: ds });
});

router.delete('/datasets/:id', (req, res) => {
  const _pid = getProjectIdForDataset(req.params.id);
  if (_pid && !checkOwnership(req, res, _pid)) return;

  db.deleteDataset(req.params.id);
  res.json({ status: 'ok' });
});

// ============================================================
// Analyses
// ============================================================

router.get('/datasets/:datasetId/analyses', (req, res) => {
  const analyses = db.listAnalyses(req.params.datasetId);
  res.json({ status: 'ok', analyses });
});

router.get('/analyses/:id', (req, res) => {
  const _pid = getProjectIdForAnalysis(req.params.id);
  if (_pid && !checkOwnership(req, res, _pid)) return;

  const a = db.getAnalysis(req.params.id);
  if (!a) return res.status(404).json({ status: 'error', error: '分析不存在' });
  res.json({ status: 'ok', analysis: a });
});

router.post('/analyses', (req, res) => {
  const { datasetId, taskId, type, name, parentAnalysisId, params, status } = req.body;
  if (!datasetId || !type || !name) {
    return res.status(400).json({ status: 'error', error: '缺少 datasetId / type / name' });
  }
  const a = db.createAnalysis({ datasetId, taskId, type, name, parentAnalysisId, params, status });
  res.json({ status: 'ok', analysis: a });
});

router.put('/analyses/:id', (req, res) => {
  const { name, status, summary, error, finishedAt, results } = req.body;
  const a = db.updateAnalysis(req.params.id, { name, status, summary, error, finishedAt, results });
  if (!a) return res.status(404).json({ status: 'error', error: '分析不存在' });
  res.json({ status: 'ok', analysis: a });
});

router.put('/analyses/by-task/:taskId', (req, res) => {
  const { status, summary, error, finishedAt, results } = req.body;
  const a = db.updateAnalysisByTaskId(req.params.taskId, {
    status,
    summary,
    error,
    finishedAt,
    results,
  });
  if (!a) return res.status(404).json({ status: 'error', error: '分析不存在' });
  res.json({ status: 'ok', analysis: a });
});

router.delete('/analyses/:id', (req, res) => {
  const _pid = getProjectIdForAnalysis(req.params.id);
  if (_pid && !checkOwnership(req, res, _pid)) return;

  db.deleteAnalysis(req.params.id);
  res.json({ status: 'ok' });
});

// ============================================================
// Demo data seeding
// ============================================================

const _path = require('path');
// ============================================================
// Subsets — saved cell selections
// ============================================================

router.get('/datasets/:datasetId/subsets', (req, res) => {
  const subsets = db.listSubsets(req.params.datasetId);
  res.json({ status: 'ok', subsets });
});

router.post('/datasets/:datasetId/subsets', (req, res) => {
  const { name, description, cellIds } = req.body;
  if (!name) return res.status(400).json({ status: 'error', error: '缺少 name' });
  if (!Array.isArray(cellIds) || cellIds.length === 0) {
    return res.status(400).json({ status: 'error', error: '至少选择 1 个细胞' });
  }
  const subset = db.createSubset({ datasetId: req.params.datasetId, name, description, cellIds });
  res.json({ status: 'ok', subset });
});

router.put('/subsets/:id', (req, res) => {
  const { name, description } = req.body;
  const subset = db.updateSubset(req.params.id, { name, description });
  if (!subset) return res.status(404).json({ status: 'error', error: '子集不存在' });
  res.json({ status: 'ok', subset });
});

router.delete('/subsets/:id', (req, res) => {
  db.deleteSubset(req.params.id);
  res.json({ status: 'ok' });
});

// ============================================================
// Cell labels — user-defined annotation columns
// ============================================================

router.get('/datasets/:datasetId/labels', (req, res) => {
  const labels = db.getLabelsSummary(req.params.datasetId);
  res.json({ status: 'ok', labels });
});

router.post('/datasets/:datasetId/labels', (req, res) => {
  const { labelName, labelValue, cellIds } = req.body;
  if (!labelName || !labelValue) {
    return res.status(400).json({ status: 'error', error: '缺少 labelName 或 labelValue' });
  }
  if (!Array.isArray(cellIds) || cellIds.length === 0) {
    return res.status(400).json({ status: 'error', error: '至少选择 1 个细胞' });
  }
  const label = db.createCellLabel({
    datasetId: req.params.datasetId,
    labelName,
    labelValue,
    cellIds,
  });
  res.json({ status: 'ok', label });
});

router.delete('/labels/:id', (req, res) => {
  db.deleteCellLabel(req.params.id);
  res.json({ status: 'ok' });
});

module.exports = router;
