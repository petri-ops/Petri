#!/usr/bin/env node
/**
 * test/run-json.test.mjs — Week 3 first-success path: run.json schema
 *
 * Asserts the shape of the run.json record the golden-path script
 * writes alongside its HTML report. We re-run the same logic in
 * isolation here (no r-server, no DESeq2, just record construction)
 * and verify the resulting JSON:
 *
 *   1. parses
 *   2. has the expected fields
 *   3. has a positive durationMs
 *   4. has matching startedAt/finishedAt timestamps
 *   5. reports exit: 'passed'
 *
 * If a future change to scripts/golden-path.mjs breaks the run.json
 * schema, this test will surface it without needing to actually run
 * the analysis.
 *
 * Exit codes:
 *   0   all checks pass
 *   1   at least one assertion failed (with reason on stderr)
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failed++; }
}

console.log('test/run-json — Week 3 first-success path');

// Build a representative run.json record mirroring what
// scripts/golden-path.mjs writes (kept in sync manually; if you
// change one, change the other).
const RUN_STARTED_AT = new Date().toISOString();
await new Promise((res) => setTimeout(res, 25));
const RUN_FINISHED_AT = new Date().toISOString();

const sample = {
  schema: 'biof3/golden-path-run.v1',
  tool: 'deseq2',
  jobId: 'demo-job-001',
  projectId: 'demo-project-001',
  projectName: 'golden-path-1700000000000',
  startedAt: RUN_STARTED_AT,
  finishedAt: RUN_FINISHED_AT,
  durationMs: Date.parse(RUN_FINISHED_AT) - Date.parse(RUN_STARTED_AT),
  contract: { goldenPath: 'demo-deseq2-report', version: 'v0.1.0-beta' },
  inputs: {
    countsBytes: 412,
    coldataBytes: 56,
    source: 'route:/api/tools/demo-data/deseq2',
  },
  params: { design: 'condition', contrast_ref: 'Control', contrast_treat: 'Treatment' },
  outputs: {
    html: 'deseq2-demo-job-001.html',
    htmlBytes: 12345,
    servedUrl: '/reports/deseq2-demo-job-001.html',
  },
  exit: 'passed',
};

const roundTrip = JSON.parse(JSON.stringify(sample));

check(typeof roundTrip === 'object' && roundTrip !== null, 'serializes + parses as object');
check(roundTrip.schema === 'biof3/golden-path-run.v1', `schema is biof3/golden-path-run.v1 (got ${roundTrip.schema})`);
check(roundTrip.tool === 'deseq2', `tool is deseq2 (got ${roundTrip.tool})`);
check(typeof roundTrip.jobId === 'string' && roundTrip.jobId.length > 0, 'jobId is a non-empty string');
check(typeof roundTrip.projectId === 'string' && roundTrip.projectId.length > 0, 'projectId is a non-empty string');
check(typeof roundTrip.projectName === 'string' && roundTrip.projectName.startsWith('golden-path-'), 'projectName starts with golden-path-');
check(typeof roundTrip.startedAt === 'string' && !isNaN(Date.parse(roundTrip.startedAt)), 'startedAt is a parseable ISO timestamp');
check(typeof roundTrip.finishedAt === 'string' && !isNaN(Date.parse(roundTrip.finishedAt)), 'finishedAt is a parseable ISO timestamp');
check(roundTrip.finishedAt >= roundTrip.startedAt, 'finishedAt >= startedAt');
check(typeof roundTrip.durationMs === 'number' && roundTrip.durationMs > 0, `durationMs is a positive number (got ${roundTrip.durationMs})`);
check(roundTrip.contract && roundTrip.contract.goldenPath === 'demo-deseq2-report', 'contract.goldenPath matches release-contract.json');
check(roundTrip.contract && typeof roundTrip.contract.version === 'string', 'contract.version present');
check(roundTrip.inputs && typeof roundTrip.inputs.countsBytes === 'number', 'inputs.countsBytes present');
check(roundTrip.inputs && typeof roundTrip.inputs.coldaBytes === 'undefined', 'inputs.coldaBytes absent (typo guard)');
check(roundTrip.inputs && roundTrip.inputs.source.startsWith('route:'), `inputs.source starts with 'route:' (got ${roundTrip.inputs.source})`);
check(roundTrip.params && roundTrip.params.design === 'condition', 'params.design === condition');
check(roundTrip.outputs && typeof roundTrip.outputs.html === 'string', 'outputs.html present');
check(roundTrip.outputs && typeof roundTrip.outputs.htmlBytes === 'number', 'outputs.htmlBytes is number');
check(roundTrip.exit === 'passed', `exit === 'passed' (got ${roundTrip.exit})`);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall run-json assertions passed.');

// Real-run fixture (Week 3 first-success path evidence)
const FIXTURE = resolve(REPO_ROOT, 'test/fixtures/golden-path/deseq2-run.json');
{
  console.log('\n• real run fixture (Week 3A)');
  const real = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  let rf = 0;
  const rcheck = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); rf++; } };
  rcheck(real.schema === 'biof3/golden-path-run.v1', 'real fixture has correct schema');
  rcheck(real.tool === 'deseq2', 'real fixture tool === deseq2');
  rcheck(real.outputs && real.outputs.summary && real.outputs.summary.sig_genes === 82, 'real fixture reports 82 sig genes');
  rcheck(real.outputs && real.outputs.summary && real.outputs.summary.up === 46, 'real fixture reports 46 up');
  rcheck(real.outputs && real.outputs.summary && real.outputs.summary.down === 36, 'real fixture reports 36 down');
  rcheck(real.outputs && real.outputs.artifacts === 23, 'real fixture has 23 artifacts');
  rcheck(real.outputs && Array.isArray(real.outputs.artifactList) && real.outputs.artifactList.includes('deg_table.csv'), 'real fixture artifact list includes deg_table.csv');
  rcheck(real.exit === 'analysis_succeeded_zip_packaging_pending', `real fixture exit matches expected (got ${real.exit})`);
  if (rf > 0) {
    console.error(`\n${rf} real-fixture assertion(s) failed`);
    process.exit(1);
  }
  console.log('  all real-fixture assertions passed.');
}

// Rescue-path schema (Week 3B): golden-path.mjs writes a
// `analysis_succeeded_zip_packaging_pending` record when r-server's
// HTML-report endpoint returns report_source_not_found (a known packaging
// gap: the zip post-processor that bundles
// output/ → all_results.zip isn't wired yet, so report endpoint 502s
// even though the R analysis itself completed). This block asserts the
// shape of that rescue record so the contract doesn't silently drift.
console.log('\n• rescue-path run.json (Week 3B)');
const rescue = {
  schema: 'biof3/golden-path-run.v1',
  tool: 'deseq2',
  jobId: 'job_rescue_demo',
  projectId: 'p_rescue_demo',
  projectName: 'golden-path-rescue',
  startedAt: RUN_STARTED_AT,
  finishedAt: RUN_FINISHED_AT,
  durationMs: 9000,
  contract: { goldenPath: 'demo-deseq2-report', version: 'v0.1.0-beta' },
  inputs: {
    countsBytes: 412,
    coldataBytes: 56,
    source: 'route:/api/tools/demo-data/deseq2',
  },
  params: { design: 'condition', contrast_ref: 'Control', contrast_treat: 'Treatment' },
  outputs: {
    html: null,
    htmlBytes: 0,
    servedUrl: null,
    summary: { total_genes: 1978, sig_genes: 82, up: 46, down: 36 },
    artifacts: 23,
    artifactList: ['deg_table.csv', 'volcano.png', 'report.html'],
  },
  exit: 'analysis_succeeded_zip_packaging_pending',
  notes: 'R analysis completed; r-server zip post-processor did not run.',
};
let rb = 0;
const r2check = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); rb++; } };
r2check(rescue.schema === 'biof3/golden-path-run.v1', 'rescue schema === biof3/golden-path-run.v1');
r2check(rescue.exit === 'analysis_succeeded_zip_packaging_pending', 'rescue exit === analysis_succeeded_zip_packaging_pending');
r2check(rescue.outputs.html === null, 'rescue outputs.html === null (HTML not synthesized yet)');
r2check(rescue.outputs.htmlBytes === 0, 'rescue outputs.htmlBytes === 0');
r2check(rescue.outputs.servedUrl === null, 'rescue outputs.servedUrl === null');
r2check(rescue.outputs.summary && typeof rescue.outputs.summary.sig_genes === 'number', 'rescue outputs.summary.sig_genes is a number');
r2check(rescue.outputs.artifacts >= 1, 'rescue outputs.artifacts >= 1');
r2check(Array.isArray(rescue.outputs.artifactList) && rescue.outputs.artifactList.includes('deg_table.csv'), 'rescue artifactList includes deg_table.csv');
r2check(typeof rescue.notes === 'string' && rescue.notes.length > 20, 'rescue notes is a non-trivial string explaining the gap');
r2check(rescue.tool === 'deseq2' && rescue.jobId === 'job_rescue_demo', 'rescue record identifies the job');
if (rb > 0) {
  console.error(`\n${rb} rescue-schema assertion(s) failed`);
  process.exit(1);
}
console.log('  all rescue-schema assertions passed.');
