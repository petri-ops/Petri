#!/usr/bin/env node

/**
 * HLE-5 Aggregate Gate Script
 * Runs syntax checks + unit tests for:
 *   - loop-checkpoint.js (buildIterationCheckpoint, buildLoopContextEnvelope,
 *     projectBudget, buildSessionStageView, buildExpandedSessionStageView)
 *   - loop-contract.js (buildIteration extended with validatorResults/repairAttempt/costSnapshot)
 *   - loop-controller.js (buildControllerIteration with costSnapshot)
 */

'use strict';

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function checkSyntax(file) {
  const full = path.join(ROOT, file);
  try {
    execSync(`node --check "${full}"`, { stdio: 'pipe' });
    return { file, ok: true };
  } catch (err) {
    return { file, ok: false, error: err.message };
  }
}

function runTests(pattern) {
  const full = path.join(ROOT, pattern);
  try {
    execSync(`node --test "${full}"`, { stdio: 'pipe', cwd: ROOT });
    return { pattern, ok: true };
  } catch {
    return { pattern, ok: false };
  }
}

const syntaxFiles = [
  'core/shared-backend/loop-checkpoint.js',
  'core/shared-backend/loop-contract.js',
  'core/shared-backend/loop-controller.js',
];

const testFiles = [
  'test/loop-checkpoint.test.cjs',
  'test/loop-contract.test.mjs',
  'test/loop-controller.test.mjs',
  'test/loop-controller-integration.test.mjs',
];

let exitCode = 0;

console.log('=== HLE-5 Gate: Syntax Checks ===');
for (const f of syntaxFiles) {
  const result = checkSyntax(f);
  console.log(`  ${result.ok ? '✓' : '✗'} ${f}`);
  if (!result.ok) exitCode = 1;
}

console.log('\n=== HLE-5 Gate: Unit Tests ===');
for (const t of testFiles) {
  const result = runTests(t);
  console.log(`  ${result.ok ? '✓' : '✗'} ${t}`);
  if (!result.ok) exitCode = 1;
}

console.log(`\n${exitCode === 0 ? '✅ All checks passed' : '❌ Some checks failed'}`);
process.exit(exitCode);
