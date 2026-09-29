'use strict';

/**
 * BLOCK-135（G0-PLATFORM PL-3 二刀·分析级重试策略）契约。
 *
 * 语义：tool_job 执行失败后，仅「外部 SIGKILL 且非取消请求」（系统 OOM /
 * 资源挤占，同义退出码 137=128+9）判瞬态可重试；其余（nonzero_exit /
 * hard_timeout / 取消 / executor setup 失败）一律确定性不重试。策略默认
 * 关闭（BIOF3_TOOL_RETRY_MAX 未设或 0），加法式接入不改既有失败语义。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const {
  classifyToolJobFailure,
  isRetryEnabled,
  getRetryMax,
} = require('../core/biof3-server/helpers/tool-retry-policy.js');

test('failure classification table: only external SIGKILL (non-cancel) is transient', () => {
  // 瞬态：外部 SIGKILL（系统 OOM / 资源挤占）
  assert.deepEqual(
    classifyToolJobFailure({ signal: 'SIGKILL', cancelRequested: false }),
    { transient: true, reason: 'external_sigkill' },
  );
  // 瞬态：exitCode 137 = 128+9，SIGKILL 同义形态
  assert.deepEqual(
    classifyToolJobFailure({ exitCode: 137, cancelRequested: false }),
    { transient: true, reason: 'external_sigkill' },
  );
  // 确定性：SIGKILL 且取消请求——用户主动终止链（terminateOwnedToolJobProcess）留下的 SIGKILL
  assert.deepEqual(
    classifyToolJobFailure({ signal: 'SIGKILL', cancelRequested: true }),
    { transient: false, reason: 'cancelled' },
  );
  // 确定性：nonzero exit
  assert.deepEqual(
    classifyToolJobFailure({ exitCode: 1 }),
    { transient: false, reason: 'nonzero_exit' },
  );
  // 确定性：硬超时（enforceHardTimeout 置 active.timedOut）
  assert.deepEqual(
    classifyToolJobFailure({ timedOut: true }),
    { transient: false, reason: 'hard_timeout' },
  );
  // 确定性：executor setup 失败
  assert.deepEqual(
    classifyToolJobFailure({ setupFailure: true }),
    { transient: false, reason: 'executor_setup_failure' },
  );
  // 确定性：取消请求（无信号形态）
  assert.deepEqual(
    classifyToolJobFailure({ cancelRequested: true }),
    { transient: false, reason: 'cancelled' },
  );
  // 边界加固：硬超时的 TERM→KILL 升级也留 SIGKILL 形态——timedOut 必须优先，判确定性
  assert.deepEqual(
    classifyToolJobFailure({ signal: 'SIGKILL', timedOut: true }),
    { transient: false, reason: 'hard_timeout' },
  );
  // 边界加固：child_process 字符串错误码（ENOENT / maxBuffer 超限）不会与数字 137 混淆
  assert.equal(classifyToolJobFailure({ exitCode: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }).transient, false);
  assert.equal(classifyToolJobFailure({ exitCode: 'ENOENT' }).transient, false);
  // 边界加固：非 SIGKILL 信号（如 SIGTERM）不判瞬态
  assert.equal(classifyToolJobFailure({ signal: 'SIGTERM' }).transient, false);
});

test('retry gate reads env per call: default off, BIOF3_TOOL_RETRY_MAX=2 turns it on', () => {
  // env 名是契约本身，直写字面量（直引 process.env 属性，不取计算成员）。
  const hadOwn = Object.prototype.hasOwnProperty.call(process.env, 'BIOF3_TOOL_RETRY_MAX');
  const saved = process.env.BIOF3_TOOL_RETRY_MAX;
  try {
    delete process.env.BIOF3_TOOL_RETRY_MAX;
    assert.equal(isRetryEnabled(), false, 'default must be off (no env)');
    assert.equal(getRetryMax(), 0);
    assert.equal(isRetryEnabled(), false, 'import-time caching would break this; gate must read env per call');
    process.env.BIOF3_TOOL_RETRY_MAX = '2';
    assert.equal(isRetryEnabled(), true);
    assert.equal(getRetryMax(), 2);
    // 显式 0 / 非法值 / 负数一律回退关闭
    process.env.BIOF3_TOOL_RETRY_MAX = '0';
    assert.equal(isRetryEnabled(), false);
    assert.equal(getRetryMax(), 0);
    process.env.BIOF3_TOOL_RETRY_MAX = 'not-a-number';
    assert.equal(isRetryEnabled(), false);
    assert.equal(getRetryMax(), 0);
    process.env.BIOF3_TOOL_RETRY_MAX = '-3';
    assert.equal(isRetryEnabled(), false);
    assert.equal(getRetryMax(), 0);
  } finally {
    if (hadOwn) process.env.BIOF3_TOOL_RETRY_MAX = saved;
    else delete process.env.BIOF3_TOOL_RETRY_MAX;
  }
});

test('tools-executor failure path consults the retry policy before markJobFailed', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'core/biof3-server/helpers/tools-executor.js'),
    'utf8',
  );
  assert.ok(src.includes("require('./tool-retry-policy')"), 'executor must wire the policy module');
  assert.ok(src.includes('classifyToolJobFailure('), 'failure path must consult classifyToolJobFailure');
  assert.ok(src.includes('isRetryEnabled()'), 'retry gate must check isRetryEnabled()');
  assert.ok(src.includes('getRetryMax()'), 'retry budget must read getRetryMax()');
  // 分类引用点先于失败分支的 markJobFailed 终态收敛（execute 阶段）
  const classifyAt = src.indexOf('classifyToolJobFailure(');
  const markFailedAt = src.indexOf("await markJobFailed(jobId, failureMessage, 'execute')");
  assert.ok(markFailedAt > -1, 'execute-stage markJobFailed call must exist');
  assert.ok(classifyAt > -1 && classifyAt < markFailedAt, 'classification must be consulted before the terminal failure transition');
  // 额度耗尽的失败消息注明已重试次数
  assert.ok(src.includes('已重试'), 'exhausted-retry failure message must state the retry count');
});

test('retry bookkeeping honors the async db facade (regression: un-awaited reads made the budget infinite)', () => {
  // db 是 async facade（db/connection.js createAsyncDatabaseFacade）：prepare().get()
  // 返回 Promise。漏 await 时 Promise?.retry_count 恒 undefined → retryCount 恒 0 →
  // 预算判定 retryCount < retryMax 永不耗尽（无界 requeue churn）。
  const src = fs.readFileSync(
    path.join(ROOT, 'core/biof3-server/helpers/tools-executor.js'),
    'utf8',
  );
  assert.ok(
    src.includes("(await db.prepare('SELECT retry_count FROM tool_jobs WHERE id=?').get(jobId))"),
    'retry-count read must await the async db facade',
  );
  // requeue 必须排除测试作业：泵候选 SELECT 同滤 is_test_run = 0，测试作业重排会被
  // 泵永久忽略、搁浅 pending 直到僵尸扫描误标 failed（并发槽同被占用）。
  assert.ok(
    src.includes("WHERE id=? AND status='running' AND is_test_run = 0"),
    'retry requeue UPDATE must exclude test runs (outside the pump domain)',
  );
});
