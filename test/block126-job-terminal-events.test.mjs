'use strict';

/**
 * BLOCK-126 P1 — 作业终态失效事件契约。
 *
 * 语义：tool_job 到达终态（completed/failed/cancelled）且行级 CAS 确实生效时，
 * 必须向 jobs 域发布 SSE 失效信号（cache-invalidation 模式，不推数据本体）。
 * 通知永不 throw（best-effort，不阻断作业链路）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const eventBus = require('../core/biof3-server/helpers/event-bus');

function withBusSpy(run) {
  const original = eventBus.publishInvalidation;
  const calls = [];
  eventBus.publishInvalidation = (domain, payload) => calls.push({ domain, payload });
  return Promise.resolve()
    .then(run)
    .finally(() => { eventBus.publishInvalidation = original; })
    .then(() => calls);
}

test('publishJobTerminalState broadcasts a jobs-domain invalidation with terminal payload', async () => {
  const calls = await withBusSpy(async () => {
    const { publishJobTerminalState } = require('../core/biof3-server/helpers/job-events');
    publishJobTerminalState('tj_1', 'completed');
    publishJobTerminalState('tj_2', 'failed', { reason: 'hard_timeout' });
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].domain, 'jobs');
  assert.equal(calls[0].payload.toolJobId, 'tj_1');
  assert.equal(calls[0].payload.state, 'completed');
  // at 时间戳由 event-bus 组装层附加（ck03 契约已覆盖），spy 层只断言原始参数。
  assert.equal(calls[1].payload.toolJobId, 'tj_2');
  assert.equal(calls[1].payload.reason, 'hard_timeout');
});

test('publishJobTerminalState never throws even when the bus breaks', async () => {
  const original = eventBus.publishInvalidation;
  eventBus.publishInvalidation = () => { throw new Error('bus down'); };
  try {
    const { publishJobTerminalState } = require('../core/biof3-server/helpers/job-events');
    assert.doesNotThrow(() => publishJobTerminalState('tj_3', 'cancelled'));
  } finally {
    eventBus.publishInvalidation = original;
  }
});

test('terminal CAS primitives publish only when the row actually transitions', async () => {
  let call = 0;
  const statements = [];
  const db = {
    prepare: (sql) => ({
      run: async (...args) => {
        statements.push({ sql, args });
        call += 1;
        return { changes: call === 1 ? 1 : 0 };
      },
    }),
  };
  const calls = await withBusSpy(async () => {
    const activeJob = require('../core/biof3-server/helpers/tools-executor/active-job');
    await activeJob.transitionToolJobToCompleted({ db, jobId: 'tj_a', result: { ok: true } });
    await activeJob.transitionToolJobToFailed({ db, jobId: 'tj_a', error: 'boom' });
    await activeJob.settleConfirmedToolCancellation({ db, jobId: 'tj_a', result: {} });
  });
  // 第一次 CAS changes=1 → 发布 completed；后两次 changes=0 → 不发布（终态已被抢先，不重发）。
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.state, 'completed');
  assert.equal(calls[0].payload.toolJobId, 'tj_a');
  assert.ok(statements.length >= 3, 'all three primitives must hit the db');
});

test('source-scan guard: every direct terminal write path stays wired to publication', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const executorSrc = read('core/biof3-server/helpers/tools-executor.js');
  const mcpSrc = read('core/biof3-server/mcp/registry/run-plugin-script.js');
  const metadataSrc = read('core/biof3-server/routes/tools-metadata.js');
  const activeJobSrc = read('core/biof3-server/helpers/tools-executor/active-job.js');

  // CAS 原语层三态接线在位（防后续重构漏发）。
  for (const state of ['completed', 'failed', 'cancelled']) {
    assert.ok(
      activeJobSrc.includes(`publishJobTerminalState(jobId, '${state}')`),
      `active-job CAS primitive must publish ${state}`,
    );
  }
  // durable-cancel 直写收敛处必须补发 cancelled。
  assert.ok(
    /publishJobTerminalState\(jobId, 'cancelled'\)/.test(executorSrc),
    'executor durable-cancel convergence must publish cancelled',
  );
  // MCP 直写终态至少覆盖 completed 与 failed。
  assert.ok(
    /publishJobTerminalState\(toolJobId, 'completed'/.test(mcpSrc),
    'mcp path must publish completed',
  );
  assert.ok(
    /publishJobTerminalState\(toolJobId, 'failed'/.test(mcpSrc),
    'mcp path must publish failed',
  );
  // 日志端点必须接 live 尾部源。
  assert.ok(
    /readJobLiveLogTail/.test(metadataSrc),
    'log endpoint must consult the live tail',
  );
});
