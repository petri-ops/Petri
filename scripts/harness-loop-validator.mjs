#!/usr/bin/env node

/**
 * HLE-3 Aggregate Gate — Validator Registry.
 *
 * Orchestrates all HLE-3 checks:
 *  1. Syntax check: loop-validator-registry.js, loop-validators.js
 *  2. Unit tests: loop-validator-registry.test.mjs, loop-validators.test.cjs
 *
 * Exit codes:
 *  0 = all pass
 *  1 = any check fails
 */

import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const FILES = [
  'core/shared-backend/loop-validator-registry.js',
  'core/shared-backend/loop-validators.js',
];
const TEST_FILES = [
  'test/loop-validator-registry.test.mjs',
  'test/loop-validators.test.cjs',
];

function runCheck(cmd, label) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`  \u2705 ${label}`);
    return true;
  } catch (err) {
    console.error(`  \u274c ${label}`);
    if (err.stdout) console.error(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
    return false;
  }
}

let allPass = true;

console.log('\n=== HLE-3: Validator Registry Gate ===\n');
console.log('[1/2] Syntax checks...');
for (const file of FILES) {
  const fullPath = `${ROOT}/${file}`;
  if (!existsSync(fullPath)) {
    console.error(`  \u274c ${file} not found`);
    allPass = false;
    continue;
  }
  if (!runCheck(`node --check ${fullPath}`, file)) allPass = false;
}

console.log('\n[2/2] Unit tests...');
const testCmd = `node --test ${TEST_FILES.map((f) => `${ROOT}/${f}`).join(' ')}`;
try {
  execSync(testCmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  console.log('  \u2705 all unit tests pass');
} catch (err) {
  console.error('  \u274c unit tests failed');
  if (err.stdout) console.error(err.stdout.toString());
  allPass = false;
}

console.log('\n' + (allPass ? '\u2705 HLE-3 gate PASSED' : '\u274c HLE-3 gate FAILED') + '\n');
process.exit(allPass ? 0 : 1);