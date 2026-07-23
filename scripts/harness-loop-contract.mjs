#!/usr/bin/env node

/**
 * HLE-1 acceptance gate — runs loop-contract unit tests, loop-repository
 * integration tests, and node --check on every new/changed core file.
 *
 * Reports:
 *  - acceptance/harness-loop/hle1-gate.json (machine-readable)
 *
 * No network. No Provider. No fixtures that depend on live services.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(repoRoot, 'acceptance/harness-loop');

function run(label, command) {
  const result = spawnSync(command, {
    cwd: repoRoot,
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, CI: '1', BIOF3_HARNESS_OFFLINE: '1' },
  });
  return { label, command, exitCode: result.status ?? 1, signal: result.signal || null };
}

const startedAt = new Date().toISOString();
const results = [];

const filesToCheck = [
  'core/shared-backend/loop-contract.js',
  'core/r-server/db.js',
  'core/r-server/routes/harness.js',
];

for (const file of filesToCheck) {
  const r = run(
    `check:${path.basename(file)}`,
    `node --check ${file}`,
  );
  results.push(r);
}

const unitResult = run(
  'hle1:contract:test',
  'node --test test/loop-contract.test.mjs',
);
results.push(unitResult);

const repoResult = run(
  'hle1:repository:test',
  'node --test test/loop-repository.test.mjs',
);
results.push(repoResult);

const passed = results.every((item) => item.exitCode === 0);

const report = {
  schemaVersion: 1,
  harness: 'harness-loop',
  phase: 'HLE-1',
  privacy: 'synthetic_or_repository_demo_data_only',
  network: 'disabled_by_contract',
  credentials: 'not_loaded',
  startedAt,
  finishedAt: new Date().toISOString(),
  files: filesToCheck,
  commands: results,
  passed,
};

fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(
  path.join(evidenceDir, 'hle1-gate.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(`[HLE-1] ${report.passed ? 'PASS' : 'FAIL'} harness-loop contract gate`);
if (!report.passed) process.exitCode = 1;