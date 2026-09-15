#!/usr/bin/env node

/**
 * P4R-5 source-bound observation.  This is deliberately separate from the
 * fast product gate: it runs the real disposable corpus (including GO/KEGG),
 * creates the formal Revision through the interaction route, then reads the
 * exact source projection for each artifact class.  Only bounded digests and
 * statuses are persisted.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCorpus } from './g0-rs-p4r-corpus.mjs';
import { createCaptureEnv, startServer, stopServer } from './g0-rs-p4r-capture.mjs';
import { buildPackEnv, resolveBioPackRoot } from './g0-rs-p4r-pack.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(rootDir, 'acceptance/g0-result-studio/rs-p4r-source-observation.json');
/** 桌面仓文件：commit 绑定（git show 对账）。 */
const sourceFiles = Object.freeze({
  observation: 'scripts/g0-rs-p4r-source-observation.mjs',
  corpus: 'scripts/g0-rs-p4r-corpus.mjs',
  routes: 'core/biof3-server/routes/result-studio.js',
  sourceProjection: 'core/shared-backend/result-revision-source.js',
  replayService: 'core/shared-backend/result-replay-service.js',
});
/** 插件定义/脚本自 BLOCK-83 起随领域包交付：包相对路径绑定，包 commit+哈希留痕。 */
const packSourceFiles = Object.freeze({
  deseq2Definition: 'plugins/deseq2/tool-definition.json',
  deseq2Script: 'plugins/deseq2/scripts/deseq2.R',
  volcanoDefinition: 'plugins/volcano-plot/tool-definition.json',
  volcanoScript: 'plugins/volcano-plot/scripts/volcano-plot.R',
  correlationDefinition: 'plugins/gene-correlation/tool-definition.json',
  correlationScript: 'plugins/gene-correlation/scripts/gene-correlation.R',
  enrichmentDefinition: 'plugins/go-kegg/tool-definition.json',
  enrichmentScript: 'plugins/go-kegg/scripts/go-kegg.R',
});
const hash = (value) => createHash('sha256').update(value).digest('hex');

function sourceBinding(packRoot) {
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
  const sourceHashes = Object.fromEntries(Object.entries(sourceFiles).map(([key, file]) => [
    key,
    hash(readFileSync(path.join(rootDir, file))),
  ]));
  const mismatches = Object.entries(sourceFiles).filter(([key, file]) => {
    const shown = spawnSync('git', ['show', `${sourceCommit}:${file}`], { cwd: rootDir });
    return shown.status !== 0 || hash(shown.stdout) !== sourceHashes[key];
  }).map(([, file]) => file);
  const packCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: packRoot, encoding: 'utf8' }).trim();
  const packHashes = Object.fromEntries(Object.entries(packSourceFiles).map(([key, file]) => [
    key,
    hash(readFileSync(path.join(packRoot, file))),
  ]));
  const packMismatches = Object.entries(packSourceFiles).filter(([key, file]) => {
    const shown = spawnSync('git', ['show', `${packCommit}:${file}`], { cwd: packRoot });
    return shown.status !== 0 || hash(shown.stdout) !== packHashes[key];
  }).map(([, file]) => file);
  return {
    sourceCommit,
    sourceFiles,
    sourceHashes,
    sourceCommitMatchesSourceHashes: mismatches.length === 0,
    sourceMismatches: mismatches,
    pack: {
      root: packRoot,
      commit: packCommit,
      files: packSourceFiles,
      hashes: packHashes,
      commitMatchesSourceHashes: packMismatches.length === 0,
      mismatches: packMismatches,
    },
  };
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function pick(outputs, patterns) {
  const entries = Object.entries(outputs || {});
  const found = entries.find(([name]) => patterns.some((pattern) => pattern.test(name)));
  return found ? found[0] : null;
}

