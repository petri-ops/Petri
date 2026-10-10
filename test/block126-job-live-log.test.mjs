'use strict';

/**
 * BLOCK-126 P2 — 运行期日志行缓冲契约。
 *
 * 语义：本地作业 spawn 化后 stdout/stderr 逐块喂入按 jobId 的有界行缓冲；
 * 日志端点运行中读取实时尾部（多字节安全、有界滚动、丢弃计数诚实）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  appendJobLiveLog,
  clearJobLiveLog,
  endJobLiveLog,
  readJobLiveLogTail,
} = require('../core/petri-server/helpers/job-live-log');

test('append accumulates lines with stream prefixes and read returns the tail', () => {
  clearJobLiveLog('job_lines');
  appendJobLiveLog('job_lines', 'stdout', 'step 1 ok\nstep 2 ok\n');
  appendJobLiveLog('job_lines', 'stderr', 'warning: low counts\n');
  appendJobLiveLog('job_lines', 'stdout', 'step 3 ok\n');
  const tail = readJobLiveLogTail('job_lines', 32 * 1024);
  assert.ok(tail, 'tail must exist after appends');
  assert.equal(tail.log.split('\n').length, 4);
  assert.ok(tail.log.includes('step 1 ok'));
  assert.ok(tail.log.includes('[stderr] warning: low counts'));
  assert.equal(tail.truncated, false);
  clearJobLiveLog('job_lines');
  assert.equal(readJobLiveLogTail('job_lines', 1024), null);
});

test('multi-byte utf-8 content split across chunks stays intact', () => {
  clearJobLiveLog('job_utf8');
  const full = Buffer.from('正在执行差异表达分析：基因 TP53\n', 'utf8');
  const mid = Math.floor(full.length / 2);
  appendJobLiveLog('job_utf8', 'stdout', full.subarray(0, mid));
  appendJobLiveLog('job_utf8', 'stdout', full.subarray(mid));
  const tail = readJobLiveLogTail('job_utf8', 4096);
  assert.ok(tail.log.includes('正在执行差异表达分析：基因 TP53'));
  clearJobLiveLog('job_utf8');
});

test('the buffer is bounded and reports dropped lines honestly', () => {
  clearJobLiveLog('job_bound');
  for (let i = 1; i <= 1000; i += 1) {
    appendJobLiveLog('job_bound', 'stdout', `line ${i}\n`);
  }
  const tail = readJobLiveLogTail('job_bound', 32 * 1024);
  assert.ok(tail.lineCount <= 600, 'line cap must hold');
  assert.ok(tail.droppedLines > 0, 'dropped counter must be truthful');
  assert.equal(tail.truncated, true);
  assert.ok(tail.log.includes('line 1000'), 'newest lines survive the rollover');
  assert.ok(!tail.log.includes('line 1\n'), 'oldest lines were rolled out');
  clearJobLiveLog('job_bound');
});

test('tail reads respect the byte budget on line boundaries', () => {
  clearJobLiveLog('job_bytes');
  appendJobLiveLog('job_bytes', 'stdout', Array.from({ length: 30 }, (_, i) => `row-${String(i).padStart(3, '0')} ${'x'.repeat(20)}`).join('\n') + '\n');
  const tail = readJobLiveLogTail('job_bytes', 200);
  assert.ok(Buffer.byteLength(tail.log, 'utf8') <= 200);
  assert.ok(tail.log.includes('row-029'), 'the newest line is kept');
  assert.equal(tail.truncated, true);
  clearJobLiveLog('job_bytes');
});

test('reading an unknown job returns null (no fabricated content)', () => {
  assert.equal(readJobLiveLogTail('job_never', 1024), null);
});

test('incomplete trailing line is flushed on end and surfaced until cleared', () => {
  clearJobLiveLog('job_pending');
  appendJobLiveLog('job_pending', 'stdout', 'partial-without-newline');
  const before = readJobLiveLogTail('job_pending', 1024);
  assert.equal(before, null, 'no completed line yet — do not fabricate partial output');
  endJobLiveLog('job_pending');
  const after = readJobLiveLogTail('job_pending', 1024);
  assert.ok(after && after.log.includes('partial-without-newline'));
  clearJobLiveLog('job_pending');
});
