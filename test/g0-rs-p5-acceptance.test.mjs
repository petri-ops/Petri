import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  P5_GATE_TEST_FILES,
  P5_NO_SEED_TABLES,
  P5_SOURCE_FILES,
  allCandidateRevisionsValid,
  assertP5EvidenceWritable,
  assertP5NoSeedPrecondition,
  assertSanitizedP5Evidence,
  exactWorkflowGraph,
  getP5SourceBinding,
  svgIncludesColor,
  writeP5Evidence,
} from '../scripts/g0-rs-p5-acceptance.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = require(require.resolve('better-sqlite3', {
  paths: [path.join(ROOT, 'core/r-server'), ROOT],
}));

test('P5 SVG evidence recognizes equivalent rendered color encodings', () => {
  assert.equal(svgIncludesColor('<path fill="#d55e00"/>', '#D55E00'), true);
  assert.equal(svgIncludesColor('<path fill="rgb(213, 94, 0)"/>', '#d55e00'), true);
  assert.equal(svgIncludesColor('<path fill="rgb(83.529412%, 36.862745%, 0%)"/>', '#d55e00'), true);
  assert.equal(svgIncludesColor('<path fill="rgb(0%, 44.705882%, 69.803922%)"/>', '#0072b2'), true);
  assert.equal(svgIncludesColor('<path fill="rgb(213, 95, 0)"/>', '#d55e00'), false);
  assert.equal(svgIncludesColor('<metadata data-json-hex="23643535653030"/>', '#d55e00'), false);
});

test('P5 workflow evidence matches complete edge sets and accepts exact zero-edge graphs', () => {
  const single = {
    graphId: 'wfg_single',
    sourceDigest: 'a'.repeat(64),
    rootToolJobId: 'job_single',
    nodes: [{ id: 'job:job_single' }],
    edges: [],
    validationStatus: 'valid',
    integrityValid: true,
  };
  assert.equal(exactWorkflowGraph(
    { workflowGraphs: [single] },
    { graphId: single.graphId, sourceDigest: single.sourceDigest },
    { rootToolJobId: 'job_single', nodeIds: ['job:job_single'], edges: [] },
  ), true);

  const detailedNode = {
    id: 'job:job_single',
    toolJobId: 'job_single',
    toolId: 'gene-correlation',
    artifactIds: ['corr_matrix', 'heatmap'],
    provenanceHash: 'c'.repeat(64),
    dependsOn: [],
  };
  const detailed = { ...single, graphId: 'wfg_detailed', nodes: [detailedNode] };
  const detailedRef = { graphId: detailed.graphId, sourceDigest: detailed.sourceDigest };
  assert.equal(exactWorkflowGraph(
    { workflowGraphs: [detailed] },
    detailedRef,
    { rootToolJobId: 'job_single', nodes: [detailedNode], edges: [] },
  ), true);
  assert.equal(exactWorkflowGraph(
    { workflowGraphs: [{ ...detailed, nodes: [{ ...detailedNode, provenanceHash: 'd'.repeat(64) }] }] },
    detailedRef,
    { rootToolJobId: 'job_single', nodes: [detailedNode], edges: [] },
  ), false, 'node provenance drift must not satisfy exact workflow evidence');

  const branched = {
    ...single,
    graphId: 'wfg_branched',
    sourceDigest: 'b'.repeat(64),
    rootToolJobId: 'job_root',
    nodes: [{ id: 'job:job_root' }, { id: 'job:job_a' }, { id: 'job:job_b' }],
    edges: [
      { kind: 'artifact', fromNodeId: 'job:job_root', toNodeId: 'job:job_a' },
      { kind: 'selection', fromNodeId: 'job:job_root', toNodeId: 'job:job_b' },
    ],
  };
  const branchedRef = { graphId: branched.graphId, sourceDigest: branched.sourceDigest };
  const expected = {
    rootToolJobId: 'job_root',
    nodeIds: ['job:job_root', 'job:job_a', 'job:job_b'],
    edges: [
      { kind: 'artifact', fromNodeId: 'job:job_root', toNodeId: 'job:job_a' },
      { kind: 'selection', fromNodeId: 'job:job_root', toNodeId: 'job:job_b' },
    ],
  };
  assert.equal(exactWorkflowGraph({ workflowGraphs: [branched] }, branchedRef, expected), true);
  assert.equal(exactWorkflowGraph(
    { workflowGraphs: [branched] },
    branchedRef,
    { ...expected, edges: expected.edges.slice(0, 1) },
  ), false, 'a partial edge assertion must not underwrite a branched graph');
});

