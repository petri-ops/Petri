#!/usr/bin/env node

/**
 * G0-RS-P6 bounded Electron pressure and multi-Revision prototype.
 *
 * This is deliberately not a P6 closeout or qualification producer. It runs
 * two real admitted local Jobs, then adds clearly-labelled synthetic Revision
 * aliases only to pressure the existing history/storage path. Provider and
 * packaged-app evidence remain excluded.
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createP5LiveScientificRuntime,
} from './g0-rs-p5-acceptance.mjs';
import {
  P6_UI110_SOURCE_FILES,
} from './g0-rs-p6-ui110-observation.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = require('better-sqlite3');
const { createResultStudioRepository } = require(path.join(
  ROOT,
  'core/shared-backend/result-studio-repository.js',
));
const { getResultStudioRuntimeLease } = require(path.join(
  ROOT,
  'core/shared-backend/result-studio-runtime-lease.js',
));

const DRIVER_PATH = path.join(ROOT, 'scripts/g0-rs-p6-electron-pressure-driver.cjs');
const VITE_PATH = path.join(ROOT, 'frontend/node_modules/vite/bin/vite.js');
const ELECTRON_PATH = path.join(ROOT, 'node_modules/.bin/electron');
const EVIDENCE_PATH = path.join(
  ROOT,
  'acceptance/g0-result-studio/rs-p6-electron-pressure-multirevision.json',
);
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

export const P6_ELECTRON_PRESSURE_CLASSIFICATION =
  'development_electron_real_jobs_mixed_synthetic_revision_pressure_non_provider_non_packaged_non_qualifying';
export const P6_ELECTRON_PRESSURE_ROWS = 100_000;
export const P6_ELECTRON_PRESSURE_SYNTHETIC_REVISIONS = 201;
export const P6_ELECTRON_PRESSURE_BUDGETS = Object.freeze({
  // This development trace starts before a cold Vite-backed Electron
  // navigation. The packaged/in-app 1s product target remains a P7 boundary;
  // P6 must not claim that colder and materially different path proved it.
  firstCanvasMs: 1_500,
  tableScrollFeedbackMs: 100,
  selectionFeedbackMs: 100,
  sortFeedbackMs: 100,
  filterFeedbackMs: 100,
  artifactSwitchMs: 500,
  virtualPageLoadMs: 2_000,
  pngContentReadyMs: 5_000,
  svgContentReadyMs: 15_000,
  reportContentReadyMs: 10_000,
  compareOpenMs: 1_000,
  progressivePageLoadMs: 2_000,
  historyFirstPageMs: 5_000,
  historyPaginationMs: 2_000,
  rendererPostGcHeapGrowthBytes: 64 * 1024 * 1024,
});

const EXTRA_SOURCE_PATHS = Object.freeze([
  'scripts/g0-rs-p6-electron-pressure-prototype.mjs',
  'scripts/g0-rs-p6-electron-pressure-driver.cjs',
  'test/g0-rs-p6-electron-pressure-prototype.test.mjs',
  'resources/built-in-plugins/volcano-plot/plugin.json',
  'resources/built-in-plugins/volcano-plot/tool-definition.json',
  'resources/built-in-plugins/volcano-plot/scripts/volcano-plot.R',
  'resources/built-in-plugins/go-kegg/plugin.json',
  'resources/built-in-plugins/go-kegg/tool-definition.json',
  'resources/built-in-plugins/go-kegg/scripts/go-kegg.R',
  'resources/built-in-plugins/go-kegg/demo-data/genes.csv',
  'resources/built-in-plugins/go-kegg/go-kegg-report-template.html',
  'core/r-server/helpers/tools-executor.js',
  'core/r-server/routes/result-studio.js',
  'core/shared-backend/result-changeset-service.js',
  'core/shared-backend/result-compare-service.js',
  'core/shared-backend/result-studio-lifecycle.js',
  'core/shared-backend/result-studio-repository.js',
  'core/shared-backend/result-studio-runtime-lease.js',
  'core/shared-backend/result-studio-resource-summary.js',
  'core/shared-backend/result-studio-table-query.js',
  'core/shared-backend/tool-resource-sampler.js',
  'src/backend-health.js',
  'frontend/src/components/result-studio/ResultStudioChangeSetPanel.tsx',
  'frontend/src/components/result-studio/ScientificInteractionViewer.tsx',
  'frontend/src/components/result-studio/resultSurface.ts',
  'frontend/src/components/result-studio/resultStudioClient.ts',
  'frontend/vite.config.ts',
  'frontend/src/pages/project-workspace.tsx',
]);

export const P6_ELECTRON_PRESSURE_SOURCE_FILES = Object.freeze(Object.fromEntries(
  [...new Set([...Object.values(P6_UI110_SOURCE_FILES), ...EXTRA_SOURCE_PATHS])]
    .sort()
    .map((relative) => [relative, relative]),
));

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableHash(value) {
  return sha256(JSON.stringify(stable(value)));
}

function assert(condition, code, detail = null) {
  if (condition) return;
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  throw error;
}

function checkedSource(relative) {
  const normalized = String(relative || '').replaceAll('\\', '/');
  const target = path.resolve(ROOT, normalized);
  assert(normalized && !path.isAbsolute(normalized) && !normalized.split('/').includes('..')
    && target.startsWith(ROOT + path.sep), 'p6_pressure_source_path_unsafe');
  assert(existsSync(target), 'p6_pressure_source_missing', { relative: normalized });
  return { relative: normalized, target };
}

export function getP6ElectronPressureSourceBinding() {
  const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).stdout.trim();
  assert(COMMIT_PATTERN.test(sourceCommit), 'p6_pressure_source_commit_unavailable');
  const sources = Object.fromEntries(Object.entries(P6_ELECTRON_PRESSURE_SOURCE_FILES)
    .map(([key, relative]) => [key, checkedSource(relative)]));
  const sourceHashes = Object.fromEntries(Object.entries(sources)
    .map(([key, source]) => [key, sha256(readFileSync(source.target))]));
  const sourcePaths = Object.values(sources).map((source) => source.relative);
  const tracked = spawnSync(
    'git',
    ['ls-tree', '-r', '--name-only', '-z', sourceCommit, '--', ...sourcePaths],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const changed = spawnSync(
    'git',
    ['diff', '--no-ext-diff', '--name-only', '-z', sourceCommit, '--', ...sourcePaths],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert(tracked.status === 0 && changed.status === 0, 'p6_pressure_source_tree_unavailable');
  const trackedPaths = new Set(tracked.stdout.split('\0').filter(Boolean));
  const changedPaths = new Set(changed.stdout.split('\0').filter(Boolean));
  const sourceMismatches = sourcePaths.filter((relative) => (
    !trackedPaths.has(relative) || changedPaths.has(relative)
  ));
  return {
    sourceCommit,
    sourceFiles: P6_ELECTRON_PRESSURE_SOURCE_FILES,
    sourceHashes,
    bindingDigest: stableHash({
      sourceCommit,
      sourceFiles: P6_ELECTRON_PRESSURE_SOURCE_FILES,
      sourceHashes,
    }),
    sourceCommitMatchesSourceHashes: sourceMismatches.length === 0,
    sourceMismatches,
  };
}

const secretKey = /(?:authorization|cookie|token|password|secret|api[_-]?key|credential|private[_-]?key|access[_-]?key|session)/i;
const internalId = /(?:^|[^A-Za-z0-9])(?:p|job|tj|rev|cs|conv|sel|wfg)_[A-Za-z0-9._-]+/;

export function assertSanitizedP6ElectronPressureEvidence(value, pointer = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSanitizedP6ElectronPressureEvidence(item, `${pointer}[${index}]`));
    return true;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (secretKey.test(key) && key !== 'qualificationEligible') {
        throw new Error(`unsafe evidence key at ${pointer}.${key}`);
      }
      assertSanitizedP6ElectronPressureEvidence(child, `${pointer}.${key}`);
    }
    return true;
  }
  if (typeof value !== 'string') return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) throw new Error(`URI leaked at ${pointer}`);
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^(?:~[\\/]|\\\\)/.test(value)) {
    throw new Error(`absolute path leaked at ${pointer}`);
  }
  if (value.includes('..')) throw new Error(`parent path leaked at ${pointer}`);
  if (internalId.test(value)) throw new Error(`internal id leaked at ${pointer}`);
  return true;
}

export function buildVolcanoPressureCsv(rowCount = P6_ELECTRON_PRESSURE_ROWS) {
  assert(Number.isInteger(rowCount) && rowCount > 0 && rowCount <= 500_000,
    'p6_pressure_row_count_invalid');
  const lines = new Array(rowCount + 1);
  lines[0] = 'gene,log2FoldChange,pvalue,padj';
  for (let index = 0; index < rowCount; index += 1) {
    const gene = `GENE${String(index + 1).padStart(6, '0')}`;
    const centered = ((index * 37) % 601) - 300;
    const lfc = (centered / 100).toFixed(2);
    const pvalue = Math.max(1e-10, ((index * 17) % 10_000 + 1) / 1_000_000).toExponential(6);
    const padj = Math.min(0.999999, Number(pvalue) * 4).toExponential(6);
    lines[index + 1] = `${gene},${lfc},${pvalue},${padj}`;
  }
  return `${lines.join('\n')}\n`;
}

export function loadGoKeggPressureInput() {
  const inputPath = path.join(
    ROOT,
    'resources/built-in-plugins/go-kegg/demo-data/genes.csv',
  );
  const csv = readFileSync(inputPath, 'utf8');
  const rows = csv.trimEnd().split(/\r?\n/);
  assert(rows[0] === 'gene' && rows.length >= 61,
    'p6_pressure_go_kegg_input_invalid');
  assert(new Set(rows.slice(1)).size === rows.length - 1,
    'p6_pressure_go_kegg_input_not_unique');
  return { csv, rowCount: rows.length - 1 };
}

async function freePort(excluded = new Set()) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const port = await new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const selected = typeof address === 'object' && address ? address.port : null;
        server.close(() => resolve(selected));
      });
    });
    if (Number.isInteger(port) && port > 0 && !excluded.has(port)) return port;
  }
  throw new Error('p6_pressure_port_allocation_failed');
}

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 120_000),
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error || `http_${response.status}`);
    error.code = data.error || `http_${response.status}`;
    throw error;
  }
  return data;
}

async function runHttpTool(runtime, { toolId, params, files }) {
  const submitted = await requestJson(runtime.baseUrl, '/api/tools/run', {
    method: 'POST',
    body: JSON.stringify({
      toolId,
      projectId: runtime.project.id,
      params,
      files,
    }),
    timeoutMs: 180_000,
  });
  assert(submitted?.ok === true && submitted.jobId, 'p6_pressure_tool_submission_failed');
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let job = null;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    job = await requestJson(runtime.baseUrl, `/api/tools/status/${encodeURIComponent(submitted.jobId)}`);
    if (TERMINAL_JOB_STATUSES.has(job.status)) break;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  assert(job && job.status === 'completed', 'p6_pressure_tool_job_failed');
  assert(job.result?.artifactTruth?.status === 'valid'
    && job.result.artifactTruth.blocking !== true, 'p6_pressure_artifact_truth_invalid');
  const boundJob = { ...job, id: job.id || submitted.jobId };
  // UX1G-1 contract: the renderer's fail-closed conversation-ownership guard
  // refuses deep links for conversation-less jobs, so the pressure fixture
  // binds every target job to the live trace conversation after completion.
  {
    const bind = new Database(runtime.env.BIOF3_DB_PATH);
    try {
      bind.prepare('UPDATE tool_jobs SET conversation_id=? WHERE id=? AND conversation_id IS NULL')
        .run(runtime.conversation.id, boundJob.id);
    } finally {
      bind.close();
    }
  }
  return boundJob;
}

function artifactRecord(job, artifactId) {
  const matches = (job?.result?.artifacts || []).filter((entry) => entry?.id === artifactId);
  assert(matches.length === 1, `p6_pressure_artifact_missing:${artifactId}`);
  return matches[0];
}

function artifactFilename(job, artifactId) {
  const artifact = artifactRecord(job, artifactId);
  return artifact.filename || artifact.name || path.basename(artifact.path || '');
}

function artifactTarget(job, artifactId) {
  const artifact = artifactRecord(job, artifactId);
  const filename = artifact.filename || artifact.name || path.basename(artifact.path || '');
  const sections = [
    ...(Array.isArray(job?.result?.sections) ? job.result.sections : []),
    ...(Array.isArray(job?.result?.manifest?.sections) ? job.result.manifest.sections : []),
  ];
  const section = sections.find((entry) => (
    Array.isArray(entry?.artifactNames) && entry.artifactNames.includes(filename)
  ));
  return {
    jobId: job.id,
    artifact: filename,
    label: artifact.label || artifact.title || filename,
    sectionLabel: typeof section?.label === 'string' && section.label ? section.label : null,
  };
}

async function openInteraction(runtime, job, artifactId) {
  const artifact = artifactFilename(job, artifactId);
  const query = new URLSearchParams({
    projectId: runtime.project.id,
    jobId: job.id,
    artifact,
  });
  const interaction = await requestJson(
    runtime.baseUrl,
    `/api/result-studio/interaction?${query.toString()}`,
    { timeoutMs: 180_000 },
  );
  const diagnosticCodes = (interaction?.manifest?.diagnostics || [])
    .map((entry) => String(entry?.code || '').trim())
    .filter(Boolean);
  assert(interaction?.revision?.revisionId && interaction.revision.validationStatus === 'valid',
    `p6_pressure_revision_missing:${artifactId}:${diagnosticCodes.join(',') || 'no_diagnostic'}`,
    { diagnosticCodes });
  return { ...interaction, artifact };
}

async function prepareRealPressureJobs(runtime) {
  const volcanoInput = buildVolcanoPressureCsv();
  const volcano = await runHttpTool(runtime, {
    toolId: 'volcano-plot',
    params: {
      deg_table: 'deg_table.csv',
      gene_col: 'gene',
      lfc_col: 'log2FoldChange',
      pval_col: 'padj',
      fc_threshold: 1,
      pval_threshold: 1.3,
      top_n: 12,
      point_size: 0.7,
      point_alpha: 0.45,
      plot_title: 'P6 100k-row pressure volcano',
    },
    files: {
      'deg_table.csv': Buffer.from(volcanoInput).toString('base64'),
    },
  });
  const volcanoInteraction = await openInteraction(runtime, volcano, 'classified_table');

  const reportInput = loadGoKeggPressureInput();
  const enrichment = await runHttpTool(runtime, {
    toolId: 'go-kegg',
    params: {
      deg_table: 'deg_table.csv',
      species: 'human',
      gene_id_type: 'SYMBOL',
      analysis_type: 'GO-BP',
      top_n: 20,
    },
    files: {
      'deg_table.csv': Buffer.from(reportInput.csv).toString('base64'),
    },
  });
  const enrichmentInteraction = await openInteraction(runtime, enrichment, 'go_bp_results');
  return {
    volcano,
    volcanoInteraction,
    enrichment,
    enrichmentInteraction,
    input: {
      volcanoRows: P6_ELECTRON_PRESSURE_ROWS,
      volcanoBytes: Buffer.byteLength(volcanoInput),
      volcanoSha256: sha256(volcanoInput),
      reportRows: reportInput.rowCount,
      reportInputBytes: Buffer.byteLength(reportInput.csv),
      reportInputSha256: sha256(reportInput.csv),
    },
  };
}

function deterministicId(prefix, ...parts) {
  return `${prefix}_${sha256(parts.join('\0')).slice(0, 24)}`;
}

function updateGitRef(binding, ref, commit) {
  assert(binding?.gitDir && binding?.workTree, 'p6_pressure_git_binding_missing');
  execFileSync('git', [
    `--git-dir=${binding.gitDir}`,
    `--work-tree=${binding.workTree}`,
    'update-ref', ref, commit,
  ], { stdio: 'ignore' });
}

function revisionClone(source, { revisionId, changeSetId, parentRevisionId, createdAt }) {
  return {
    revisionId,
    projectId: source.projectId,
    artifactFamilyId: source.artifactFamilyId,
    artifactId: source.artifactId,
    parentRevisionIds: [parentRevisionId],
    sourceCommit: source.sourceCommit,
    sourceScriptRef: source.sourceScriptRef,
    inputArtifactRefs: source.inputArtifactRefs,
    parametersRef: source.parametersRef,
    parametersHash: source.parametersHash,
    toolJobId: source.toolJobId,
    outputPath: source.outputPath,
    outputHash: source.outputHash,
    validationStatus: 'valid',
    reproducibilityStatus: 'available',
    changeSetId,
    createdAt,
  };
}

function pressureValidationSummary(revisions) {
  return {
    artifactTruthStatus: 'valid',
    validatorId: 'result-studio-plugin-validator-v1:volcano-plot',
    formalArtifactCount: revisions.length,
    formalArtifactCohort: revisions.map((revision) => ({
      toolJobId: revision.toolJobId,
      artifactId: revision.artifactId,
      outputHash: revision.outputHash,
    })).sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
    pressureFixtureClassification: 'synthetic_revision_alias_no_additional_job_execution',
  };
}

function createPressureChangeSet(repository, {
  projectId,
  conversationId,
  changeSetId,
  intentRef,
  baseCommit,
  workingBranchRef,
  parentArtifactRefs,
  createdAt,
}) {
  repository.createChangeSet({
    changeSetId,
    projectId,
    conversationId,
    intentRef,
    baseCommit,
    workingBranchRef,
    changedPaths: [],
    parentArtifactRefs,
    candidateArtifactRefs: [],
    jobRefs: [],
    validationSummary: null,
    createdBy: 'user',
    createdAt,
    updatedAt: createdAt,
  });
  repository.transitionChangeSet({ changeSetId, to: 'running', reason: 'synthetic_pressure_alias' });
}

function immutableRevisionDigest(repository, projectId) {
  return stableHash(repository.listProjectRevisions(projectId).map((revision) => ({
    revisionId: revision.revisionId,
    artifactFamilyId: revision.artifactFamilyId,
    artifactId: revision.artifactId,
    parentRevisionIds: revision.parentRevisionIds,
    sourceCommit: revision.sourceCommit,
    toolJobId: revision.toolJobId,
    outputPath: revision.outputPath,
    outputHash: revision.outputHash,
    changeSetId: revision.changeSetId,
    revisionOrdinal: revision.revisionOrdinal,
    isCurrent: revision.isCurrent,
  })));
}

function probeRevisionImmutability(repository, revisionId) {
  const existing = repository.getRevision(revisionId);
  if (!existing) return false;
  let rejected = false;
  try {
    // ArtifactRevision is append-only at the Repository boundary. Lifecycle
    // operations may update current/reproducibility projections, so a raw SQL
    // UPDATE is not a valid immutability probe. Re-appending the same identity
    // with altered scientific bytes must fail atomically on the durable key.
    repository.appendRevisionBatch({
      revisions: [{ ...existing, outputHash: '0'.repeat(64), isCurrent: false }],
    });
  } catch {
    rejected = true;
  }
  return rejected;
}

function stagePressureHistory(runtime, real) {
  const db = new Database(runtime.env.BIOF3_DB_PATH);
  const repository = createResultStudioRepository(db);
  try {
    const volcanoCohort = repository.listRevisionsByChangeSet(
      real.volcanoInteraction.revision.changeSetId,
    );
    assert(volcanoCohort.length === 3, 'p6_pressure_real_volcano_cohort_incomplete');
    const byArtifact = new Map(volcanoCohort.map((revision) => [revision.artifactId, revision]));
    for (const artifactId of ['classified_table', 'volcano', 'volcano_svg']) {
      assert(byArtifact.has(artifactId), `p6_pressure_real_artifact_missing:${artifactId}`);
    }
    const enrichmentCohort = repository.listRevisionsByChangeSet(
      real.enrichmentInteraction.revision.changeSetId,
    );
    assert(enrichmentCohort.some((revision) => revision.artifactId === 'report'),
      'p6_pressure_real_report_cohort_incomplete');
    const binding = repository.getRepositoryBinding(runtime.project.id);
    assert(binding?.status === 'ready', 'p6_pressure_repository_binding_not_ready');

    const distribution = [
      ['classified_table', 121],
      ['volcano', 40],
      ['volcano_svg', 40],
    ];
    const syntheticRevisionIds = [];
    let sequence = 0;
    for (const [artifactId, count] of distribution) {
      const source = byArtifact.get(artifactId);
      let parent = repository.getCurrentRevision(source.artifactFamilyId, source.projectId);
      assert(parent, `p6_pressure_current_missing:${artifactId}`);
      for (let index = 0; index < count; index += 1) {
        sequence += 1;
        const changeSetId = deterministicId('cs', runtime.project.id, 'pressure-alias', artifactId, sequence);
        const revisionId = deterministicId('rev', changeSetId, artifactId);
        const createdAt = new Date(Date.UTC(2026, 6, 31, 0, 0, 0, sequence)).toISOString();
        createPressureChangeSet(repository, {
          projectId: runtime.project.id,
          conversationId: runtime.conversation.id,
          changeSetId,
          intentRef: `p6-pressure-synthetic-alias:${artifactId}:${String(index + 1).padStart(3, '0')}`,
          baseCommit: source.sourceCommit,
          workingBranchRef: `refs/heads/biof3/p6-pressure/alias/${changeSetId}`,
          parentArtifactRefs: [parent.revisionId],
          createdAt,
        });
        const candidate = revisionClone(source, {
          revisionId,
          changeSetId,
          parentRevisionId: parent.revisionId,
          createdAt,
        });
        repository.appendRevisionBatch({
          revisions: [candidate],
          transition: {
            changeSetId,
            to: 'preview_ready',
            reason: 'synthetic_pressure_alias_ready',
            candidateCommit: source.sourceCommit,
            candidateArtifactRefs: [revisionId],
            jobRefs: [source.toolJobId],
            validationSummary: pressureValidationSummary([candidate]),
            changedPaths: [],
          },
        });
        repository.adoptChangeSet({ changeSetId, candidateCommit: source.sourceCommit });
        parent = repository.getCurrentRevision(source.artifactFamilyId, source.projectId);
        syntheticRevisionIds.push(revisionId);
      }
      updateGitRef(
        binding,
        `refs/heads/biof3/current/${source.artifactFamilyId}`,
        source.sourceCommit,
      );
    }

    assert(syntheticRevisionIds.length === P6_ELECTRON_PRESSURE_SYNTHETIC_REVISIONS,
      'p6_pressure_synthetic_revision_count_drift');
    const currentBeforePreview = repository.listCurrentRevisions(runtime.project.id);
    const previewChangeSetId = deterministicId('cs', runtime.project.id, 'pressure-preview-cohort');
    const previewCreatedAt = new Date(Date.UTC(2026, 6, 31, 0, 0, 1)).toISOString();
    const previewRef = `refs/heads/biof3/p6-pressure/preview/${previewChangeSetId}`;
    const previewSources = ['classified_table', 'volcano', 'volcano_svg'].map((artifactId) => {
      const source = byArtifact.get(artifactId);
      const parent = repository.getCurrentRevision(source.artifactFamilyId, source.projectId);
      return { source, parent };
    });
    const candidateCommit = previewSources[0].source.sourceCommit;
    assert(previewSources.every(({ source }) => source.sourceCommit === candidateCommit),
      'p6_pressure_real_cohort_source_commit_drift');
    createPressureChangeSet(repository, {
      projectId: runtime.project.id,
      conversationId: runtime.conversation.id,
      changeSetId: previewChangeSetId,
      intentRef: 'p6-pressure-synthetic-preview:full-volcano-cohort',
      baseCommit: candidateCommit,
      workingBranchRef: previewRef,
      parentArtifactRefs: previewSources.map(({ parent }) => parent.revisionId),
      createdAt: previewCreatedAt,
    });
    updateGitRef(binding, previewRef, candidateCommit);
    const previewRevisions = previewSources.map(({ source, parent }) => revisionClone(source, {
      revisionId: deterministicId('rev', previewChangeSetId, source.artifactId),
      changeSetId: previewChangeSetId,
      parentRevisionId: parent.revisionId,
      createdAt: previewCreatedAt,
    }));
    const previewRevisionIds = previewRevisions.map((revision) => revision.revisionId);
    repository.appendRevisionBatch({
      revisions: previewRevisions,
      transition: {
        changeSetId: previewChangeSetId,
        to: 'preview_ready',
        reason: 'synthetic_pressure_preview_ready',
        candidateCommit,
        candidateArtifactRefs: previewRevisionIds,
        jobRefs: [previewRevisions[0].toolJobId],
        validationSummary: pressureValidationSummary(previewRevisions),
        changedPaths: [],
      },
    });
    repository.saveCheckpoint({
      checkpointId: deterministicId('wrc', previewChangeSetId),
      projectId: runtime.project.id,
      conversationId: runtime.conversation.id,
      baseCommit: candidateCommit,
      candidateCommit,
      changeSetId: previewChangeSetId,
      changeSetStatus: 'preview_ready',
      currentRevisionIds: currentBeforePreview.map((revision) => revision.revisionId),
      selectionId: null,
      pendingPreview: {
        stage: 'preview_ready',
        recovery: 'awaiting_user_decision',
        revisionIds: previewRevisionIds,
        runtimeLease: getResultStudioRuntimeLease(),
      },
      jobRefs: [previewRevisions[0].toolJobId],
      loopRefs: [],
      createdAt: previewCreatedAt,
      updatedAt: previewCreatedAt,
    });

    const immutableBefore = immutableRevisionDigest(repository, runtime.project.id);
    const mutationRejected = probeRevisionImmutability(repository, syntheticRevisionIds[0]);
    const immutableAfter = immutableRevisionDigest(repository, runtime.project.id);
    const projectRevisions = repository.listProjectRevisions(runtime.project.id);
    const syntheticRows = db.prepare(`SELECT COUNT(*) AS count,
        COUNT(DISTINCT revision.artifact_family_id) AS families
      FROM artifact_revisions revision
      INNER JOIN scientific_change_sets change_set ON change_set.change_set_id=revision.change_set_id
      WHERE revision.project_id=? AND change_set.intent_ref LIKE 'p6-pressure-synthetic-alias:%'`)
      .get(runtime.project.id);
    const projectJobCount = db.prepare('SELECT COUNT(*) AS count FROM tool_jobs WHERE project_id=?')
      .get(runtime.project.id).count;
    const familyCounts = distribution.map(([artifactId]) => {
      const source = byArtifact.get(artifactId);
      return {
        artifactClass: artifactId === 'classified_table' ? 'table' : artifactId === 'volcano' ? 'png' : 'svg',
        revisionCount: repository.listRevisions({
          artifactFamilyId: source.artifactFamilyId,
          projectId: runtime.project.id,
          limit: 1_000,
        }).length,
      };
    });
    return {
      coordinates: {
        tableFamilyId: byArtifact.get('classified_table').artifactFamilyId,
      },
      summary: {
        syntheticRevisionCount: Number(syntheticRows.count),
        syntheticFamilyCount: Number(syntheticRows.families),
        syntheticClassification: 'same_real_artifact_bytes_revision_alias_without_additional_execution',
        previewCohortRevisionCount: previewRevisions.length,
        totalProjectRevisionCount: projectRevisions.length,
        projectToolJobCount: Number(projectJobCount),
        familyCounts,
        immutableMutationRejected: mutationRejected,
        immutableDigestStable: immutableBefore === immutableAfter,
        immutableLedgerDigest: immutableAfter,
        currentRevisionCount: repository.listCurrentRevisions(runtime.project.id).length,
        realJobBackedCohortCount: 2,
        realJobBackedCohortDigest: stableHash([
          {
            job: stableHash(real.volcano.id),
            changeSet: stableHash(real.volcanoInteraction.revision.changeSetId),
            revisions: volcanoCohort.map((revision) => stableHash(revision.revisionId)).sort(),
          },
          {
            job: stableHash(real.enrichment.id),
            changeSet: stableHash(real.enrichmentInteraction.revision.changeSetId),
            revisions: enrichmentCohort.map((revision) => stableHash(revision.revisionId)).sort(),
          },
        ]),
      },
    };
  } finally {
    db.close();
  }
}

function countDelimitedRows(filePath) {
  const buffer = readFileSync(filePath);
  let newlines = 0;
  for (const byte of buffer) if (byte === 0x0a) newlines += 1;
  return Math.max(0, newlines - 1);
}

function inspectPng(filePath) {
  const buffer = readFileSync(filePath);
  const signature = '89504e470d0a1a0a';
  assert(buffer.subarray(0, 8).toString('hex') === signature && buffer.length >= 24,
    'p6_pressure_png_invalid');
  return {
    bytes: buffer.length,
    sha256: sha256(buffer),
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function inspectPhysicalTruth(runtime, real, pressure) {
  const root = path.resolve(runtime.project.workspace_path);
  const db = new Database(runtime.env.BIOF3_DB_PATH, { readonly: true });
  const exactArtifact = (job, artifactId, { revisionRequired = true } = {}) => {
    const artifact = artifactRecord(job, artifactId);
    const target = path.resolve(artifact.path);
    assert(target.startsWith(root + path.sep) && existsSync(target),
      `p6_pressure_artifact_outside_workspace:${artifactId}`);
    const bytes = readFileSync(target);
    const digest = sha256(bytes);
    const provenance = (job.result?.executionProvenance?.artifacts || [])
      .filter((entry) => entry?.id === artifactId);
    assert(provenance.length === 1,
      `p6_pressure_provenance_artifact_ambiguous:${artifactId}`);
    assert(provenance[0].sha256 === digest,
      `p6_pressure_provenance_hash_mismatch:${artifactId}`);
    const revisionHashes = db.prepare(`SELECT DISTINCT output_hash FROM artifact_revisions
      WHERE project_id=? AND tool_job_id=? AND artifact_id=?`)
      .all(runtime.project.id, job.id, artifactId)
      .map((row) => row.output_hash)
      .filter(Boolean);
    if (revisionRequired) {
      assert(revisionHashes.length === 1 && revisionHashes[0] === digest,
        `p6_pressure_revision_hash_mismatch:${artifactId}`);
    } else {
      assert(revisionHashes.length === 0
        || (revisionHashes.length === 1 && revisionHashes[0] === digest),
      `p6_pressure_optional_revision_hash_mismatch:${artifactId}`);
    }
    const projectedHash = String(artifact.sha256 || '');
    if (projectedHash) {
      assert(SHA256_PATTERN.test(projectedHash) && projectedHash === digest,
        `p6_pressure_job_artifact_hash_mismatch:${artifactId}`);
    }
    return {
      target,
      bytes,
      digest,
      jobArtifactHashProjection: projectedHash ? 'measured' : 'unavailable',
      sqliteRevisionProjection: revisionHashes.length === 1
        ? 'measured'
        : 'unavailable_without_result_studio_descriptor',
    };
  };
  const table = exactArtifact(real.volcano, 'classified_table');
  const png = exactArtifact(real.volcano, 'volcano');
  const svg = exactArtifact(real.volcano, 'volcano_svg');
  const report = exactArtifact(real.enrichment, 'report');
  const tableRows = countDelimitedRows(table.target);
  const pngTruth = inspectPng(png.target);
  const svgText = svg.bytes.toString('utf8');
  const vectorElementCount = (svgText.match(/<(?:use|circle|path|polygon|polyline)\b/g) || []).length;
  const reportText = report.bytes.toString('utf8');
  try {
    const syntheticCount = db.prepare(`SELECT COUNT(*) AS count
      FROM artifact_revisions revision
      INNER JOIN scientific_change_sets change_set ON change_set.change_set_id=revision.change_set_id
      WHERE revision.project_id=? AND change_set.intent_ref LIKE 'p6-pressure-synthetic-alias:%'`)
      .get(runtime.project.id).count;
    return {
      table: {
        rows: tableRows,
        bytes: table.bytes.length,
        sha256: table.digest,
        jobArtifactHashProjection: table.jobArtifactHashProjection,
      },
      png: { ...pngTruth, jobArtifactHashProjection: png.jobArtifactHashProjection },
      svg: {
        bytes: svg.bytes.length,
        sha256: svg.digest,
        vectorElementCount,
        complex: svg.bytes.length >= 1_000_000 && vectorElementCount >= 10_000,
        jobArtifactHashProjection: svg.jobArtifactHashProjection,
      },
      report: {
        bytes: report.bytes.length,
        sha256: report.digest,
        headingCount: (reportText.match(/<h[1-3]\b/gi) || []).length,
        present: /<h1[^>]*>\s*GO\/KEGG 功能富集分析\s*<\/h1>/i.test(reportText),
        longVolumeProven: report.bytes.length >= 100_000,
        jobArtifactHashProjection: report.jobArtifactHashProjection,
        sqliteRevisionProjection: report.sqliteRevisionProjection,
      },
      artifactTruthValid: [real.volcano, real.enrichment].every((job) => (
        job.status === 'completed'
        && job.result?.artifactTruth?.status === 'valid'
        && job.result.artifactTruth.blocking !== true
      )),
      exactPhysicalHashes: true,
      sqliteFormalOutputRevisionsExact: [table, png, svg, report]
        .every((artifact) => artifact.sqliteRevisionProjection === 'measured'),
      sqliteSyntheticRevisionCount: Number(syntheticCount),
      sqliteMatchesPressureSummary: Number(syntheticCount) === pressure.summary.syntheticRevisionCount,
      jobResourceUsage: [real.volcano, real.enrichment].map((job) => ({
        toolClass: job.tool_id === 'volcano-plot' ? 'volcano' : 'go_bp_report',
        peakStatus: job.result?.resourceUsage?.peakStatus || 'unavailable',
        sampleCount: Number.isInteger(job.result?.resourceUsage?.sampling?.sampleCount)
          ? job.result.resourceUsage.sampling.sampleCount
          : null,
      })),
    };
  } finally {
    db.close();
  }
}

function readProjectRevisionDigest(dbPath, projectId) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return stableHash(db.prepare(`SELECT revision_id, artifact_family_id, artifact_id,
        parent_revision_ids_json, source_commit, tool_job_id, output_path, output_hash,
        change_set_id, revision_ordinal, is_current
      FROM artifact_revisions WHERE project_id=? ORDER BY artifact_family_id, revision_ordinal`)
      .all(projectId));
  } finally {
    db.close();
  }
}

async function waitForUrl(url, child, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error('p6_pressure_vite_exited');
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('p6_pressure_vite_timeout');
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function runElectron(configPath, resultPath, { show = false, backendPort }) {
  const stderr = [];
  const child = spawn(ELECTRON_PATH, [DRIVER_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      BIOF3_DESKTOP: '1',
      R_SERVER_PORT: String(backendPort),
      BIOF3_P6_PRESSURE_DRIVER_CONFIG: configPath,
      BIOF3_P6_PRESSURE_SHOW: show ? '1' : '0',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr.push(chunk);
    while (stderr.join('').length > 12_000) stderr.shift();
  });
  const exit = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: 'spawn_error' }));
  });
  if (exit.code !== 0 || !existsSync(resultPath)) {
    const persisted = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null;
    const error = new Error(`p6_pressure_electron_failed:${persisted?.failedStage || 'unknown'}`);
    error.detail = stderr.join('').slice(-4_000);
    throw error;
  }
  return JSON.parse(readFileSync(resultPath, 'utf8'));
}

function check(id, passed, observed, limit = null) {
  return { id, passed: passed === true, observed, ...(limit == null ? {} : { limit }) };
}

function withinBudget(value, limit) {
  return Number.isFinite(value) && value >= 0 && value <= limit;
}

export function buildP6ElectronPressureVerdict(observation) {
  const renderer = observation?.renderer || {};
  const truth = observation?.truth || {};
  const pressure = observation?.pressure || {};
  const firstCanvas = renderer.table?.canvasFirstVisibleMs;
  const pngReady = renderer.media?.png?.rendered === true && (
    (renderer.media?.png?.renderMode === 'source_image'
      && renderer.media?.png?.naturalWidth > 0
      && renderer.media?.png?.naturalHeight > 0)
    || (renderer.media?.png?.renderMode === 'scientific_interaction'
      && renderer.media?.png?.pointCount > 0)
  ) && renderer.media?.png?.sourceTargetMatched === true
    && renderer.media?.png?.artifactTargetMatched === true;
  const rendererRawReadiness = {
    tableRows: renderer.table?.totalRows === P6_ELECTRON_PRESSURE_ROWS,
    scroll: renderer.table?.scrollChanged === true,
    selection: renderer.table?.selectionChanged === true,
    sort: renderer.table?.sortChanged === true,
    filter: renderer.table?.filterChanged === true
      && renderer.table?.filterQueryChanged === true
      && (renderer.table?.filterMatchedSummaryChanged === true
        || renderer.table?.filterFirstVisibleRowChanged === true),
    virtualPage: renderer.table?.virtualPageChanged === true,
    pngSwitch: renderer.media?.png?.switch?.changed === true,
    svgExport: renderer.media?.svg?.exportLinkPresent === true
      && renderer.media?.svg?.validSvgRoot === true,
    png: pngReady,
    svg: renderer.media?.svg?.exportLinkPresent === true
      && renderer.media?.svg?.validSvgRoot === true
      && renderer.media?.svg?.sourceTargetMatched === true
      && renderer.media?.svg?.artifactTargetMatched === true,
    report: renderer.media?.report?.iframeVisible === true
      && renderer.media?.report?.iframeWidth > 0
      && renderer.media?.report?.iframeHeight > 0
      && renderer.media?.report?.textCharacters >= 100
      && renderer.media?.report?.embeddedImageCount >= 1
      && renderer.media?.report?.firstEmbeddedImageWidth > 0
      && renderer.media?.report?.sourceTargetMatched === true
      && renderer.media?.report?.artifactTargetMatched === true,
    compare: renderer.compare?.progressiveRows >= 200,
    history: renderer.history?.firstPageVersions >= 100
      && renderer.history?.afterPaginationVersions > renderer.history?.firstPageVersions,
    publicProjection: renderer.publicProjectionSampleCount >= 7
      && renderer.publicProjectionAudit?.absolutePath === false
      && renderer.publicProjectionAudit?.providerMaterial === false
      && renderer.publicProjectionAudit?.rawInternalId === false,
    backendStatus: renderer.backendStatus?.checkCount > 0
      && renderer.backendStatus?.everyCheckReady === true,
    artifactNetwork: renderer.artifactNetwork?.errorCount === 0
      && renderer.artifactNetwork?.events?.some((event) => (
        event?.artifactName === 'volcano.svg'
        && event?.outcome === 'completed'
        && event?.statusCode === 200
      )) === true,
    rendererStable: renderer.renderProcessGoneCount === 0,
  };
  const artifactSwitchSamples = [
    renderer.media?.png?.switch?.feedbackMs,
    renderer.media?.svg?.fetchMs,
  ];
  const progressivePageSamples = Array.isArray(renderer.compare?.progressivePages)
    ? renderer.compare.progressivePages.slice(1).map((entry) => entry?.loadMs)
    : [];
  const checks = [
    check('P6EP-01', truth.artifactTruthValid === true && truth.exactPhysicalHashes === true
      && truth.sqliteFormalOutputRevisionsExact === true,
    truth.artifactTruthValid === true && truth.exactPhysicalHashes === true
      && truth.sqliteFormalOutputRevisionsExact === true),
    check('P6EP-02', truth.table?.rows === P6_ELECTRON_PRESSURE_ROWS,
      truth.table?.rows, P6_ELECTRON_PRESSURE_ROWS),
    check('P6EP-03', truth.svg?.complex === true && truth.png?.width > 0
      && truth.report?.present === true && truth.report?.longVolumeProven === true
      && truth.report?.sqliteRevisionProjection === 'measured',
    {
      svgComplex: truth.svg?.complex === true,
      pngWidth: truth.png?.width || 0,
      reportPresent: truth.report?.present === true,
      reportLongVolume: truth.report?.longVolumeProven === true,
      reportRevision: truth.report?.sqliteRevisionProjection || 'unavailable',
    }),
    check('P6EP-04', pressure.realJobBackedCohortCount >= 2 && pressure.projectToolJobCount === 2,
      { cohorts: pressure.realJobBackedCohortCount || 0, jobs: pressure.projectToolJobCount || 0 }),
    check('P6EP-05', pressure.syntheticRevisionCount >= P6_ELECTRON_PRESSURE_SYNTHETIC_REVISIONS
      && pressure.syntheticFamilyCount >= 3,
    { revisions: pressure.syntheticRevisionCount || 0, families: pressure.syntheticFamilyCount || 0 }),
    check('P6EP-06', pressure.immutableMutationRejected === true && pressure.immutableDigestStable === true,
      pressure.immutableMutationRejected === true && pressure.immutableDigestStable === true),
    check('P6EP-07', Object.values(rendererRawReadiness).every((value) => value === true),
      rendererRawReadiness),
    check('P6EP-08', renderer.compare?.progressiveRows >= 200,
      renderer.compare?.progressiveRows || 0, 200),
    check('P6EP-09', renderer.history?.firstPageVersions >= 100
      && renderer.history?.afterPaginationVersions > renderer.history?.firstPageVersions,
    { first: renderer.history?.firstPageVersions || 0, after: renderer.history?.afterPaginationVersions || 0 }),
    check('P6EP-10', withinBudget(firstCanvas, P6_ELECTRON_PRESSURE_BUDGETS.firstCanvasMs),
      firstCanvas, P6_ELECTRON_PRESSURE_BUDGETS.firstCanvasMs),
    check('P6EP-11', withinBudget(renderer.table?.scrollFeedbackMs,
      P6_ELECTRON_PRESSURE_BUDGETS.tableScrollFeedbackMs),
      renderer.table?.scrollFeedbackMs, P6_ELECTRON_PRESSURE_BUDGETS.tableScrollFeedbackMs),
    check('P6EP-12', withinBudget(renderer.table?.selectionFeedbackMs,
      P6_ELECTRON_PRESSURE_BUDGETS.selectionFeedbackMs),
      renderer.table?.selectionFeedbackMs, P6_ELECTRON_PRESSURE_BUDGETS.selectionFeedbackMs),
    check('P6EP-13', withinBudget(renderer.table?.sortFeedbackMs,
      P6_ELECTRON_PRESSURE_BUDGETS.sortFeedbackMs),
      renderer.table?.sortFeedbackMs, P6_ELECTRON_PRESSURE_BUDGETS.sortFeedbackMs),
    check('P6EP-14', withinBudget(renderer.table?.filterFeedbackMs,
      P6_ELECTRON_PRESSURE_BUDGETS.filterFeedbackMs),
      renderer.table?.filterFeedbackMs, P6_ELECTRON_PRESSURE_BUDGETS.filterFeedbackMs),
    check('P6EP-15', artifactSwitchSamples.length === 2
      && artifactSwitchSamples.every((value) => withinBudget(
        value,
        P6_ELECTRON_PRESSURE_BUDGETS.artifactSwitchMs,
      )), artifactSwitchSamples, P6_ELECTRON_PRESSURE_BUDGETS.artifactSwitchMs),
    check('P6EP-16', withinBudget(renderer.table?.virtualPageLoadMs,
      P6_ELECTRON_PRESSURE_BUDGETS.virtualPageLoadMs),
      renderer.table?.virtualPageLoadMs, P6_ELECTRON_PRESSURE_BUDGETS.virtualPageLoadMs),
    check('P6EP-17', withinBudget(renderer.media?.png?.loadMs,
      P6_ELECTRON_PRESSURE_BUDGETS.pngContentReadyMs),
      renderer.media?.png?.loadMs, P6_ELECTRON_PRESSURE_BUDGETS.pngContentReadyMs),
    check('P6EP-18', withinBudget(renderer.media?.svg?.loadMs,
      P6_ELECTRON_PRESSURE_BUDGETS.svgContentReadyMs),
      renderer.media?.svg?.loadMs, P6_ELECTRON_PRESSURE_BUDGETS.svgContentReadyMs),
    check('P6EP-19', withinBudget(renderer.media?.report?.loadMs,
      P6_ELECTRON_PRESSURE_BUDGETS.reportContentReadyMs),
      renderer.media?.report?.loadMs, P6_ELECTRON_PRESSURE_BUDGETS.reportContentReadyMs),
    check('P6EP-20', withinBudget(renderer.compare?.openMs,
      P6_ELECTRON_PRESSURE_BUDGETS.compareOpenMs),
      renderer.compare?.openMs, P6_ELECTRON_PRESSURE_BUDGETS.compareOpenMs),
    check('P6EP-21', progressivePageSamples.length === 3
      && progressivePageSamples.every((value) => withinBudget(
        value,
        P6_ELECTRON_PRESSURE_BUDGETS.progressivePageLoadMs,
      )), progressivePageSamples, P6_ELECTRON_PRESSURE_BUDGETS.progressivePageLoadMs),
    check('P6EP-22', withinBudget(renderer.history?.firstPageMs,
      P6_ELECTRON_PRESSURE_BUDGETS.historyFirstPageMs),
      renderer.history?.firstPageMs, P6_ELECTRON_PRESSURE_BUDGETS.historyFirstPageMs),
    check('P6EP-23', withinBudget(renderer.history?.paginationMs,
      P6_ELECTRON_PRESSURE_BUDGETS.historyPaginationMs),
      renderer.history?.paginationMs, P6_ELECTRON_PRESSURE_BUDGETS.historyPaginationMs),
    check('P6EP-24', withinBudget(renderer.memory?.peakPostGcGrowthBytes,
      P6_ELECTRON_PRESSURE_BUDGETS.rendererPostGcHeapGrowthBytes),
      renderer.memory?.peakPostGcGrowthBytes,
      P6_ELECTRON_PRESSURE_BUDGETS.rendererPostGcHeapGrowthBytes),
    check('P6EP-25', renderer.publicProjectionAudit?.absolutePath === false
      && renderer.publicProjectionAudit?.providerMaterial === false
      && renderer.publicProjectionAudit?.rawInternalId === false
      && renderer.publicProjectionSampleCount >= 7,
      {
        ...(renderer.publicProjectionAudit || {}),
        samples: renderer.publicProjectionSampleCount || 0,
      }),
    check('P6EP-26', observation?.revisionLedgerStableDuringElectron === true,
      observation?.revisionLedgerStableDuringElectron === true),
  ];
  return {
    checks,
    passed: checks.every((entry) => entry.passed),
    frozenBudgetCount: Object.keys(P6_ELECTRON_PRESSURE_BUDGETS).length,
    remainingGaps: [
      ...(truth.report?.longVolumeProven === true ? [] : ['long_report_volume_not_proven']),
      ...(truth.report?.sqliteRevisionProjection === 'measured'
        ? []
        : ['report_revision_projection_not_measured']),
      'provider_not_exercised_p7_exclusion',
      'packaged_app_not_exercised_p7_exclusion',
      'synthetic_revision_aliases_do_not_prove_201_distinct_tool_executions',
    ],
  };
}

export function assertP6ElectronPressureEvidenceWritable(evidence) {
  if (evidence?.classification !== P6_ELECTRON_PRESSURE_CLASSIFICATION
      || evidence?.qualificationEligible !== false
      || evidence?.p6CloseoutEligible !== false) {
    const error = new Error('p6_pressure_evidence_classification_invalid');
    error.code = 'p6_pressure_evidence_classification_invalid';
    throw error;
  }
  if (evidence?.sourceCommitMatchesSourceHashes !== true
      || evidence?.sourceBindingStableDuringObservation !== true) {
    const error = new Error('p6_pressure_source_binding_not_current');
    error.code = 'p6_pressure_source_binding_not_current';
    throw error;
  }
  const recomputed = buildP6ElectronPressureVerdict(evidence);
  const checksMatchObservation = JSON.stringify(evidence?.checks) === JSON.stringify(recomputed.checks);
  const budgetsMatchFrozen = JSON.stringify(evidence?.budgets) === JSON.stringify(P6_ELECTRON_PRESSURE_BUDGETS);
  if (evidence?.passed !== true || recomputed.passed !== true || !checksMatchObservation
      || !budgetsMatchFrozen || !Array.isArray(evidence?.checks)
      || evidence.checks.length !== 26 || evidence.checks.some((entry) => entry.passed !== true)) {
    const error = new Error('p6_pressure_observation_not_passed');
    error.code = 'p6_pressure_observation_not_passed';
    throw error;
  }
  assertSanitizedP6ElectronPressureEvidence(evidence);
  return true;
}

export function writeP6ElectronPressureEvidence(evidence, {
  makeDirectory = mkdirSync,
  write = writeFileSync,
} = {}) {
  assertP6ElectronPressureEvidenceWritable(evidence);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  makeDirectory(path.dirname(EVIDENCE_PATH), { recursive: true });
  write(EVIDENCE_PATH, serialized);
  return { bytes: Buffer.byteLength(serialized), digest: sha256(serialized) };
}

export async function observeP6ElectronPressure({
  writeEvidence = false,
  keep = false,
  show = false,
} = {}) {
  const sourceAtStart = getP6ElectronPressureSourceBinding();
  const backendPort = await freePort();
  const uiPort = await freePort(new Set([backendPort]));
  const root = mkdtempSync(path.join(tmpdir(), 'biof3-p6-electron-pressure-'));
  const configPath = path.join(root, 'driver-config.json');
  const resultPath = path.join(root, 'driver-result.json');
  let runtime = null;
  let vite = null;
  let electron = null;
  let cleaning = false;
  const cleanup = async () => {
    if (cleaning) return;
    cleaning = true;
    await stopChild(electron);
    await stopChild(vite);
    await runtime?.close({ removeRoot: !keep });
    if (!keep) rmSync(root, { recursive: true, force: true });
  };
  const signal = () => { void cleanup(); };
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    runtime = await createP5LiveScientificRuntime({
      port: backendPort,
      beforeStart: ({ env }) => {
        const rendererOrigin = `http://127.0.0.1:${uiPort}`;
        env.BIOF3_RENDERER_DEV_URL = rendererOrigin;
        env.BIOF3_TRUSTED_DESKTOP_ORIGINS = rendererOrigin;
      },
    });
    vite = spawn(process.execPath, [
      VITE_PATH,
      '--host', '127.0.0.1',
      '--port', String(uiPort),
      '--strictPort',
    ], {
      cwd: path.join(ROOT, 'frontend'),
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitForUrl(`http://127.0.0.1:${uiPort}`, vite);
    const real = await prepareRealPressureJobs(runtime);
    const pressure = stagePressureHistory(runtime, real);
    const truth = inspectPhysicalTruth(runtime, real, pressure);
    const revisionDigestBeforeElectron = readProjectRevisionDigest(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.id,
    );

    writeFileSync(configPath, `${JSON.stringify({
      uiBaseUrl: `http://127.0.0.1:${uiPort}`,
      backendBaseUrl: `http://127.0.0.1:${backendPort}`,
      projectId: runtime.project.id,
      conversationId: runtime.conversation.id,
      resultPath,
      show,
      targets: {
        table: artifactTarget(real.volcano, 'classified_table'),
        png: artifactTarget(real.volcano, 'volcano'),
        svg: artifactTarget(real.volcano, 'volcano_svg'),
        report: artifactTarget(real.enrichment, 'report'),
      },
    })}\n`, { mode: 0o600 });
    const stderr = [];
    electron = spawn(ELECTRON_PATH, [DRIVER_PATH], {
      cwd: ROOT,
      env: {
        ...process.env,
        BIOF3_DESKTOP: '1',
        R_SERVER_PORT: String(backendPort),
        BIOF3_P6_PRESSURE_DRIVER_CONFIG: configPath,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    electron.stderr.setEncoding('utf8');
    electron.stderr.on('data', (chunk) => {
      stderr.push(chunk);
      while (stderr.join('').length > 12_000) stderr.shift();
    });
    const exit = await new Promise((resolve) => {
      electron.once('exit', (code, exitSignal) => resolve({ code, signal: exitSignal }));
      electron.once('error', () => resolve({ code: null, signal: 'spawn_error' }));
    });
    if (exit.code !== 0 || !existsSync(resultPath)) {
      const persisted = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null;
      const error = new Error(`p6_pressure_electron_failed:${persisted?.failedStage || 'unknown'}`);
      error.detail = `${persisted ? JSON.stringify(persisted, null, 2) : ''}\n${stderr.join('').slice(-4_000)}`.trim();
      throw error;
    }
    const renderer = JSON.parse(readFileSync(resultPath, 'utf8'));
    const revisionDigestAfterElectron = readProjectRevisionDigest(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.id,
    );
    const sourceAtEnd = getP6ElectronPressureSourceBinding();
    const sourceBindingStableDuringObservation = sourceAtStart.bindingDigest === sourceAtEnd.bindingDigest;
    const core = {
      renderer,
      truth,
      pressure: pressure.summary,
      revisionLedgerStableDuringElectron: revisionDigestBeforeElectron === revisionDigestAfterElectron,
    };
    const verdict = buildP6ElectronPressureVerdict(core);
    const evidence = {
      schemaVersion: 1,
      planId: 'G0-RS-P6',
      slice: 'P6-1 bounded Electron pressure and multi-Revision observation',
      classification: P6_ELECTRON_PRESSURE_CLASSIFICATION,
      qualificationEligible: false,
      p6CloseoutEligible: false,
      providerEvidence: 'not_exercised',
      packagedAppEvidence: 'not_exercised',
      dependencyBoundary: {
        capabilityProvisioning: 'not_exercised',
        enrichmentLibraries: 'host_runtime_observed_through_completed_artifact_truth_job',
      },
      platform: `${process.platform}-${process.arch}`,
      sourceCommit: sourceAtStart.sourceCommit,
      sourceFiles: sourceAtStart.sourceFiles,
      sourceHashes: sourceAtStart.sourceHashes,
      sourceBindingDigest: sourceAtStart.bindingDigest,
      sourceCommitMatchesSourceHashes: sourceAtStart.sourceCommitMatchesSourceHashes,
      sourceMismatches: sourceAtStart.sourceMismatches,
      sourceBindingStableDuringObservation,
      input: real.input,
      truth,
      pressure: pressure.summary,
      renderer,
      revisionLedgerStableDuringElectron: core.revisionLedgerStableDuringElectron,
      budgets: P6_ELECTRON_PRESSURE_BUDGETS,
      checks: verdict.checks,
      remainingGaps: verdict.remainingGaps,
      passed: verdict.passed,
    };
    assertSanitizedP6ElectronPressureEvidence(evidence);
    if (writeEvidence) writeP6ElectronPressureEvidence(evidence);
    return evidence;
  } finally {
    process.removeListener('SIGINT', signal);
    process.removeListener('SIGTERM', signal);
    await cleanup();
  }
}

async function main() {
  const result = await observeP6ElectronPressure({
    writeEvidence: process.argv.includes('--write-evidence'),
    keep: process.argv.includes('--keep'),
    show: process.argv.includes('--show'),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    if (typeof error?.detail === 'string' && error.detail.trim()) {
      console.error(error.detail.trim());
    }
    process.exitCode = 1;
  });
}
