#!/usr/bin/env node
/**
 * test/qa-smoke.test.mjs — gate5 qa-smoke.v1 schema 一致性 + 子集断言
 *
 * 这不是 vitest。这里只跑 node --test。
 *
 * 覆盖：
 *   1. scripts/qa-smoke.mjs 跑得起来 + exit 0
 *   2. JSON 输出口径符合 biof3/qa-smoke.v1
 *   3. 关键检查项能在前端现状下通过
 *   4. --check <name> 单跑模式返回一条记录
 */

import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'qa-smoke.mjs');

function runQa(args = []) {
  const r = spawnSync('node', [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('qa-smoke exit=0 且输出 schema biof3/qa-smoke.v1', () => {
  const r = runQa(['--json']);
  assert.equal(r.code, 0, `qa-smoke exit: ${r.code}\n${r.stderr}`);
  const summary = JSON.parse(r.stdout);
  assert.equal(summary.schema, 'biof3/qa-smoke.v1');
  assert.equal(summary.total, 7);
  assert.equal(summary.failed, 0);
  assert.equal(summary.passed, summary.total);
  // 至少：themes / panels / chat / tree / browser / telemetry / report-theme 都有结果
  for (const name of ['themes', 'panels', 'chat', 'tree', 'browser', 'telemetry', 'report-theme']) {
    assert.ok(summary.results[name], `缺少 ${name} 结果`);
    assert.equal(summary.results[name].ok, true, `${name} 应 ok`);
  }
});

test('qa-smoke --json 包含合法 version / startedAt / finishedAt', () => {
  const r = runQa(['--json']);
  assert.equal(r.code, 0);
  const summary = JSON.parse(r.stdout);
  assert.equal(summary.version, 1);
  assert.match(summary.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(summary.finishedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(summary.log, /tmp\/qa-smoke\/.+\.log$/);
});

test('qa-smoke --check themes 仅跑主题检查且 ok=true', () => {
  const r = runQa(['--check', 'themes', '--json']);
  assert.equal(r.code, 0);
  const summary = JSON.parse(r.stdout);
  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 0);
  assert.ok(summary.results.themes, '应有 themes 结果');
  assert.equal(summary.results.themes.ok, true);
  // 其它检查应不在 results 里（被 --check 过滤）
  assert.ok(!summary.results.panels, 'panels 不应在 --check themes 时跑');
});

test('qa-smoke --check telemetry 至少跑出 telemetry 项', () => {
  const r = runQa(['--check', 'telemetry', '--json']);
  assert.equal(r.code, 0);
  const summary = JSON.parse(r.stdout);
  assert.equal(summary.passed, 1);
  assert.ok(summary.results.telemetry, '应有 telemetry 结果');
  assert.equal(summary.results.telemetry.ok, true);
});

test('qa-smoke 日志文件存在且非空', () => {
  const r = runQa(['--json']);
  assert.equal(r.code, 0);
  const summary = JSON.parse(r.stdout);
  // 日志文件路径在 summary.log 字段
  const st = statSync(summary.log);
  assert.ok(st.size > 0, `日志文件应非空: ${summary.log}`);
});

test('qa-smoke summary.total 等于 order 长度（schema 演进时显式失败）', () => {
  const r = runQa(['--json']);
  assert.equal(r.code, 0);
  const summary = JSON.parse(r.stdout);
  // 当前在 qa-smoke.mjs 中 order 数组定义 7 项
  assert.equal(summary.total, 7);
});
