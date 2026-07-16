const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { pathToFileURL } = require('url');
const express = require('express');

const db = require('../db');
const config = require('../config');
const { projectHarnessWorkflowJob } = require('../helpers/harness-workflow-state');
const {
  appendWorkflowRecoveryAudit,
  createRecoveryConfirmationStore,
  validateWorkflowRecoveryAction,
} = require('../helpers/harness-workflow-recovery');
const {
  normalizeReference,
  hasUsableArtifactTruth,
  isRealPathInsideRoot,
} = require('../helpers/chat-file-references');
const { reconcileToolJobArtifacts } = require('./tools-metadata');
const pluginLoader = require('../plugin-loader');

const DEFAULT_MAX_FILES = 500;
const RECOVERY_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const recoveryConfirmations = createRecoveryConfirmationStore({
  ttlMs: RECOVERY_CONFIRMATION_TTL_MS,
});

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
  // 去 submodule 后：desktop/core/r-server/routes/harness.js → 上 3 层到 desktop 仓根
  return path.resolve(__dirname, '../../..');
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

function selectArtifactResultDirBestEffort(job, result) {
  const jobsRoot = jobsDir();
  const candidates = [
    result && result.resultDir,
    result && result.outputDir,
    jobsRoot && job && path.join(jobsRoot, job.id),
  ]
    .filter(Boolean)
    .flatMap((base) => [path.join(base, 'output'), base])
    .map((value) => path.resolve(value));
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) continue;
      const files = fs.readdirSync(candidate, { withFileTypes: true }).filter((entry) => entry.isFile());
      if (files.length === 0) continue;
      return candidate;
    } catch {
      // ignore this candidate; try next
    }
  }
  return '';
}

const INTERNAL_FILES = new Set([
  'params.json',
  'run-script.R',
  'run-script.py',
  '_biof3-theme.R',
  'report-template.html',
  'manifest.json',
]);

function parseJsonMaybe(value, fallback = null) {
  if (!value) return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function collectArtifactNamesFromResult(result) {
  if (!result || typeof result !== 'object') return [];
  const out = new Set();
  const sources = [result.artifacts, result.outputs, result.files];
  for (const list of sources) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item) continue;
      const name = typeof item === 'string' ? item : item.name || item.filename;
      if (!name) continue;
      const base = path.basename(String(name));
      if (base && !INTERNAL_FILES.has(base)) out.add(base);
    }
  }
  const manifest = result.manifest;
  if (manifest && typeof manifest === 'object') {
    for (const key of ['artifacts', 'outputs', 'files']) {
      if (!Array.isArray(manifest[key])) continue;
      for (const item of manifest[key]) {
        const name = item && (item.name || item.filename);
        if (name) {
          const base = path.basename(String(name));
          if (base && !INTERNAL_FILES.has(base)) out.add(base);
        }
      }
    }
  }
  return Array.from(out);
}

function listJobArtifactNames(job) {
  if (!job || !job.id) return [];
  const parsed = parseJsonMaybe(job.result_json);
  if (!hasUsableArtifactTruth(parsed)) return [];
  const resultDir = selectArtifactResultDirBestEffort(job, parsed);
  if (!resultDir) return [];
  try {
    return fs
      .readdirSync(resultDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => !INTERNAL_FILES.has(name));
  } catch {
    return [];
  }
}

function buildArtifactInfo(job, name) {
  const info = { name, jobId: job.id, projectId: job.project_id || null };
  const parsed = parseJsonMaybe(job.result_json);
  if (parsed && typeof parsed === 'object') {
    const match = (parsed.artifacts || parsed.outputs || parsed.files || []).find(
      (item) => item && (item.name === name || item.filename === name),
    );
    if (match && typeof match === 'object') {
      if (match.type || match.kind) info.type = String(match.type || match.kind);
      if (match.label || match.title) info.label = String(match.label || match.title);
    }
  }
  info.url = `/api/tools/file/${encodeURIComponent(job.id)}/${encodeURIComponent(name)}`;
  return info;
}

function buildWorkspaceInfo(project, relativePath) {
  return {
    projectId: project.id,
    relativePath,
    name: path.basename(relativePath),
    url: `/api/workspaces/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(relativePath)}`,
  };
}

function isPathInsideWorkspace(workspacePath, relativePath) {
  if (!workspacePath) return false;
  try {
    const realRoot = fs.realpathSync(workspacePath);
    const target = path.resolve(realRoot, relativePath);
    const realTarget = fs.realpathSync(target);
    if (!isRealPathInsideRoot(realRoot, realTarget)) return false;
    return fs.statSync(realTarget).isFile();
  } catch {
    return false;
  }
}

