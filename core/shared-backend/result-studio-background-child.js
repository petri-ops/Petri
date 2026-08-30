'use strict';

/**
 * Result Studio blocking-work child process.
 *
 * Git plumbing and better-sqlite3 are intentionally synchronous in their
 * canonical adapters.  Running a first-touch baseline materialisation or a
 * full workspace integrity scan on the Express thread therefore blocks every
 * request for the aggregate duration of all Git child processes and file
 * hashes.  This child reuses those exact canonical services in an isolated
 * process; it does not introduce a second implementation or a second truth.
 *
 * A process is deliberate rather than a worker thread: better-sqlite3 is a
 * native synchronous module, and keeping its connection in a separate process
 * preserves SQLite's normal multi-process WAL semantics instead of sharing the
 * addon instance across threads.
 */

const path = require('path');
const fs = require('fs');
const { createHash } = require('crypto');
// shared-backend is copied next to biof3-server in packaged resources, while the
// native addon intentionally lives under biof3-server/node_modules. Resolve from
// both canonical roots so the same worker runs in source Node and packaged
// ELECTRON_RUN_AS_NODE processes.
const Database = require(require.resolve('better-sqlite3', {
  paths: [path.join(__dirname, '../biof3-server'), __dirname],
}));
const { bindProjectRepository } = require('./git-repository-binding');
const {
  ensureBaselineArtifactCohort,
  ensureBaselineArtifactRevision,
} = require('./result-changeset-service');
const { createResultStudioRepository } = require('./result-studio-repository');
const {
  inspectResultStudioWorkspace,
  inspectResultStudioStorage,
  recoverResultStudioWorkspace,
} = require('./result-studio-lifecycle');

function serializableError(error) {
  return {
    code: String(error && error.code || 'result_studio_background_failed'),
    // Child errors may originate in fs/Git/SQLite and therefore contain an
    // absolute workspace or database path. The code is the public diagnostic;
    // raw messages and detail never cross the process/UI boundary.
    message: 'Result Studio background work could not be completed.',
    detail: null,
  };
}

function openRepository(databasePath) {
  if (!databasePath || typeof databasePath !== 'string' || !path.isAbsolute(databasePath)) {
    throw Object.assign(new Error('An absolute SQLite database path is required.'), {
      code: 'background_database_path_invalid',
    });
  }
  const sqlite = new Database(databasePath, { fileMustExist: true });
  sqlite.pragma('busy_timeout = 10000');
  return {
    sqlite,
    repository: createResultStudioRepository(sqlite, { ensureSchema: false }),
  };
}

function parseJson(value, label) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    throw Object.assign(new Error(`${label} is not valid JSON.`), {
      code: 'background_truth_invalid',
    });
  }
}

function rowToAuthoritativeJob(row) {
  if (!row) return null;
  return {
    ...row,
    params: parseJson(row.params_json, 'Source Job parameters') || {},
    result: parseJson(row.result_json, 'Source Job result') || {},
  };
}

function resolveAuthoritativeWorkflowJobs(sqlite, sourceJob) {
  const projectId = String(sourceJob?.project_id || sourceJob?.projectId || '').trim();
  const byId = new Map();
  const queue = [String(sourceJob?.id || '').trim()];
  while (queue.length > 0) {
    const toolJobId = queue.shift();
    if (!toolJobId || byId.has(toolJobId)) continue;
    const row = sqlite.prepare('SELECT * FROM tool_jobs WHERE id=?').get(toolJobId);
    if (!row || row.project_id !== projectId) continue;
    const job = rowToAuthoritativeJob(row);
    byId.set(toolJobId, job);
    for (const input of job.result?.executionProvenance?.inputs || []) {
      const parentJobId = String(input?.lineage?.sourceToolJobId || '').trim();
      if (parentJobId && !byId.has(parentJobId)) queue.push(parentJobId);
    }
  }
  return [...byId.values()];
}

function canonicalPath(value) {
  return fs.realpathSync(path.resolve(value));
}

