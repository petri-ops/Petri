#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = join(root, 'acceptance/g0-result-studio/rs-p2-live-observation.json');
const SHA256 = /^[a-f0-9]{64}$/;

function sha(value) {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value)
    ? value : JSON.stringify(value)).digest('hex');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    parsed[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return parsed;
}

function required(args, key) {
  const value = String(args[key] || '').trim();
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${new URL(url).pathname}: ${raw.slice(0, 240)}`);
  return { data: JSON.parse(raw), responseSha256: sha(raw) };
}

function endpoint(base, pathname, query = null) {
  const url = new URL(pathname, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function interactionShape(response) {
  const manifest = response.data?.manifest || {};
  const backing = response.data?.backingTable || null;
  return {
    responseSha256: response.responseSha256,
    mode: manifest.interactionMode || 'read_only',
    entityType: manifest.entityType || null,
    durable: manifest.selectionDurable === true,
    backingRows: backing?.matchedCount ?? 0,
    backingEntityHashPresent: SHA256.test(backing?.selectionEvidence?.entityIdsHash || ''),
    revisionValid: response.data?.revision?.validationStatus === 'valid',
    reproducibilityAvailable: response.data?.revision?.reproducibilityStatus === 'available',
    sourceScriptHashPresent: SHA256.test(response.data?.revision?.sourceScriptRef?.sha256 || ''),
  };
}

function serverStartedAtMs(apiBase) {
  const port = new URL(apiBase).port;
  if (!port) return null;
  try {
    const pids = execFileSync('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
      .trim().split(/\s+/).filter(Boolean);
    if (pids.length !== 1) return null;
    const started = execFileSync('ps', ['-p', pids[0], '-o', 'lstart='], { encoding: 'utf8' }).trim();
    const parsed = Date.parse(started);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function materializationEvidence(downstream, expectedSelectionId, expectedCount) {
  const geneList = String(downstream?.params?.deg_table || '');
  if (!geneList || basename(geneList) !== 'gene-list.csv') throw new Error('downstream gene-list materialization is missing');
  const realGeneList = realpathSync(geneList);
  const materializationRoot = dirname(realGeneList);
  const parametersPath = join(materializationRoot, 'selection-ids.json');
  const scriptPath = join(materializationRoot, 'materialize-selection.R');
  if (!existsSync(parametersPath) || !existsSync(scriptPath)) throw new Error('independent selection script or parameters are missing');
  const parametersRaw = readFileSync(parametersPath, 'utf8');
  const scriptRaw = readFileSync(scriptPath, 'utf8');
  const geneRaw = readFileSync(realGeneList, 'utf8');
  const parameters = JSON.parse(parametersRaw);
  const entityIds = Array.isArray(parameters.entityIds) ? parameters.entityIds : [];
  const geneRows = geneRaw.trim().split(/\r?\n/).slice(1);
  if (parameters.selectionId !== expectedSelectionId || entityIds.length !== expectedCount || geneRows.length !== expectedCount) {
    throw new Error('selection materialization count or identity drifted');
  }
  if (!/write\.csv/.test(scriptRaw) || !/selection-ids\.json/.test(scriptRaw)) {
    throw new Error('selection materialization script is not independently reproducible');
  }
  return {
    independentFiles: 3,
    entityCount: entityIds.length,
    parameterSha256: sha(parametersRaw),
    scriptSha256: sha(scriptRaw),
    outputSha256: sha(geneRaw),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiBase = required(args, 'api-base');
  const parsedBase = new URL(apiBase);
  if (parsedBase.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsedBase.hostname)) {
    throw new Error('--api-base must be a loopback HTTP endpoint');
  }
  const projectId = required(args, 'project-id');
  const sourceJobId = required(args, 'source-job-id');
  const downstreamJobId = required(args, 'downstream-job-id');
  const selectionId = required(args, 'selection-id');

  const [sourceStatus, downstreamStatus, deg, volcano, heatmap, enrichment] = await Promise.all([
    fetchJson(endpoint(apiBase, `/api/tools/status/${encodeURIComponent(sourceJobId)}`)),
    fetchJson(endpoint(apiBase, `/api/tools/status/${encodeURIComponent(downstreamJobId)}`)),
    fetchJson(endpoint(apiBase, '/api/result-studio/interaction', { jobId: sourceJobId, artifact: 'deg_table.csv' })),
    fetchJson(endpoint(apiBase, '/api/result-studio/interaction', { jobId: sourceJobId, artifact: 'volcano.png' })),
    fetchJson(endpoint(apiBase, '/api/result-studio/interaction', { jobId: sourceJobId, artifact: 'heatmap.png' })),
    fetchJson(endpoint(apiBase, '/api/result-studio/interaction', { jobId: downstreamJobId, artifact: 'go_bp_results.csv' })),
  ]);
  const revisionId = deg.data?.manifest?.revisionId;
  const artifactId = deg.data?.manifest?.artifactId;
  const selection = await fetchJson(endpoint(apiBase, '/api/result-studio/selection/current', {
    projectId,
    artifactId,
    revisionId,
    selectionDurable: true,
  }));
  const sourceQuery = await fetchJson(endpoint(apiBase, '/api/result-studio/table/query'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: sourceJobId, artifact: 'deg_table.csv', offset: 0, limit: 10 }),
  });
  const enrichmentQuery = await fetchJson(endpoint(apiBase, '/api/result-studio/table/query'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: downstreamJobId, artifact: 'go_bp_results.csv', offset: 0, limit: 10 }),
  });

  const source = sourceStatus.data;
  const downstream = downstreamStatus.data;
  const persisted = selection.data?.selection || {};
  const sourceTruth = source?.result?.artifactTruth || {};
  const downstreamTruth = downstream?.result?.artifactTruth || {};
  const serverStart = serverStartedAtMs(apiBase);
  const selectionCreated = Date.parse(persisted.createdAt || '');
  const recoveredAcrossServerRestart = Number.isFinite(serverStart)
    && Number.isFinite(selectionCreated) && selectionCreated < serverStart;
  const materialization = materializationEvidence(downstream, selectionId, persisted.entityIdCount);
  const interactions = {
    degTable: interactionShape(deg),
    volcano: interactionShape(volcano),
    heatmap: interactionShape(heatmap),
    enrichmentTable: interactionShape(enrichment),
  };

  const checks = {
    sourceJobValid: source.projectId === projectId && source.toolId === 'deseq2'
      && source.status === 'completed' && sourceTruth.status === 'valid' && sourceTruth.issueCount === 0,
    downstreamJobValid: downstream.projectId === projectId && downstream.toolId === 'go-kegg'
      && downstream.status === 'completed' && downstreamTruth.status === 'valid' && downstreamTruth.issueCount === 0,
    formalChainOrdered: Number(downstream.createdAt) > Number(source.completedAt),
    selectionCompatible: persisted.selectionId === selectionId && persisted.projectId === projectId
      && persisted.artifactId === artifactId && persisted.revisionId === revisionId
      && persisted.entityType === 'gene' && persisted.entityIdCount >= 3
      && SHA256.test(persisted.entityIdsHash || '') && selection.data?.compatibility?.status === 'compatible',
    restartRecovery: recoveredAcrossServerRestart,
    tableMapping: interactions.degTable.mode === 'table' && interactions.degTable.entityType === 'gene'
      && interactions.degTable.durable && interactions.degTable.revisionValid,
    scatterMapping: interactions.volcano.mode === 'scatter' && interactions.volcano.entityType === 'gene'
      && interactions.volcano.durable && interactions.volcano.backingRows > 0,
    matrixMapping: interactions.heatmap.mode === 'matrix' && interactions.heatmap.entityType === 'gene'
      && interactions.heatmap.durable && interactions.heatmap.backingRows > 0,
    enrichmentMapping: interactions.enrichmentTable.mode === 'table'
      && interactions.enrichmentTable.entityType === 'pathway' && interactions.enrichmentTable.durable,
    authoritativeQueries: sourceQuery.data?.selectionEvidence?.entityIdCount > 0
      && SHA256.test(sourceQuery.data?.selectionEvidence?.entityIdsHash || '')
      && enrichmentQuery.data?.selectionEvidence?.entityIdCount > 0
      && SHA256.test(enrichmentQuery.data?.selectionEvidence?.entityIdsHash || ''),
    independentMaterialization: materialization.independentFiles === 3
      && materialization.entityCount === persisted.entityIdCount,
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([id]) => id);
  if (failed.length > 0) throw new Error(`live observation failed: ${failed.join(', ')}`);

  const observation = {
    schemaVersion: 1,
    workPackage: 'G0-RS-P2',
    evidenceClass: 'live_local_product_observation_non_qualifying',
    capturedAt: new Date().toISOString(),
    qualificationEligible: false,
    privacy: 'digests_counts_timings_and_bounded_statuses_only_no_ids_urls_paths_credentials_prompts_or_result_values',
    scopeDigest: sha([projectId, sourceJobId, downstreamJobId, selectionId].join(':')),
    responseDigests: {
      sourceStatus: sourceStatus.responseSha256,
      downstreamStatus: downstreamStatus.responseSha256,
      selection: selection.responseSha256,
      sourceQuery: sourceQuery.responseSha256,
      enrichmentQuery: enrichmentQuery.responseSha256,
    },
    jobs: {
      source: { tool: 'deseq2', truth: sourceTruth.status, artifactCount: sourceTruth.validCount },
      downstream: { tool: 'go-kegg', truth: downstreamTruth.status, artifactCount: downstreamTruth.validCount },
      formalChain: 'run_tool -> tool_job -> artifact_truth',
    },
    selection: {
      entityType: persisted.entityType,
      entityCount: persisted.entityIdCount,
      entityIdsHash: persisted.entityIdsHash,
      compatibility: selection.data.compatibility.status,
      recoveredAcrossServerRestart,
      createdBeforeServerStartMs: recoveredAcrossServerRestart ? serverStart - selectionCreated : null,
    },
    interactions,
    authoritativeTables: {
      sourceRows: sourceQuery.data.totalRows,
      sourceEntityCount: sourceQuery.data.selectionEvidence.entityIdCount,
      enrichmentRows: enrichmentQuery.data.totalRows,
      enrichmentEntityCount: enrichmentQuery.data.selectionEvidence.entityIdCount,
    },
    materialization,
    checks,
    passed: true,
  };
  writeFileSync(outputPath, `${JSON.stringify(observation, null, 2)}\n`);
  console.log(`[G0-RS-P2] PASS — live observation captured (${Object.keys(checks).length}/${Object.keys(checks).length})`);
}

main().catch((error) => {
  console.error(`[G0-RS-P2] FAIL — ${error.message}`);
  process.exitCode = 1;
});