test('P5 candidate evidence treats multiple formal outputs from one Job as one producing Job ref', () => {
  const revisions = [
    {
      revisionId: 'rev_plot', artifactFamilyId: 'family_plot', artifactId: 'plot',
      toolJobId: 'job_shared', validationStatus: 'valid', changeSetId: 'cs_shared',
    },
    {
      revisionId: 'rev_table', artifactFamilyId: 'family_table', artifactId: 'table',
      toolJobId: 'job_shared', validationStatus: 'valid', changeSetId: 'cs_shared',
    },
  ];
  assert.equal(allCandidateRevisionsValid({
    cohortRevisions: revisions,
    changeSet: {
      changeSetId: 'cs_shared',
      status: 'preview_ready',
      candidateArtifactRefs: revisions.map((revision) => revision.revisionId),
      jobRefs: ['job_shared'],
      validationSummary: { formalArtifactCount: 2, validatorIds: ['validator_v1'] },
    },
  }), true);
});

function createEmptyP5Ledger(root) {
  const dbPath = path.join(root, 'biof3.db');
  const db = new Database(dbPath);
  try {
    for (const table of P5_NO_SEED_TABLES) {
      db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
    }
  } finally {
    db.close();
  }
  return dbPath;
}

function sourceBoundEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    workPackage: 'G0-RS-P5',
    sourceCommit: 'a'.repeat(40),
    sourceFiles: { acceptance: 'scripts/g0-rs-p5-acceptance.mjs' },
    sourceHashes: { acceptance: 'b'.repeat(64) },
    sourceCommitMatchesSourceHashes: true,
    qualificationEligible: false,
    checks: { realJourney: true },
    passed: true,
    ...overrides,
  };
}

