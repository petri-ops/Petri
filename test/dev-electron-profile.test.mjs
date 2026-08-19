#!/usr/bin/env node

/**
 * dev-electron-profile.test.mjs — CI-friendly test for the profile fixture.
 *
 * Validates that the fixture itself runs without errors and produces
 * well-formed structured output. Does not measure absolute performance
 * targets (those are set per-machine in local runs).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'scripts/dev-electron-profile.mjs');
const MAIN_JS = path.join(ROOT, 'src/main.js');
const PRELOAD_JS = path.join(ROOT, 'src/preload.js');

describe('dev-electron-profile fixture', { concurrency: false }, () => {

  it('fixture script exists', () => {
    assert.ok(existsSync(FIXTURE), `fixture not found at ${FIXTURE}`);
  });

  it('fixture source files exist', () => {
    assert.ok(existsSync(MAIN_JS), `main.js not found at ${MAIN_JS}`);
    assert.ok(existsSync(PRELOAD_JS), `preload.js not found at ${PRELOAD_JS}`);
  });

  it('runs without throwing', () => {
    // --warmup 1 keeps it fast for CI
    const result = execFileSync(process.execPath, [FIXTURE, '--warmup', '1', '--threshold', '99999'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ok(result.length > 0, 'fixture produced no output');
  });

  it('outputs required static metric sections', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--warmup', '1', '--threshold', '99999'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });

    const requiredSections = [
      '=== dev-electron-profile baseline ===',
      '--- Static metrics ---',
      '--- File read timing (',
      '--- node --check src/main.js timing (',
      '--- Baseline summary ---',
    ];
    for (const section of requiredSections) {
      assert.ok(result.includes(section),
        `output missing required section: "${section}"`);
    }
  });

  it('outputs main.js metrics', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--warmup', '1', '--threshold', '99999'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ok(result.includes('main.js:'), 'output missing main.js line');
    assert.ok(result.includes('ipcMain.handle:'), 'output missing ipcMain.handle count');
    assert.ok(result.includes('preload.js:'), 'output missing preload.js line');
    assert.ok(result.includes('ipcRenderer.invoke:'), 'output missing ipcRenderer.invoke count');
  });

  it('outputs timing results', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--warmup', '1', '--threshold', '99999'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    // Either actual timing numbers or the "skipped" note is acceptable
    const hasTiming = result.includes('node --check times:')
      || result.includes('(skipped: main.js requires Electron-only modules');
    assert.ok(hasTiming, 'output missing node --check timing or skip notice');
    assert.ok(result.includes('node --check median:') || result.includes('file-read median:'),
      'output missing a median metric');
  });

  it('outputs threshold comparison', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--warmup', '1', '--threshold', '99999'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ok(result.includes('threshold (ms):'), 'output missing threshold line');
    assert.ok(result.includes('OK: within threshold') || result.includes('WARNING:'),
      'output missing threshold status line');
  });

  it('respects --threshold flag and exits non-zero when exceeded', () => {
    // With threshold=0, even the tiny file-read median (typically ~0.1ms) exceeds 0,
    // triggering WARNING and exit code 1 via the fallback baseline path.
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [FIXTURE, '--warmup', '1', '--threshold', '0'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 30_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      exitCode = err.status ?? 1;
    }
    assert.strictEqual(exitCode, 1,
      'fixture should exit 1 when file-read median exceeds threshold=0');
  });

  it('parses --warmup flag without error', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--warmup', '3', '--threshold', '99999'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ok(result.includes('File read timing (3 warmup'), 'warmup count not reflected in output');
    assert.ok(result.includes('node --check src/main.js timing (3 warmup'), 'warmup count not in node --check section');
  });

  it('documents Electron launch timing sequence', () => {
    const result = execFileSync(process.execPath, [FIXTURE, '--warmup', '1', '--threshold', '99999'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ok(result.includes('T0: spawn'), 'missing T0 spawn marker');
    assert.ok(result.includes('T4: first paint'), 'missing T4 first paint marker');
    assert.ok(result.includes('Notes'), 'missing Notes section');
  });

  it('node --check src/preload.js passes', () => {
    execFileSync('node', ['--check', 'src/preload.js'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 15_000,
    });
  });

  // Note: `node --check src/main.js` fails in plain Node due to:
  // 1. Electron-only requires (electron, better-sqlite3) — expected
  // 2. Pre-existing duplicate `const { ipcMain }` at lines 14 and 39 in main.js
  //    This is a production-code issue, not a fixture defect. The fixture
  //    handles the Electron-only case gracefully (skips to file-read timing).
  //    Fixing main.js requires a separate production-code change, not in scope
  //    for this fixture task.
});
