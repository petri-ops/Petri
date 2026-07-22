#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(repoRoot, 'acceptance', 'harness-scientific-task');
const commands = [
  ['harness:scientific-task:evaluate', 'npm run harness:scientific-task:evaluate'],
  ['harness:scientific-task:test', 'npm run harness:scientific-task:test'],
  ['harness:scientific-task:planner:test', 'npm run harness:scientific-task:planner:test'],
  ['harness:scientific-task:confirmation:test', 'npm run harness:scientific-task:confirmation:test'],
  ['harness:scientific-task:persistence:test', 'npm run harness:scientific-task:persistence:test'],
  ['harness:scientific-task:provenance:test', 'npm run harness:scientific-task:provenance:test'],
  ['harness:scientific-task:delivery:test', 'npm run harness:scientific-task:delivery:test'],
  ['harness:scientific-task:replay:test', 'npm run harness:scientific-task:replay:test'],
  ['harness:scientific-task:replay:acceptance', 'npm run harness:scientific-task:replay:acceptance'],
];

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
for (const [label, command] of commands) {
  const result = run(label, command);
  results.push(result);
  if (result.exitCode !== 0) break;
}

const report = {
  schemaVersion: 1,
  harness: 'scientific-task',
  phase: 'HRT-7',
  privacy: 'synthetic_or_repository_demo_data_only',
  network: 'disabled_by_contract',
  credentials: 'not_loaded',
  startedAt,
  finishedAt: new Date().toISOString(),
  commands: results,
  passed: results.length === commands.length && results.every((item) => item.exitCode === 0),
  requiredCoverage: ['small_window', 'large_window', 'summary_failure_fallback', 'database_free_replay', 'drift_classification'],
};

fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, 'hrt7-scientific-task-gate.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[HRT-7] ${report.passed ? 'PASS' : 'FAIL'} scientific-task aggregate gate`);
if (!report.passed) process.exitCode = 1;