function loadAuthoritativePayload(payload, sqlite, operation) {
  const projectId = String(payload.projectId || '').trim();
  const project = projectId
    ? sqlite.prepare('SELECT * FROM projects WHERE id=?').get(projectId)
    : null;
  if (!project) {
    throw Object.assign(new Error('Project truth is unavailable.'), {
      code: 'background_project_not_found',
    });
  }
  const workspaceRoot = canonicalPath(project.workspace_path);
  if (workspaceRoot !== canonicalPath(payload.workspaceRoot || '')) {
    throw Object.assign(new Error('Queued workspace no longer matches Project truth.'), {
      code: 'background_project_workspace_drift',
    });
  }

  if (operation !== 'ensure-baseline') {
    return { ...payload, projectId, workspaceRoot };
  }

  const input = payload.input && typeof payload.input === 'object' ? payload.input : {};
  const sourceJobId = String(input.sourceJob?.id || '').trim();
  const sourceJobRow = sourceJobId
    ? sqlite.prepare('SELECT * FROM tool_jobs WHERE id=?').get(sourceJobId)
    : null;
  if (!sourceJobRow) {
    throw Object.assign(new Error('Source Job truth is unavailable.'), {
      code: 'background_source_job_not_found',
    });
  }
  if (sourceJobRow.project_id !== projectId) {
    throw Object.assign(new Error('Source Job belongs to another project.'), {
      code: 'background_source_job_project_mismatch',
    });
  }
  if (!['completed', 'done'].includes(String(sourceJobRow.status || '').toLowerCase())) {
    throw Object.assign(new Error('Source Job is not completed.'), {
      code: 'background_source_job_incomplete',
    });
  }
  const result = parseJson(sourceJobRow.result_json, 'Source Job result');
  if (!result || result.artifactTruth?.status !== 'valid' || result.artifactTruth?.blocking === true) {
    throw Object.assign(new Error('Source Job Artifact Truth is not valid.'), {
      code: 'background_source_job_truth_invalid',
    });
  }
  const script = result.executionProvenance?.script;
  const suppliedSha = String(input.sourceScriptSha256 || '').toLowerCase();
  const contentSha = createHash('sha256').update(String(input.sourceScriptContent || '')).digest('hex');
  if (!script?.sha256 || suppliedSha !== String(script.sha256).toLowerCase() || contentSha !== suppliedSha) {
    throw Object.assign(new Error('Source script drifted while background work was queued.'), {
      code: 'background_source_script_drift',
    });
  }
  if (String(input.pluginId || '') !== String(sourceJobRow.tool_id || '')) {
    throw Object.assign(new Error('Source plugin no longer matches Job truth.'), {
      code: 'background_source_plugin_drift',
    });
  }

  return {
    ...payload,
    projectId,
    workspaceRoot,
    input: {
      ...input,
      projectId,
      workspaceRoot,
      sourceJob: {
        ...sourceJobRow,
        params: parseJson(sourceJobRow.params_json, 'Source Job parameters'),
        result,
      },
    },
  };
}

function bind(payload, repository, { write }) {
  const allowExistingRepository = repository.hasExistingRepositoryConsent?.(payload.projectId) === true;
  const binding = bindProjectRepository({
    workspaceRoot: payload.workspaceRoot,
    projectId: payload.projectId,
    preferManaged: false,
    allowExistingRepository,
    createManagedIfMissing: write,
  });
  if (!binding || !binding.adapter || (write && binding.status !== 'ready')) {
    throw Object.assign(new Error(binding?.reason || 'Git binding is unavailable.'), {
      code: binding?.reason || binding?.status || 'repository_binding_failed',
    });
  }
  return binding;
}

