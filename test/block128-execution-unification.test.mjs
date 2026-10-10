'use strict';

/**
 * BLOCK-128（G0-PLATFORM PL-1）— 执行语义统一契约。
 *
 * agent/MCP 同步路径（run-plugin-script）并入 tool_jobs 异步装置：
 * 共享 activeToolJobs（心跳+僵尸扫描+取消链+硬超时全覆盖）、并发准入
 * 与 HTTP 路径同语义、execFile 内建 300s 退役（硬预算统一走
 * PETRI_TOOL_HARD_TIMEOUT_MS 默认 30min）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the active tool-job registry is a process-level singleton shared by both execution paths', () => {
  const { activeToolJobs } = require('../core/petri-server/helpers/tool-job-lifecycle-registry.js');
  const executorSrc = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/tools-executor.js'), 'utf8');
  const mcpSrc = fs.readFileSync(path.join(ROOT, 'core/petri-server/mcp/registry/run-plugin-script.js'), 'utf8');
  assert.ok(activeToolJobs instanceof Map, 'registry exports the shared Map');
  assert.ok(executorSrc.includes('tool-job-lifecycle-registry'), 'executor must consume the shared registry');
  assert.ok(!/const activeToolJobs = new Map\(\)/.test(executorSrc), 'executor must not keep a private Map');
  assert.ok(mcpSrc.includes('claimActiveToolJob'), 'mcp path must claim ownership');
  assert.ok(mcpSrc.includes('armActiveToolJobLifecycle'), 'mcp path must arm heartbeat + hard timeout');
  assert.ok(mcpSrc.includes('releaseActiveToolJob'), 'mcp path must release ownership on finalize');
});

test('the mcp execFile path retires the built-in 300s cap and arms the shared hard budget', () => {
  const mcpSrc = fs.readFileSync(path.join(ROOT, 'core/petri-server/mcp/registry/run-plugin-script.js'), 'utf8');
  assert.ok(!mcpSrc.includes('timeout: 300000'), '300s literal must be gone');
  assert.ok(/timeout: 0/.test(mcpSrc), 'execFile built-in timeout must be disabled (hard budget owns the ceiling)');
  assert.ok(mcpSrc.includes('resolveLifecycleDurations'), 'hard budget must come from the shared lifecycle durations');
});

test('the mcp path enforces the same per-user concurrency admission as the http path', async () => {
  const { countActiveUserToolJobs } = require('../core/petri-server/helpers/tool-job-lifecycle-registry.js');
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE tool_jobs (id TEXT PRIMARY KEY, user_id TEXT, status TEXT);`);
  const insert = sqlite.prepare('INSERT INTO tool_jobs (id, user_id, status) VALUES (?, ?, ?)');
  insert.run('j1', 'u1', 'running');
  insert.run('j2', 'u1', 'pending');
  insert.run('j3', 'u1', 'completed');
  insert.run('j4', 'u2', 'running');
  assert.equal(countActiveUserToolJobs(sqlite, 'u1'), 2, 'pending+running count, terminal excluded');
  assert.equal(countActiveUserToolJobs(sqlite, 'u2'), 1);
  assert.equal(countActiveUserToolJobs(sqlite, 'nobody'), 0);
  sqlite.close();
  const mcpSrc = fs.readFileSync(path.join(ROOT, 'core/petri-server/mcp/registry/run-plugin-script.js'), 'utf8');
  assert.ok(mcpSrc.includes('countActiveUserToolJobs'), 'mcp admission must use the shared counter');
  assert.ok(mcpSrc.includes('max_concurrent'), 'rejection must carry the same contract as the http path');
});

test('shared registry keeps executor behavior intact (claim/release roundtrip)', () => {
  const { activeToolJobs } = require('../core/petri-server/helpers/tool-job-lifecycle-registry.js');
  const { claimActiveToolJob, releaseActiveToolJob } = require('../core/petri-server/helpers/tools-executor/active-job.js');
  const owner = claimActiveToolJob(activeToolJobs, { jobId: 'block128_probe', toolId: 't' });
  assert.ok(owner, 'claim succeeds for a fresh job');
  const second = claimActiveToolJob(activeToolJobs, { jobId: 'block128_probe', toolId: 't' });
  assert.equal(second, null, 'double claim is rejected');
  releaseActiveToolJob(activeToolJobs, 'block128_probe', owner);
  assert.equal(activeToolJobs.has('block128_probe'), false, 'release clears ownership');
});
