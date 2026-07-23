#!/usr/bin/env node

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
const evaluateResult = run('hle0:evaluate', 'node scripts/harness-loop-evaluate.mjs');
results.push(evaluateResult);

const testResult = run('hle0:test', 'node test/loop-fixtures.test.mjs');
results.push(testResult);

const passed = results.every((item) => item.exitCode === 0);

const report = {
  schemaVersion: 1,
  harness: 'harness-loop',
  phase: 'HLE-0',
  privacy: 'synthetic_or_repository_demo_data_only',
  network: 'disabled_by_contract',
  credentials: 'not_loaded',
  startedAt,
  finishedAt: new Date().toISOString(),
  commands: results,
  passed,
};

fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, 'hle0-gate.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[HLE-0] ${report.passed ? 'PASS' : 'FAIL'} harness-loop aggregate gate`);
if (!report.passed) process.exitCode = 1;
