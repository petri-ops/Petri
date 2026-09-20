#!/usr/bin/env node

/**
 * HLE-2 Loop Controller aggregate gate.
 * Orchestrates: syntax check → unit tests → integration tests.
 * Exits 0 on all pass, 1 on any failure.
 */

import { execSync } from 'child_process';
import { exit } from 'process';

const RUNNER = process.argv[2] || 'node --test';
const TEST_FILES = [
  'test/loop-controller.test.mjs',
  'test/loop-controller-integration.test.mjs',
];

const EXTRA_CHECK = [
  'core/shared-backend/loop-controller.js',
];

function run(cmd, label) {
  process.stdout.write(`\n[${label}] ${cmd}\n`);
  try {
    execSync(cmd, { stdio: 'inherit' });
    return true;
  } catch {
    process.stdout.write(`[${label}] FAILED\n`);
    return false;
  }
}

let ok = true;

// 1. Syntax check on new files
for (const file of EXTRA_CHECK) {
  ok = run(`node --check ${file}`, 'CHECK') && ok;
}

// 2. Unit + integration tests
for (const file of TEST_FILES) {
  ok = run(`${RUNNER} ${file}`, `TEST ${file}`) && ok;
}

if (ok) {
  console.log('\n[gate] All HLE-2 checks passed');
  exit(0);
} else {
  console.error('\n[gate] HLE-2 checks FAILED');
  exit(1);
}