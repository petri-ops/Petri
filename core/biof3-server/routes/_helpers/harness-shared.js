'use strict';

/**
 * routes/_helpers/harness-shared.js — harness 共享 helper（PHASE 2.2a）
 *
 * 抽自 `core/biof3-server/routes/harness.js` PHASE 2 拆分。供 harness/ 8 子域共享：
 *   - userId / isAdminOrInternal / canAccessProject / canAccessJob（鉴权 helper）
 *   - jobsDir / desktopRootFromHere（路径 helper）
 *   - loadHarnessModule / availableHarnessManifests（manifest loader）
 *   - boolQuery / numberQuery / baseOptionsFromRequest（query helper）
 *   - authorizeAndResolveOptions（77 行大 helper，跨 resources/workflow/repair/scientific-task）
 *   - parseJsonMaybe（shared JSON parser）
 *
 * 循环依赖注意点：仅 require 上层 helper（`../db`, `../config`, `../plugin-loader`,
 * `../helpers/*`），不反向 require 子域文件。
 */

const path = require('path');
const { pathToFileURL } = require('url');
const config = require('../../config');
const pluginLoader = require('../../plugin-loader');
const db = require('../../db');

const DEFAULT_MAX_FILES = 500;

function userId(req) {
  return req.user && (req.user.id || req.user.userId) || null;
}

function isAdminOrInternal(req) {
  return req.isInternal || (req.user && req.user.role === 'admin');
}

function canAccessProject(req, project) {
  if (!project) return false;
  if (isAdminOrInternal(req)) return true;
  const uid = userId(req);
  return !!(project.is_public || !project.user_id || project.user_id === uid);
}

function canAccessJob(req, job) {
  if (!job) return false;
  if (isAdminOrInternal(req)) return true;
  return job.user_id === userId(req);
}

function jobsDir() {
  return path.join(
    config.localResultsDir ||
      path.join(require('os').homedir(), 'Documents', 'BioF3-Local', 'results'),
    'tool-jobs'
  );
}

function desktopRootFromHere() {
  // helper 在 routes/_helpers/（从原 routes/harness.js 下沉一层），
  // 需上 4 层才到 desktop 仓根：_helpers -> routes -> biof3-server -> core -> desktop。
  // 上 3 层会错落到 desktop/core，导致 scripts/harness-file-index.mjs 等模块解析失败。
  return path.resolve(__dirname, '../../../..');
}

async function loadHarnessModule() {
  const explicit = process.env.BIOF3_HARNESS_INDEX_MODULE;
  const modulePath = explicit || path.join(desktopRootFromHere(), 'scripts', 'harness-file-index.mjs');
  return import(pathToFileURL(modulePath).href);
}

function availableHarnessManifests() {
  try {
    pluginLoader.loadPluginsFromDisk();
    pluginLoader.loadBuiltInPlugins(path.join(desktopRootFromHere(), 'resources', 'built-in-plugins'));
  } catch (error) {
    console.warn('[harness] refresh plugin manifests failed:', error.message);
  }
  return pluginLoader.getAllPluginManifests();
}

function boolQuery(value, fallback = false) {
  if (value == null) return fallback;
  return value === true || value === '1' || value === 'true' || value === 'yes';
}

function numberQuery(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function baseOptionsFromRequest(req) {
  return {
    scope: String(req.query.scope || req.body?.scope || 'project'),
    projectId: req.query.projectId || req.query.project_id || req.body?.projectId || req.body?.project_id,
    jobId: req.query.jobId || req.query.job_id || req.body?.jobId || req.body?.job_id,
    datasetId:
      req.query.datasetId || req.query.dataset_id || req.body?.datasetId || req.body?.dataset_id,
    dataDir: process.env.BIOF3_LOCAL_DATA_DIR || undefined,
    jobsDir: jobsDir(),
    dbPath: config.dbPath,
    hash: boolQuery(req.query.hash ?? req.body?.hash, false),
    includeHidden: boolQuery(req.query.includeHidden ?? req.body?.includeHidden, false),
    maxFiles: numberQuery(req.query.maxFiles ?? req.body?.maxFiles, DEFAULT_MAX_FILES),
  };
}

function authorizeAndResolveOptions(req, res) {
  const options = baseOptionsFromRequest(req);
  const scope = String(options.scope || 'project');

  if (scope === 'path' || scope === 'workspace') {
    if (!isAdminOrInternal(req)) {
      res.status(403).json({ ok: false, error: 'admin_or_internal_required' });
      return null;
    }
    options.path = req.query.path || req.body?.path;
    if (!options.path) {
      res.status(400).json({ ok: false, error: 'missing_path' });
      return null;
    }
    return options;
  }

  if (scope === 'project') {
    if (!options.projectId && !(req.query.projectPath || req.body?.projectPath)) {
      res.status(400).json({ ok: false, error: 'missing_project_id' });
      return null;
    }
    if (options.projectId) {
      const project = db.getProject(options.projectId);
      if (!canAccessProject(req, project)) {
        res.status(project ? 403 : 404).json({ ok: false, error: project ? 'forbidden' : 'not_found' });
        return null;
      }
      options.projectPath = project.workspace_path;
    } else if (!isAdminOrInternal(req)) {
      res.status(403).json({ ok: false, error: 'admin_or_internal_required' });
      return null;
    } else {
      options.projectPath = req.query.projectPath || req.body?.projectPath;
    }
    return options;
  }

  if (scope === 'job' || scope === 'artifact') {
    if (!options.jobId) {
      res.status(400).json({ ok: false, error: 'missing_job_id' });
      return null;
    }
    const job = db.getToolJob(options.jobId);
    if (!canAccessJob(req, job)) {
      res.status(job ? 403 : 404).json({ ok: false, error: job ? 'forbidden' : 'not_found' });
      return null;
    }
    return options;
  }

  if (scope === 'dataset') {
    if (!options.datasetId && !(req.query.datasetPath || req.body?.datasetPath)) {
      res.status(400).json({ ok: false, error: 'missing_dataset_id' });
      return null;
    }
    if (options.datasetId) {
      const dataset = db.getDataset(options.datasetId);
      const project = dataset && db.getProject(dataset.project_id);
      if (!dataset || !canAccessProject(req, project)) {
        res
          .status(dataset ? 403 : 404)
          .json({ ok: false, error: dataset ? 'forbidden' : 'not_found' });
        return null;
      }
    } else if (!isAdminOrInternal(req)) {
      res.status(403).json({ ok: false, error: 'admin_or_internal_required' });
      return null;
    } else {
      options.datasetPath = req.query.datasetPath || req.body?.datasetPath;
    }
    return options;
  }

  res.status(400).json({ ok: false, error: 'unsupported_scope' });
  return null;
}

function parseJsonMaybe(value, fallback = null) {
  if (!value) return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

module.exports = {
  userId,
  isAdminOrInternal,
  canAccessProject,
  canAccessJob,
  jobsDir,
  desktopRootFromHere,
  loadHarnessModule,
  availableHarnessManifests,
  boolQuery,
  numberQuery,
  baseOptionsFromRequest,
  authorizeAndResolveOptions,
  parseJsonMaybe,
};
