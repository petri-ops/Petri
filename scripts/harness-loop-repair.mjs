#!/usr/bin/env node

/**
 * HLE-4 Aggregate Gate Script
 * Runs syntax checks + unit tests for:
 *   - loop-failure-diagnoser.js
 *   - loop-repair-strategy.js
 *   - loop-controller.js (HLE-2 integration)
 *   - loop-validators.js + loop-validator-registry.js (HLE-3)
 *
 * Exit 0 = all pass, non-zero = failure.
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
    return { file, ok: true, error: null };
  } catch (err) {
    return { file, ok: false, error: err.message };
  }
}

function runTests(pattern) {
  const full = path.join(ROOT, pattern);
  try {
    execSync(`node --test "${full}"`, { stdio: 'pipe', cwd: ROOT });
    return { pattern, ok: true, error: null };
  } catch (err) {
    return { pattern, ok: false, error: err.message };
  }
}

const syntaxFiles = [
  'core/shared-backend/loop-failure-diagnoser.js',
  'core/shared-backend/loop-repair-strategy.js',
  'core/shared-backend/loop-controller.js',
];

const testFiles = [
  'test/loop-controller.test.mjs',
  'test/loop-controller-integration.test.mjs',
  'test/loop-failure-diagnoser.test.cjs',
  'test/loop-repair-strategy.test.cjs',
  'test/loop-validator-registry.test.mjs',
  'test/loop-validators.test.cjs',
];

let exitCode = 0;

console.log('=== HLE-4 Gate: Syntax Checks ===');
for (const f of syntaxFiles) {
  const result = checkSyntax(f);
  if (result.ok) {
    console.log(`  \u2713 ${f}`);
  } else {
    console.log(`  \u2717 ${f}: ${result.error.trim()}`);
    exitCode = 1;
  }
}

console.log('\n=== HLE-4 Gate: Unit Tests ===');
for (const t of testFiles) {
  const result = runTests(t);
  if (result.ok) {
    console.log(`  \u2713 ${t}`);
  } else {
    console.log(`  \u2717 ${t}: test failures`);
    exitCode = 1;
  }
}

console.log(`\n${exitCode === 0 ? '\u2705 All checks passed' : '\u274c Some checks failed'}`);
process.exit(exitCode);
