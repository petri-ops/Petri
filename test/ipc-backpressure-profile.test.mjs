#!/usr/bin/env node

/**
 * ipc-backpressure-profile.test.mjs — CI-friendly test for the IPC backpressure fixture.
 *
 * Validates that the fixture runs without errors, produces well-formed output,
 * and respects CLI flags. Tests 1MB, 10MB, and 100MB payload sizes.
 *
 * G0 compliant: no Worker / MessageChannel / SharedArrayBuffer.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'scripts/ipc-backpressure-profile.mjs');

describe('ipc-backpressure-profile fixture', { concurrency: false }, () => {

  it('fixture script exists', () => {
    assert.ok(existsSync(FIXTURE), `fixture not found at ${FIXTURE}`);
  });

  it('runs 1mb mode without throwing', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--size=1mb', '--warmup=1', '--iterations=3'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.ok(result.length > 0, 'fixture produced no output');
    // Should have expected sections
    assert.ok(result.includes('ipc-backpressure-profile'), 'output missing fixture name');
    assert.ok(result.includes('payload size:'), 'output missing payload size');
    assert.ok(result.includes('JSON.stringify timing'), 'output missing stringify timing section');
    assert.ok(result.includes('JSON.parse timing'), 'output missing parse timing section');
    assert.ok(result.includes('Threshold check'), 'output missing threshold check');
  });

  it('runs 10mb mode without throwing', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--size=10mb', '--warmup=1', '--iterations=3'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.ok(result.length > 0, 'fixture produced no output');
    assert.ok(result.includes('10mb'), 'output missing 10mb size label');
  });

  it('runs 100mb mode without throwing (if memory available)', () => {
    // 100MB may fail on low-memory machines; that's acceptable
    let exitCode = 0;
    let result = '';
    try {
      result = execFileSync(process.execPath, [FIXTURE, '--size=100mb', '--warmup=1', '--iterations=2'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 300_000,
      });
    } catch (err) {
      exitCode = err.status ?? 1;
      result = err.stdout || '';
    }
    // Either success or graceful failure is acceptable
    assert.ok(result.length > 0 || exitCode !== 0, '100mb mode failed without output');
    if (exitCode === 0) {
      assert.ok(result.includes('100mb'), 'output missing 100mb size label');
    }
  });

  it('warmup flag works correctly', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--size=1mb', '--warmup=5', '--iterations=2'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.ok(result.includes('warmup:        5 iterations'), 'warmup count not reflected in output');
  });

  it('iterations flag works correctly', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--size=1mb', '--warmup=1', '--iterations=20'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.ok(result.includes('iterations:    20 iterations'), 'iterations count not reflected in output');
  });

  it('outputs CSV format correctly', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--size=1mb', '--warmup=1', '--iterations=3', '--format=csv'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    // CSV format: size,iterations,stringify_ms,parse_ms,total_ms,memory_mb,event_loop_lag_ms
    const line = result.trim();
    const parts = line.split(',');
    assert.strictEqual(parts.length, 7, `expected 7 CSV fields, got: ${line}`);
    assert.strictEqual(parts[0], '1mb', `expected size=1mb, got: ${parts[0]}`);
    assert.strictEqual(parts[1], '3', `expected iterations=3, got: ${parts[1]}`);
    // Numeric fields should parse correctly
    assert.ok(!isNaN(parseFloat(parts[2])), `stringify_ms should be numeric: ${parts[2]}`);
    assert.ok(!isNaN(parseFloat(parts[3])), `parse_ms should be numeric: ${parts[3]}`);
    assert.ok(!isNaN(parseFloat(parts[4])), `total_ms should be numeric: ${parts[4]}`);
    assert.ok(!isNaN(parseFloat(parts[5])), `memory_mb should be numeric: ${parts[5]}`);
    // event_loop_lag_ms is empty when --probe is not used
    assert.strictEqual(parts[6], '', `event_loop_lag_ms should be empty without --probe, got: ${parts[6]}`);
  });

  it('warns when stringify exceeds threshold', () => {
    // Use a very low threshold (1ms) — 10MB stringify exceeds 1ms even on fast hardware
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [FIXTURE, '--size=10mb', '--warmup=1', '--iterations=3', '--threshold=1'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      exitCode = err.status ?? 1;
    }
    // Should exit with code 1 due to threshold exceeded
    assert.strictEqual(exitCode, 1, 'fixture should exit 1 when threshold exceeded');
  });

  it('--probe flag shows probe enabled in output', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--size=1mb', '--warmup=1', '--iterations=2', '--probe'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.ok(result.includes('probe:         enabled'), 'output missing probe: enabled');
    assert.ok(result.includes('--- Event-loop lag (--probe mode) ---'), 'output missing event-loop lag section');
    assert.ok(result.includes('before:'), 'output missing lag before');
    assert.ok(result.includes('after:'), 'output missing lag after');
    assert.ok(result.includes('delta:'), 'output missing lag delta');
  });

  it('--probe flag produces event_loop_lag_ms in CSV output', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--size=1mb', '--warmup=1', '--iterations=2', '--format=csv', '--probe'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    const line = result.trim();
    const parts = line.split(',');
    assert.strictEqual(parts.length, 7, `expected 7 CSV fields with --probe, got: ${line}`);
    // event_loop_lag_ms should be a numeric value
    assert.ok(!isNaN(parseFloat(parts[6])), `event_loop_lag_ms should be numeric with --probe, got: ${parts[6]}`);
  });

  it('--probe with 100mb shows event-loop lag delta', () => {
    // 100mb + probe is the canonical lag measurement scenario
    let exitCode = 0;
    let result = '';
    try {
      result = execFileSync(process.execPath, [FIXTURE, '--size=100mb', '--warmup=1', '--iterations=2', '--probe'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 300_000,
      });
    } catch (err) {
      exitCode = err.status ?? 1;
      result = err.stdout || '';
    }
    // Either success or graceful failure is acceptable
    assert.ok(result.length > 0 || exitCode !== 0, '100mb --probe mode failed without output');
    if (exitCode === 0) {
      assert.ok(result.includes('probe:         enabled'), 'output missing probe: enabled');
      assert.ok(result.includes('--- Event-loop lag (--probe mode) ---'), 'output missing event-loop lag section');
      assert.ok(result.includes('delta:'), 'output missing lag delta');
    }
  });

  it('requires --size flag', () => {
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [FIXTURE, '--warmup=1'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      exitCode = err.status ?? 1;
      stderr = err.stderr || '';
    }
    assert.strictEqual(exitCode, 1, 'fixture should exit 1 when --size is missing');
    assert.ok(stderr.includes('--size'), 'error message should mention --size');
  });

  it('rejects invalid --size values', () => {
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [FIXTURE, '--size=500mb', '--warmup=1'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      exitCode = err.status ?? 1;
      stderr = err.stderr || '';
    }
    assert.strictEqual(exitCode, 1, 'fixture should exit 1 for invalid --size');
    assert.ok(stderr.includes('size'), 'error message should mention size');
  });

  it('human format includes memory section', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--size=1mb', '--warmup=1', '--iterations=2', '--format=human'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.ok(result.includes('--- Memory ---'), 'output missing Memory section');
    assert.ok(result.includes('before:'), 'output missing memory before');
    assert.ok(result.includes('after:'), 'output missing memory after');
    assert.ok(result.includes('peak:'), 'output missing memory peak');
  });

  it('includes G0 compliance note', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--size=1mb', '--warmup=1', '--iterations=2'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.ok(result.includes('G0 compliant'), 'output missing G0 compliance note');
    assert.ok(result.includes('qualificationEligible: false'), 'output missing qualificationEligible note');
  });
});
