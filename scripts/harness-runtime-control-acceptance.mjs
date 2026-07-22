#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commands = [
  ['runtime-control-tests', 'node --test test/agent-tool-policy.test.mjs test/harness-workspace-tools.test.mjs test/runtime-resource-snapshot.test.mjs test/harness-workflow-state.test.mjs test/scientific-task-persistence.test.mjs'],
  ['frontend-typecheck', 'npm run check --prefix frontend'],
];
const results = commands.map(([label, command]) => {
  const run = spawnSync(command, { cwd: root, shell: true, stdio: 'inherit', env: { ...process.env, CI: '1', BIOF3_HARNESS_OFFLINE: '1' } });
  return { label, command, exitCode: run.status ?? 1, signal: run.signal || null };
});
const report = {
  schemaVersion: 1,
  acceptance: 'post-hrt-runtime-control',
  privacy: 'repository_fixture_only',
  network: 'disabled_by_contract',
  checks: ['read_only_workspace_commands', 'resource_snapshot_ttl', 'low_memory_classification', 'restart_recovery_projection', 'frontend_typecheck'],
  commands: results,
  passed: results.every((item) => item.exitCode === 0),
  generatedAt: new Date().toISOString(),
};
const target = path.join(root, 'acceptance', 'harness-scientific-task', 'runtime-control-acceptance.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[runtime-control] ${report.passed ? 'PASS' : 'FAIL'}`);
if (!report.passed) process.exitCode = 1;