function ensureBaseline(payload, repository, sqlite) {
  const binding = bind(payload, repository, { write: true });
  repository.saveRepositoryBinding({
    projectId: payload.projectId,
    mode: binding.mode,
    workspaceRoot: binding.workspaceRoot,
    gitDir: binding.adapter.gitDir,
    workTree: binding.adapter.workTree,
    managedPaths: binding.managedPaths,
    status: binding.status,
    reason: binding.reason,
    gitVersion: binding.inspection?.runtime?.versionRaw || null,
  });
  const trustedDescriptor = payload.input && payload.input.pluginDescriptor
    ? payload.input.pluginDescriptor
    : null;
  const ensureBaseline = trustedDescriptor
    ? ensureBaselineArtifactCohort
    : ensureBaselineArtifactRevision;
  return ensureBaseline(payload.input, {
    repository,
    adapter: binding.adapter,
    gitPathPrefix: binding.mode === 'existing'
      ? binding.inspection?.existing?.workspaceRelativeToRepository
      : '',
    getResultStudioDescriptor: (toolId) => (
      trustedDescriptor && toolId === payload.input.pluginId ? trustedDescriptor : null
    ),
    resolveWorkflowJobs: ({ sourceJob }) => resolveAuthoritativeWorkflowJobs(sqlite, sourceJob),
  });
}

function inspectWorkspace(payload, repository, sqlite) {
  const binding = bind(payload, repository, { write: false });
  const gitPathPrefix = binding.mode === 'existing'
    ? binding.inspection?.existing?.workspaceRelativeToRepository || ''
    : '';
  return {
    lifecycle: inspectResultStudioWorkspace({
      repository,
      adapter: binding.adapter,
      workspaceRoot: payload.workspaceRoot,
      projectId: payload.projectId,
      conversationId: payload.conversationId || null,
      runtimeLease: payload.runtimeLease || null,
      gitPathPrefix,
      getToolJob: (toolJobId) => rowToAuthoritativeJob(
        sqlite.prepare('SELECT * FROM tool_jobs WHERE id=?').get(toolJobId)
      ),
    }),
    storage: inspectResultStudioStorage({
      repository,
      workspaceRoot: payload.workspaceRoot,
      projectId: payload.projectId,
    }),
  };
}

function recoverWorkspace(payload, repository, sqlite) {
  const binding = bind(payload, repository, { write: true });
  const gitPathPrefix = binding.mode === 'existing'
    ? binding.inspection?.existing?.workspaceRelativeToRepository || ''
    : '';
  return recoverResultStudioWorkspace({
    workspaceRoot: payload.workspaceRoot,
    projectId: payload.projectId,
    conversationId: payload.conversationId || null,
    runtimeLease: payload.runtimeLease || null,
    gitPathPrefix,
  }, {
    repository,
    adapter: binding.adapter,
    getToolJob: (toolJobId) => rowToAuthoritativeJob(
      sqlite.prepare('SELECT * FROM tool_jobs WHERE id=?').get(toolJobId)
    ),
  });
}

function runOperation(operation, payload, repository, sqlite) {
  if (operation === 'ensure-baseline') return ensureBaseline(payload, repository, sqlite);
  if (operation === 'inspect-workspace') return inspectWorkspace(payload, repository, sqlite);
  if (operation === 'recover-workspace') return recoverWorkspace(payload, repository, sqlite);
  throw Object.assign(new Error('Unsupported Result Studio background operation.'), {
    code: 'background_operation_invalid',
  });
}

function handleMessage(message) {
  const requestId = message && message.requestId;
  let opened = null;
  try {
    const operation = String(message && message.operation || '');
    const payload = message && message.payload && typeof message.payload === 'object'
      ? message.payload
      : {};
    opened = openRepository(payload.databasePath);
    const authoritativePayload = loadAuthoritativePayload(payload, opened.sqlite, operation);
    const result = runOperation(operation, authoritativePayload, opened.repository, opened.sqlite);
    opened.sqlite.close();
    opened = null;
    if (process.send) process.send({ requestId, ok: true, result });
  } catch (error) {
    try { opened?.sqlite?.close(); } catch { /* best effort */ }
    if (process.send) process.send({ requestId, ok: false, error: serializableError(error) });
  }
}

process.on('message', handleMessage);
process.on('disconnect', () => process.exit(0));