function noResolution(reference, reason) {
  return { reference, resolved: null, reason };
}

function isAbsoluteReference(value) {
  if (!value) return false;
  return path.isAbsolute(value);
}

function normalizeRelativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function dangerousPathSegment(segment) {
  return /(^|\/|\\)(node_modules|\.git|\.env|\.ssh|\.biof3-secrets)(\/|$|\\)/i.test(segment);
}

module.exports = function registerHarnessRoutes(app) {
  app.post('/api/harness/workflow/action/:jobId', express.json({ limit: '32kb' }), async (req, res) => {
    try {
      const job = await db.getToolJob(req.params.jobId);
      if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!canAccessJob(req, job)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
      const actionId = String(req.body?.actionId || '');
      const validation = validateWorkflowRecoveryAction(job, actionId);
      if (!validation.ok) {
        return res.status(409).json({ ok: false, error: validation.error });
      }

      const confirmationToken = req.body?.confirmationToken
        ? String(req.body.confirmationToken)
        : '';
      if (!confirmationToken) {
        const confirmation = recoveryConfirmations.issue({
          actionId,
          jobId: job.id,
          userId: userId(req),
        });
        return res.json({
          ok: true,
          needsConfirmation: true,
          confirmationToken: confirmation.token,
          expiresAt: confirmation.expiresAt,
          actionId,
          jobId: job.id,
        });
      }

      const consumed = recoveryConfirmations.consume(confirmationToken, {
        jobId: job.id,
        actionId,
        userId: userId(req),
      });
      if (!consumed.ok) {
        return res.status(409).json({ ok: false, error: 'confirmation_invalid_or_expired' });
      }
      if (req.body?.confirm !== true) {
        return res.json({ ok: true, cancelled: true, actionId, jobId: job.id });
      }

      const auditEntry = {
        id: `recovery_${randomUUID()}`,
        actionId,
        confirmedAt: new Date().toISOString(),
        requestedBy: userId(req),
        source: 'workflow_ui',
      };
      const nextParams = appendWorkflowRecoveryAudit(job.params || {}, auditEntry);
      await db.updateToolJobParams(job.id, nextParams);

      if (actionId === 'reconcile_artifacts') {
        const reconciled = await reconcileToolJobArtifacts({
          job: { ...job, params: nextParams },
          db,
          jobsDir: jobsDir(),
        });
        return res.json({
          ok: true,
          actionId,
          jobId: job.id,
          workflow: projectHarnessWorkflowJob({
            ...job,
            params: nextParams,
            status: reconciled.status,
            error: reconciled.error,
            result: reconciled.result,
          }),
        });
      }

      const registry = require('../mcp/registry');
      const pluginLoader = require('../plugin-loader');
      if (!pluginLoader.getPlugin(job.tool_id)) {
        return res.status(409).json({ ok: false, error: 'tool_not_available' });
      }
      registry.callTool(job.tool_id, nextParams, {
        userId: userId(req),
        projectId: job.project_id || null,
        toolJobId: job.id,
      }).catch((error) => {
        console.warn('[harness] workflow retry failed:', error.message);
      });
      const runningJob = await db.getToolJob(job.id);
      return res.json({
        ok: true,
        actionId,
        jobId: job.id,
        workflow: projectHarnessWorkflowJob(runningJob || job),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/harness/workflow/status/:jobId', async (req, res) => {
    try {
      const job = await db.getToolJob(req.params.jobId);
      if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!canAccessJob(req, job)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
      const reconciled = await reconcileToolJobArtifacts({ job, db, jobsDir: jobsDir() });
      return res.json({
        ok: true,
        workflow: projectHarnessWorkflowJob({
          ...job,
          status: reconciled.status,
          error: reconciled.error,
          result: reconciled.result,
        }),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/harness/index', async (req, res) => {
    try {
      const options = authorizeAndResolveOptions(req, res);
      if (!options) return;
      const harness = await loadHarnessModule();
      const scoped = harness.indexHarnessScope(options);
      const promptSummary = !boolQuery(req.query.full, false);
      res.json({
        ok: true,
        scope: scoped.scope,
        index: promptSummary ? scoped.promptSummary : scoped.index,
      });
    } catch (error) {
      if (/^Scope target does not exist:/i.test(String(error && error.message || ''))) {
        return res.status(404).json({ ok: false, error: 'scope_target_not_found' });
      }
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/harness/repair', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const options = authorizeAndResolveOptions(req, res);
      if (!options) return;
      const manifest = req.body && req.body.manifest;
      if (!manifest || typeof manifest !== 'object') {
        return res.status(400).json({ ok: false, error: 'missing_manifest' });
      }
      const harness = await loadHarnessModule();
      const platform = harness.createLocalHarnessPlatform(options);
      const scoped = harness.indexHarnessScope({ ...options, platform });
      const executionContext = harness.createHarnessExecutionContext({
        ...options,
        platform,
        scopeInfo: scoped.scope,
        manifest,
      });
      const preferredPaths = req.body && req.body.activeArtifactName
        ? [String(req.body.activeArtifactName)]
        : [];
      const inputSuggestions = harness.suggestInputBindings(manifest, scoped.index, { preferredPaths });
      const repair = harness.repairHarnessParams(manifest, scoped.index, req.body.params || {}, {
        inputSuggestions,
        useAbsolutePaths: true,
      });
      const diagnostics =
        typeof harness.diagnoseHarnessRunReadiness === 'function'
          ? harness.diagnoseHarnessRunReadiness(manifest, scoped.index, req.body.params || {}, {
              repair,
              inputSuggestions,
              executionContext,
            })
          : null;
      res.json({
        ok: true,
        scope: scoped.scope,
        index: scoped.promptSummary,
        repair,
        diagnostics,
        executionContext,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/harness/workflow/plan', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const options = authorizeAndResolveOptions(req, res);
      if (!options) return;
      const harness = await loadHarnessModule();
      const platform = harness.createLocalHarnessPlatform(options);
      const scoped = harness.indexHarnessScope({ ...options, platform });
      const requestText = req.body.requestText || '';
      const manifests = availableHarnessManifests();
      const explicitManifest = req.body && req.body.manifest;
      const taskPack = harness.selectHarnessTaskPack?.(requestText) || null;
      const rankedTools = explicitManifest
        ? null
        : harness.rankHarnessToolsForRequest(requestText, manifests, scoped.index);
      const rankedTaskToolId = taskPack
        ? rankedTools?.find((ranked) => taskPack.toolIds.includes(ranked.toolId))?.toolId
        : null;
      const manifest =
        explicitManifest ||
        (rankedTaskToolId && manifests.find((item) => item.id === rankedTaskToolId)) ||
        null;
      if (!manifest || typeof manifest !== 'object') {
        return res.status(422).json({
          ok: false,
          error: 'no_matching_tool',
          taskPack,
          rankedTools: rankedTools || [],
        });
      }
      const executionContext = harness.createHarnessExecutionContext({
        ...options,
        platform,
        scopeInfo: scoped.scope,
        manifest,
      });
      const preferredPaths = req.body.activeArtifactName
        ? [String(req.body.activeArtifactName)]
        : [];
      const plan = harness.createHarnessWorkflowPlan({
        requestText,
        manifest,
        manifests,
        rankedTools: rankedTools || undefined,
        index: scoped.index,
        params: req.body.params || {},
        preferredPaths,
        useAbsolutePaths: true,
        executionContext,
      });
      res.json({
        ok: true,
        scope: scoped.scope,
        index: scoped.promptSummary,
        selection: {
          source: explicitManifest ? 'explicit' : 'deterministic',
          taskPack,
          rankedTools: rankedTools || [],
        },
        plan,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/harness/file-references/resolve', express.json({ limit: '128kb' }), async (req, res) => {
    try {
      const projectId = String(req.body?.projectId || req.query.projectId || '').trim();
      if (!projectId) {
        return res.status(400).json({ ok: false, error: 'missing_project_id' });
      }
      const project = db.getProject(projectId);
      if (!project) {
        return res.status(404).json({ ok: false, error: 'project_not_found' });
      }
      if (!canAccessProject(req, project)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
      const activeJobId = req.body?.activeJobId || req.query.activeJobId || null;
      const references = Array.isArray(req.body?.references)
        ? req.body.references
        : Array.isArray(req.body?.refs)
          ? req.body.refs
          : [];
      if (references.length === 0) {
        return res.json({ ok: true, results: [] });
      }

      const projectWorkspacePath = project.workspace_path || null;
      const activeJob = activeJobId ? db.getToolJob(String(activeJobId)) : null;
      if (activeJobId && !activeJob) {
        return res.status(404).json({ ok: false, error: 'active_job_not_found' });
      }
      if (activeJob && !canAccessJob(req, activeJob)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }

      const activeJobArtifactNames = activeJob ? listJobArtifactNames(activeJob) : [];

      const results = [];
      for (const raw of references) {
        if (typeof raw !== 'string') {
          results.push(noResolution(String(raw || ''), 'invalid_reference_type'));
          continue;
        }
        const reference = raw;
        const normalized = normalizeReference(reference);
        if (!normalized) {
          results.push(noResolution(reference, 'dangerous_or_unsupported'));
          continue;
        }

        if (normalized.kind === 'artifact') {
          const parts = normalized.normalized.split('/');
          const tailJobId = parts.shift();
          if (!tailJobId) {
            results.push(noResolution(reference, 'missing_job_id'));
            continue;
          }
          const tailName = parts.join('/');
          const job = db.getToolJob(tailJobId);
          if (!job) {
            results.push(noResolution(reference, 'job_not_found'));
            continue;
          }
          if (!canAccessJob(req, job)) {
            results.push(noResolution(reference, 'forbidden'));
            continue;
          }
          if (job.project_id && projectId && job.project_id !== projectId) {
            results.push(noResolution(reference, 'project_mismatch'));
            continue;
          }
          const baseName = path.basename(tailName);
          const artifactNames = listJobArtifactNames(job);
          if (!baseName || !artifactNames.includes(baseName)) {
            results.push(noResolution(reference, 'artifact_missing'));
            continue;
          }
          const resolved = buildArtifactInfo(job, baseName);
          results.push({ reference, resolved: { kind: 'artifact', ...resolved } });
          continue;
        }

        if (normalized.kind === 'artifact_tools_url') {
          const [tailJobId, ...rest] = normalized.normalized.split('/');
          const tailName = rest.join('/');
          const job = tailJobId ? db.getToolJob(tailJobId) : null;
          if (!job) {
            results.push(noResolution(reference, 'job_not_found'));
            continue;
          }
          if (!canAccessJob(req, job)) {
            results.push(noResolution(reference, 'forbidden'));
            continue;
          }
          if (job.project_id && projectId && job.project_id !== projectId) {
            results.push(noResolution(reference, 'project_mismatch'));
            continue;
          }
          const baseName = path.basename(tailName);
          const artifactNames = listJobArtifactNames(job);
          if (!baseName || !artifactNames.includes(baseName)) {
            results.push(noResolution(reference, 'artifact_missing'));
            continue;
          }
          const resolved = buildArtifactInfo(job, baseName);
          results.push({ reference, resolved: { kind: 'artifact', ...resolved } });
          continue;
        }

        if (normalized.kind === 'workspace') {
          const [tailProject, ...rest] = normalized.normalized.split('/');
          if (tailProject !== projectId) {
            results.push(noResolution(reference, 'project_mismatch'));
            continue;
          }
          const relative = rest.join('/');
          if (!projectWorkspacePath || !relative || !isPathInsideWorkspace(projectWorkspacePath, relative)) {
            results.push(noResolution(reference, 'workspace_out_of_root'));
            continue;
          }
          if (dangerousPathSegment(relative)) {
            results.push(noResolution(reference, 'forbidden_path_segment'));
            continue;
          }
          results.push({ reference, resolved: { kind: 'workspace', ...buildWorkspaceInfo(project, relative) } });
          continue;
        }

        if (normalized.kind === 'project_relative_path') {
          if (isAbsoluteReference(reference)) {
            results.push(noResolution(reference, 'absolute_path_not_supported'));
            continue;
          }
          const relative = normalizeRelativePath(normalized.normalized);
          if (!relative) {
            results.push(noResolution(reference, 'empty_path'));
            continue;
          }
          if (!projectWorkspacePath || !isPathInsideWorkspace(projectWorkspacePath, relative)) {
            results.push(noResolution(reference, 'workspace_out_of_root'));
            continue;
          }
          if (dangerousPathSegment(relative)) {
            results.push(noResolution(reference, 'forbidden_path_segment'));
            continue;
          }
          results.push({ reference, resolved: { kind: 'workspace', ...buildWorkspaceInfo(project, relative) } });
          continue;
        }

        if (normalized.kind === 'bare_filename') {
          if (!activeJob) {
            results.push(noResolution(reference, 'no_active_job_for_bare_filename'));
            continue;
          }
          if (activeJob.project_id && projectId && activeJob.project_id !== projectId) {
            results.push(noResolution(reference, 'project_mismatch'));
            continue;
          }
          const baseName = path.basename(normalized.normalized);
          if (!baseName || !activeJobArtifactNames.includes(baseName)) {
            results.push(noResolution(reference, 'artifact_missing'));
            continue;
          }
          const resolved = buildArtifactInfo(activeJob, baseName);
          results.push({ reference, resolved: { kind: 'artifact', ...resolved } });
          continue;
        }

        results.push(noResolution(reference, 'unsupported_reference_kind'));
      }

      return res.json({ ok: true, results });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
};
