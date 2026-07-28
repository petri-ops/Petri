#!/usr/bin/env node

/**
 * P4R-5 source-bound observation.  This is deliberately separate from the
 * fast product gate: it runs the real disposable corpus (including GO/KEGG),
 * creates the formal Revision through the interaction route, then reads the
 * exact source projection for each artifact class.  Only bounded digests and
 * statuses are persisted.
 */
import { createServer } from 'node:net';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCorpus } from './g0-rs-p4r-corpus.mjs';
import { createCaptureEnv, startServer, stopServer } from './g0-rs-p4r-capture.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(rootDir, 'acceptance/g0-result-studio/rs-p4r-source-observation.json');

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
        observations.push({ kind: target.kind, artifact: target.artifact, status: 'failed', httpStatus: interaction.status, error: interactionJson.error || 'revision_not_created' });
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
      });
    }
    const result = {
      schemaVersion: 1,
      workPackage: 'G0-RS-P4R-5',
      qualificationEligible: false,
      sourceCommit: 'runtime-observation',
      projectBound: true,
      observations,
      allFourVerified: observations.length === 4 && observations.every((item) => item.status === 'verified'),
    };
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    if (server) await stopServer(server.child);
  }
}

observe().then((result) => {
  console.log(JSON.stringify(result, null, 2));
  if (!result.allFourVerified) process.exitCode = 1;
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
