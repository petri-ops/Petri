import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  LIVE_SOURCE_FILES,
  assertEvidenceWritable,
  assertSanitizedEvidence,
  createOwnedLifecycle,
  injectFailure,
  installSignalCleanup,
  withGuaranteedCleanup,
} from '../scripts/g0-rs-p4r-live-observation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('P4R-6 live producer source binding names only existing repository files', () => {
  for (const file of Object.values(LIVE_SOURCE_FILES)) {
    assert.equal(path.isAbsolute(file), false, `${file} must remain repository-relative`);
    assert.equal(file.includes('..'), false, `${file} must not escape the repository`);
    assert.equal(existsSync(path.join(ROOT, file)), true, `${file} is missing`);
  }
});

test('P4R-6 sanitizer accepts bounded source-bound evidence', () => {
  const evidence = {
    workPackage: 'G0-RS-P4R-6',
    sourceCommit: 'a'.repeat(40),
    sourceFiles: { producer: 'scripts/g0-rs-p4r-live-observation.mjs' },
    sourceHashes: { producer: 'b'.repeat(64) },
    providerBoundary: { realProviderUsed: false },
    observations: { revisionCount: 3, digest: 'c'.repeat(64) },
  };
  assert.equal(assertSanitizedEvidence(evidence), true);
});

test('P4R-6 sanitizer rejects paths, URLs, internal ids and secret-bearing fields', () => {
  const unsafe = [
    { runtimePath: '/Users/example/private/result.csv' },
    { endpoint: 'http://127.0.0.1:3001/api/health' },
    { observedRevision: 'rev_private123' },
    { authorization: 'Bearer private' },
    { nested: [{ project: 'p_private123' }] },
    { relativePath: '../outside' },
  ];
  for (const value of unsafe) {
    assert.throws(() => assertSanitizedEvidence(value), /unsafe|leaked/);
  }
});

test('P4R-6 canonical evidence writer refuses unbound or failed observations', () => {
  assert.throws(
    () => assertEvidenceWritable({ sourceCommitMatchesSourceHashes: false, passed: true }),
    (error) => error.code === 'source_binding_not_current',
  );
  assert.throws(
    () => assertEvidenceWritable({ sourceCommitMatchesSourceHashes: true, passed: false }),
    (error) => error.code === 'live_observation_not_passed',
  );
  assert.equal(assertEvidenceWritable({ sourceCommitMatchesSourceHashes: true, passed: true }), true);
});

test('P4R-6 injected failures still execute cleanup exactly once', async () => {
  let cleaned = 0;
  await assert.rejects(
    withGuaranteedCleanup(async () => {
      injectFailure('after_open', 'after_open');
    }, async () => { cleaned += 1; }),
    /injected_failure:after_open/,
  );
  assert.equal(cleaned, 1);
});

test('P4R-6 owned lifecycle removes its disposable root and is idempotent', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'biof3-p4r6-lifecycle-'));
  const lifecycle = createOwnedLifecycle();
  lifecycle.setRoot(root);
  await lifecycle.cleanup();
  await lifecycle.cleanup();
  assert.equal(existsSync(root), false);
});

test('P4R-6 signal handler requests one cleanup and records the signal exit code', async () => {
  class FakeProcess extends EventEmitter {
    exitCode = 0;
  }
  const processRef = new FakeProcess();
  let cleanups = 0;
  const dispose = installSignalCleanup(async () => {
    cleanups += 1;
    await Promise.resolve();
  }, { processRef, signals: ['SIGTERM'] });

  processRef.emit('SIGTERM');
  processRef.emit('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleanups, 1);
  assert.equal(processRef.exitCode, 143);
  dispose();
  assert.equal(processRef.listenerCount('SIGTERM'), 0);
});

test('P4R-6 real SIGTERM cleans the root and terminates the parent process', { skip: process.platform === 'win32' && 'Windows 无真实 SIGTERM 语义（模拟信号不递归进程树）——仅 POSIX 运行（BLOCK-104 P3 平台门）' }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'biof3-p4r6-signal-'));
  const script = path.join(ROOT, 'scripts/g0-rs-p4r-live-observation.mjs');
  const child = spawn(process.execPath, [script, '--signal-fixture-child', root], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.includes('__P4R6_SIGNAL_READY__')) child.kill('SIGTERM');
  });
  const outcome = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('signal fixture did not terminate'));
    }, 5000);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  assert.deepEqual(outcome, { code: 143, signal: null });
  assert.equal(existsSync(root), false);
});
