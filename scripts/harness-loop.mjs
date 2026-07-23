#!/usr/bin/env node

/**
 * Harness Loop — Aggregate Gate Script (HLE-0 through HLE-6).
 *
 * Runs all Harness Loop Engineering phases:
 *  - HLE-0: Fixture evaluation
 *  - HLE-1: Loop Contract (schema, status, hashing, validation)
 *  - HLE-2: Loop Controller (decide, detect, exit)
 *  - HLE-3: Validator Registry + Built-in Validators
 *  - HLE-4: Failure Diagnoser + Repair Strategy
 *  - HLE-5: Checkpoint, ContextEnvelope, Budget, SessionStageView
 *
 *  - HLE-C5: Sanitized production evidence (three tracks, providers, restart,
 *    responsive UI). The verifier itself is zero-network and offline-safe.
 *
 * HLE-6: All of the above.
 *
 * Outputs: acceptance/harness-loop/hle-all-gate.json
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(repoRoot, 'acceptance/harness-loop');

/**
 * Run a command synchronously with CI/offline environment variables.
 * Returns { label, command, exitCode, signal }.
 */
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

// ---------------------------------------------------------------------------
// HLE-0: Fixture evaluation
// ---------------------------------------------------------------------------
results.push(run('hle0:evaluate', 'node scripts/harness-loop-evaluate.mjs'));
results.push(run('hle0:test', 'node test/loop-fixtures.test.mjs'));

// ---------------------------------------------------------------------------
// HLE-1: Loop Contract
// ---------------------------------------------------------------------------
results.push(run('hle1:contract:test', 'node test/loop-contract.test.mjs'));

// ---------------------------------------------------------------------------
// HLE-1: Loop Repository (SQLite persistence)
// ---------------------------------------------------------------------------
results.push(run('hle1:repository:test', 'node test/loop-repository.test.mjs'));

// ---------------------------------------------------------------------------
// HLE-2: Loop Controller
// ---------------------------------------------------------------------------
results.push(run('hle2:controller:test', 'node test/loop-controller.test.mjs'));
results.push(run('hle2:controller:integration', 'node test/loop-controller-integration.test.mjs'));

// ---------------------------------------------------------------------------
// HLE-3: Validator Registry + Built-in Validators
// ---------------------------------------------------------------------------
results.push(run('hle3:validator:registry:test', 'node test/loop-validator-registry.test.mjs'));
results.push(run('hle3:validator:builtin:test', 'node test/loop-validators.test.cjs'));

// ---------------------------------------------------------------------------
// HLE-4: Failure Diagnoser + Repair Strategy
// ---------------------------------------------------------------------------
results.push(run('hle4:diagnoser:test', 'node test/loop-failure-diagnoser.test.cjs'));
results.push(run('hle4:repair:test', 'node test/loop-repair-strategy.test.cjs'));

// ---------------------------------------------------------------------------
// HLE-5: Checkpoint, ContextEnvelope, Budget, SessionStageView
// ---------------------------------------------------------------------------
results.push(run('hle5:checkpoint:test', 'node test/loop-checkpoint.test.cjs'));

// ---------------------------------------------------------------------------
// HLE-C5: Pre-recorded production acceptance evidence
// ---------------------------------------------------------------------------
results.push(run(
  'hle-c5:production:evidence',
  'node scripts/harness-loop-production-acceptance.mjs',
));

// ---------------------------------------------------------------------------
// Compute pass/fail
// ---------------------------------------------------------------------------
const passed = results.every((item) => item.exitCode === 0);
const failed = results.filter((item) => item.exitCode !== 0);

const report = {
  schemaVersion: 1,
  harness: 'harness-loop',
  phase: 'HLE-6',
  privacy: 'synthetic_fixtures_and_sanitized_production_evidence',
  network: 'disabled_during_gate; live_provider_evidence_pre_recorded',
  credentials: 'not_loaded',
  startedAt,
  finishedAt: new Date().toISOString(),
  totalCommands: results.length,
  totalPassed: results.length - failed.length,
  totalFailed: failed.length,
  commands: results.map(({ label, command, exitCode, signal }) => ({
    label,
    command,
    exitCode,
    signal,
    passed: exitCode === 0,
  })),
  passed,
};

// ---------------------------------------------------------------------------
// Write evidence
// ---------------------------------------------------------------------------
fs.mkdirSync(evidenceDir, { recursive: true });
const evidencePath = path.join(evidenceDir, 'hle-all-gate.json');
fs.writeFileSync(evidencePath, JSON.stringify(report, null, 2) + '\n');

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------
console.log(`\n[HLE-6] ${report.passed ? '✅ PASS' : `❌ FAIL (${failed.length}/${results.length} failed)`}`);
for (const f of failed) {
  console.log(`  FAILED: ${f.label} — exit ${f.exitCode}`);
}
console.log(`Evidence: ${evidencePath}`);

if (!report.passed) process.exitCode = 1;