async function observe() {
  const { root, env } = createCaptureEnv({ port: 0 });
  let server;
  try {
    const corpus = await generateCorpus({ root, keep: true, withEnrichment: true, quiet: true });
    if (!corpus.ok) throw new Error(`corpus_incomplete:${JSON.stringify(corpus.records)}`);
    // BLOCK-83/86 package awareness: server sees the pack sources the corpus child ran with.
    Object.assign(env, buildPackEnv({ captureRoot: root, toolIds: corpus.pack.stagedToolIds }).env);
    env.R_SERVER_PORT = String(await freePort());
    server = await startServer(env);
    const d = corpus.outputs.deseq2 || {};
    const v = corpus.outputs['volcano-plot'] || {};
    const h = corpus.outputs['gene-correlation'] || {};
    const e = corpus.outputs['go-kegg'] || {};
    const targets = [
      { kind: 'deseq2_deg_table', job: 'deseq2', artifact: pick(d, [/deg_table/i, /deg.*\.csv$/i]) },
      { kind: 'standalone_volcano', job: 'volcano-plot', artifact: pick(v, [/volcano/i, /\.png$/i]) },
      { kind: 'gene_correlation_heatmap', job: 'gene-correlation', artifact: pick(h, [/heatmap/i, /\.png$/i]) },
      { kind: 'go_kegg_enrichment', job: 'go-kegg', artifact: pick(e, [/go.*results/i, /kegg.*results/i, /\.csv$/i]) },
    ];
    const byId = new Map(corpus.records.map((record) => [record.id, record]));
    const observations = [];
    for (const target of targets) {
      const record = byId.get(target.job);
      if (!record || !target.artifact) {
        observations.push({ kind: target.kind, status: 'unavailable', reason: 'artifact_not_found' });
        continue;
      }
      const interactionUrl = `${server.baseUrl}/api/result-studio/interaction?projectId=${encodeURIComponent(corpus.projectId)}&jobId=${encodeURIComponent(record.toolJobId)}&artifact=${encodeURIComponent(target.artifact)}`;
      const interaction = await fetch(interactionUrl);
      const interactionJson = await interaction.json().catch(() => ({}));
      const revisionId = interactionJson.revision?.revisionId || interactionJson.revision?.id || null;
      if (!interaction.ok || !revisionId) {
        observations.push({
          kind: target.kind,
          artifact: target.artifact,
          status: 'failed',
          httpStatus: interaction.status,
          error: interactionJson.error || 'revision_not_created',
          diagnostics: Array.isArray(interactionJson.manifest?.diagnostics)
            ? interactionJson.manifest.diagnostics.map((item) => ({ code: item?.code || null, message: item?.message || null }))
            : [],
        });
        continue;
      }
      const source = await fetch(`${server.baseUrl}/api/result-studio/revisions/${encodeURIComponent(revisionId)}/source?projectId=${encodeURIComponent(corpus.projectId)}`);
      const sourceJson = await source.json().catch(() => ({}));
      observations.push({
        kind: target.kind,
        artifact: target.artifact,
        status: source.ok && sourceJson.sha256 && sourceJson.content ? 'verified' : 'failed',
        sourceStatus: source.status,
        sourceSha256: sourceJson.sha256 || null,
        sourceScope: sourceJson.scope || null,
        reproductionStatus: sourceJson.reproduction?.status || null,
        formalJobCompleted: record.ok === true,
      });
    }
    const packRoot = resolveBioPackRoot();
    if (!packRoot) throw new Error('bio pack not found (BIOF3_BIO_PACK_ROOT or sibling gewu-pack-bio)');
    const binding = sourceBinding(packRoot);
    const result = {
      schemaVersion: 1,
      workPackage: 'G0-RS-P4R-5',
      qualificationEligible: false,
      ...binding,
      projectBound: true,
      executionTruthChain: ['run_tool', 'tool_job', 'artifact_truth', 'artifact_revision', 'revision_source'],
      observations,
      allFourVerified: observations.length === 4 && observations.every((item) => item.status === 'verified'),
    };
    result.passed = result.allFourVerified
      && result.sourceCommitMatchesSourceHashes
      && result.pack.commitMatchesSourceHashes;
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    if (server) await stopServer(server.child);
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}

observe().then((result) => {
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