test('P5 refuses an occupied disposable product ledger before any journey write', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'biof3-p5-no-seed-'));
  try {
    const dbPath = createEmptyP5Ledger(root);
    const clean = assertP5NoSeedPrecondition(dbPath, { root });
    assert.deepEqual(clean.seededTables, []);
    assert.deepEqual(Object.values(clean.tableCounts), Array(P5_NO_SEED_TABLES.length).fill(0));

    const db = new Database(dbPath);
    try {
      db.prepare('INSERT INTO projects (id) VALUES (?)').run('p_seeded');
    } finally {
      db.close();
    }
    assert.throws(
      () => assertP5NoSeedPrecondition(dbPath, { root }),
      (error) => error.message === 'p5_seeded_product_records_present'
        && error.detail?.seededTables?.includes('projects'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('P5 no-seed check fails closed for missing tables and a database outside the disposable root', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'biof3-p5-no-seed-'));
  const otherRoot = mkdtempSync(path.join(tmpdir(), 'biof3-p5-other-'));
  try {
    const dbPath = createEmptyP5Ledger(root);
    const db = new Database(dbPath);
    try {
      db.exec('DROP TABLE tool_jobs');
    } finally {
      db.close();
    }
    assert.throws(
      () => assertP5NoSeedPrecondition(dbPath, { root }),
      (error) => error.message === 'p5_no_seed_required_tables_missing'
        && error.detail?.missingTables?.includes('tool_jobs'),
    );
    assert.throws(
      () => assertP5NoSeedPrecondition(dbPath, { root: otherRoot }),
      /p5_no_seed_database_not_disposable/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(otherRoot, { recursive: true, force: true });
  }
});

test('P5 source binding contains every declared focused test and direct execution source', () => {
  const paths = Object.values(P5_SOURCE_FILES);
  assert.equal(new Set(paths).size, paths.length, 'source binding must not hide duplicate aliases');
  for (const file of paths) {
    assert.equal(path.isAbsolute(file), false, `${file} must remain repository-relative`);
    assert.equal(file.includes('..'), false, `${file} must not escape the repository`);
  }
  for (const [key, file] of Object.entries(P5_GATE_TEST_FILES)) {
    assert.equal(P5_SOURCE_FILES[key], file, `${key} must be source-bound with the P5 gate`);
  }
  for (const file of [
    'scripts/g0-rs-p5-acceptance.mjs',
    'test/g0-rs-p5-acceptance.test.mjs',
    'package.json',
    'frontend/package.json',
    'test/impact-map.json',
    'core/shared-backend/git-adapter.js',
    'core/shared-backend/git-repository-binding.js',
    'core/r-server/routes/tools-platform.js',
    'core/r-server/plugin-loader.js',
    'resources/built-in-plugins/deseq2/scripts/deseq2.R',
    'resources/built-in-plugins/go-kegg/demo-data/genes.csv',
  ]) {
    assert.ok(paths.includes(file), `${file} must be bound to P5 evidence`);
  }

  const binding = getP5SourceBinding();
  assert.deepEqual(binding.sourceFiles, P5_SOURCE_FILES);
  assert.match(binding.sourceCommit, /^[a-f0-9]{40}$/);
  for (const hash of Object.values(binding.sourceHashes)) assert.match(hash, /^[a-f0-9]{64}$/);
});

test('P5 package gate runs every source-bound focused test and both source-bound frontend tests', () => {
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const nodeGate = packageJson.scripts?.['g0:result-studio:p5:test'];
  const frontendGate = packageJson.scripts?.['g0:result-studio:p5:frontend'];
  assert.equal(typeof nodeGate, 'string');
  assert.equal(typeof frontendGate, 'string');
  assert.match(nodeGate, /test\/g0-rs-p5-acceptance\.test\.mjs/);
  for (const file of Object.values(P5_GATE_TEST_FILES)) {
    assert.ok(nodeGate.includes(file), `${file} must be run by the P5 Node gate`);
  }
  for (const file of [
    P5_SOURCE_FILES.changeSetPanelTest,
    P5_SOURCE_FILES.resultVersionRoleTest,
    P5_SOURCE_FILES.resultStudioSurfaceTest,
  ]) {
    assert.ok(frontendGate.includes(path.basename(file)), `${file} must be run by the P5 frontend gate`);
  }
});

test('P5 sanitizer rejects secret-bearing fields and runtime coordinates', () => {
  assert.equal(assertSanitizedP5Evidence(sourceBoundEvidence()), true);
  assert.equal(assertSanitizedP5Evidence({
    seedPolicy: 'input fixtures only; product ledgers start empty',
    executionTruthChain: ['registered_tool_execution', 'durable_execution_record'],
  }), true);
  for (const unsafe of [
    { authorization: 'Bearer private' },
    { endpoint: 'http://127.0.0.1:3001/api/health' },
    { workspace: '/Users/example/private/result.csv' },
    { revision: 'rev_private123' },
    { relativePath: '../outside' },
  ]) {
    assert.throws(() => assertSanitizedP5Evidence(unsafe), /unsafe|leaked/);
  }
});

test('P5 evidence writer only serializes source-bound, passing, sanitized evidence', () => {
  const directories = [];
  const writes = [];
  const evidence = sourceBoundEvidence();
  const receipt = writeP5Evidence(evidence, {
    makeDirectory: (...args) => directories.push(args),
    write: (...args) => writes.push(args),
  });
  assert.equal(directories.length, 1);
  assert.equal(writes.length, 1);
  assert.match(writes[0][0], /acceptance[\\/]g0-result-studio[\\/]rs-p5-scientific-editing\.json$/);
  assert.deepEqual(JSON.parse(writes[0][1]), evidence);
  assert.equal(receipt.bytes, Buffer.byteLength(writes[0][1]));
  assert.match(receipt.digest, /^[a-f0-9]{64}$/);

  assert.throws(
    () => assertP5EvidenceWritable(sourceBoundEvidence({ sourceCommitMatchesSourceHashes: false })),
    (error) => error.code === 'p5_source_binding_not_current',
  );
  assert.throws(
    () => assertP5EvidenceWritable(sourceBoundEvidence({ passed: false })),
    (error) => error.code === 'p5_evidence_not_passed',
  );
  assert.throws(
    () => writeP5Evidence(sourceBoundEvidence({ apiKey: 'private' }), {
      makeDirectory() {},
      write() {},
    }),
    /unsafe evidence key/,
  );
});
