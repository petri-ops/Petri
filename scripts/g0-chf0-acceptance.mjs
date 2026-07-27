#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const evidenceDir = join(repoRoot, 'acceptance/g0-critical-crosscut-hardening');
const files = [
  'core/py-server/server.js',
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
  'resources/built-in-plugins/volcano-plot/scripts/volcano-plot.R',
  'resources/built-in-plugins/volcano-plot/tool-definition.json',
  'test/g0-chf0-boundaries.test.mjs',
];

function sha256(relativePath) {
  return createHash('sha256').update(readFileSync(join(repoRoot, relativePath))).digest('hex');
}

let testOutput = '';
let passed = false;
try {
  testOutput = execFileSync(process.execPath, ['--test', 'test/g0-chf0-boundaries.test.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  passed = true;
} catch (error) {
  testOutput = `${error.stdout || ''}\n${error.stderr || ''}`;
}

mkdirSync(evidenceDir, { recursive: true });
const sourceHashes = Object.fromEntries(files.map((file) => [file, sha256(file)]));
const evidence = {
  schemaVersion: 1,
  acceptanceId: 'G0-CHF0-7',
  generatedAt: new Date().toISOString(),
  sourceCommit: (() => {
    try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(); }
    catch { return null; }
  })(),
  qualificationEligible: false,
  passed,
  checks: [
    { id: 'CHF0-SEC-1', status: 'tested', assertion: 'R/Python raw execution and replot code routes fail closed' },
    { id: 'CHF0-SEC-2', status: 'tested', assertion: 'Origin, traversal, absolute path and symlink boundaries reject' },
    { id: 'CHF0-SCI-1', status: 'tested', assertion: 'Volcano defaults to adjusted significance and rejects invalid columns' },
    { id: 'CHF0-SCI-2-3', status: 'tested', assertion: 'PCA uses explicit unassigned state and sample-ID alignment' },
    { id: 'CHF0-BE-5', status: 'tested', assertion: 'Termination escalates SIGTERM to SIGKILL and heartbeats are persisted' },
  ],
  testOutputTail: testOutput.split(/\r?\n/).slice(-40).join('\n'),
  sourceHashes,
};
writeFileSync(join(evidenceDir, 'acceptance.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`[G0-CHF0] ${passed ? 'PASS' : 'FAIL'} — 5 contract classes`);
if (!passed) process.exitCode = 1;
