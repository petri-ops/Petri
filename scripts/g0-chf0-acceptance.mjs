#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const evidenceDir = join(repoRoot, 'acceptance/g0-critical-crosscut-hardening');
const files = [
  'package.json',
  'src/main.js',
  'core/r-server/bootstrap.js',
  'core/r-server/db.js',
  'core/r-server/helpers/local-request-boundary.js',
  'core/r-server/helpers/process-lifecycle.js',
  'core/r-server/helpers/tools-executor.js',
  'core/r-server/routes/files.js',
  'core/r-server/routes/r-compute.js',
  'core/r-server/routes/tools-platform.js',
  'core/shared-backend/local-request-boundary.js',
  'core/shared-backend/storage/local-storage.js',
  'resources/built-in-plugins/pca-explorer/scripts/pca-explorer.py',
  'resources/built-in-plugins/pca-explorer/tool-definition.json',
  'resources/built-in-plugins/volcano-plot/scripts/volcano-plot.R',
  'resources/built-in-plugins/volcano-plot/README.md',
  'resources/built-in-plugins/volcano-plot/acceptance.json',
  'resources/built-in-plugins/volcano-plot/golden-revisions/result-studio-v1.json',
  'resources/built-in-plugins/volcano-plot/plugin.json',
  'resources/built-in-plugins/volcano-plot/tool-definition.json',
  'resources/built-in-plugins/volcano-plot/volcano-plot-report-template.html',
  'resources/built-in-plugins/volcano-plot/demo-data/demo_deg.csv',
  'test/g0-chf0-http.test.mjs',
  'test/g0-chf0-science.test.mjs',
  'test/g0-chf0-lifecycle.test.mjs',
  'test/impact-map.json',
  'scripts/g0-chf0-acceptance.mjs',
];

const contracts = [
  {
    id: 'CHF0-SEC-1',
    assertion: 'R/Python raw execution and replot code routes fail closed for non-BioF3 origins',
    testFile: 'test/g0-chf0-http.test.mjs',
    pattern: 'CHF0 SEC-1',
  },
  {
    id: 'CHF0-SEC-2',
    assertion: 'Real /api/files routing rejects foreign origins, traversal, absolute paths and symlink escape',
    testFile: 'test/g0-chf0-http.test.mjs',
    pattern: 'CHF0 SEC-2',
  },
  {
    id: 'CHF0-SCI-1',
    assertion: 'Volcano default/explicit padj, explicit raw pvalue, invalid values and output labels are honest',
    testFile: 'test/g0-chf0-science.test.mjs',
    pattern: 'CHF0 SCI-1',
  },
  {
    id: 'CHF0-SCI-2-3',
    assertion: 'PCA unassigned projection and strict sample-ID alignment run with missing/duplicate/set mismatch rejection',
    testFile: 'test/g0-chf0-science.test.mjs',
    pattern: 'CHF0 SCI-(2|3)',
  },
  {
    id: 'CHF0-BE-5',
    assertion: 'PID-gated liveness, confirmed TERM→KILL and cancellation DB truth agree',
    testFile: 'test/g0-chf0-lifecycle.test.mjs',
    pattern: 'CHF0 BE-5',
  },
];

function sha256(relativePath) {
  return createHash('sha256').update(readFileSync(join(repoRoot, relativePath))).digest('hex');
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function runContract(contract) {
  const args = ['--test', `--test-name-pattern=${contract.pattern}`, contract.testFile];
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  const passMatches = [...output.matchAll(/(?:^|\s)pass\s+(\d+)/gm)];
  const testCount = passMatches.length ? Number(passMatches.at(-1)[1]) : 0;
  const passed = result.status === 0 && testCount > 0;
  return {
    id: contract.id,
    status: passed ? 'passed' : 'failed',
    assertion: contract.assertion,
    command: ['node', ...args].join(' '),
    testFile: contract.testFile,
    testNamePattern: contract.pattern,
    testCount,
    exitCode: result.status,
    outputTail: output.split(/\r?\n/).slice(-24).join('\n'),
  };
}

const checks = contracts.map(runContract);
const sourceHashes = Object.fromEntries(files.map((file) => [file, sha256(file)]));
const sourceTreeDigest = createHash('sha256')
  .update(Object.entries(sourceHashes).map(([file, hash]) => `${file}:${hash}`).join('\n'))
  .digest('hex');
const sourceCommit = git('rev-parse', 'HEAD');
const sourceCommitReachable = !!sourceCommit
  && spawnSync('git', ['merge-base', '--is-ancestor', sourceCommit, 'HEAD'], { cwd: repoRoot }).status === 0;
const sourceCommitMismatches = sourceCommit ? files.filter((file) => {
  const result = spawnSync('git', ['show', `${sourceCommit}:${file}`], { cwd: repoRoot });
  if (result.status !== 0) return true;
  const committedHash = createHash('sha256').update(result.stdout).digest('hex');
  return committedHash !== sourceHashes[file];
}) : [...files];
const sourceCommitMatchesSourceHashes = sourceCommitReachable && sourceCommitMismatches.length === 0;
const passed = checks.every((check) => check.status === 'passed') && sourceCommitMatchesSourceHashes;

mkdirSync(evidenceDir, { recursive: true });
const evidence = {
  schemaVersion: 2,
  acceptanceId: 'G0-CHF0-7',
  generatedAt: new Date().toISOString(),
  sourceCommit,
  sourceCommitReachable,
  sourceCommitMatchesSourceHashes,
  sourceCommitMismatches,
  sourceTreeDigest,
  qualificationEligible: false,
  passed,
  checks,
  sourceHashes,
};
writeFileSync(join(evidenceDir, 'acceptance.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`[G0-CHF0] ${passed ? 'PASS' : 'FAIL'} — ${checks.filter((check) => check.status === 'passed').length}/${checks.length} contract classes`);
for (const check of checks) console.log(`  ${check.status === 'passed' ? '✓' : '✗'} ${check.id}: ${check.testCount} test(s)`);
if (!passed) process.exitCode = 1;
