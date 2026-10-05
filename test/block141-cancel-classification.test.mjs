'use strict';

/**
 * BLOCK-141 · BLOCK-128-① 取消终态竞窗分类契约（HK-01 红绿先行）。
 *
 * 实机实证（acceptance/block-128/ 走查 + docs/AUDIT-LOG.md 2026-10-01 🟡①）：
 *   SIGTERM 击杀在途 agent 作业后，finalize 未按取消分类，终态落 failed
 *   而非 cancelled（两次实机呈两种交错：
 *   heartbeat-timeline.txt → 409 job_no_longer_cancellable（finalize 先落 failed）；
 *   acceptance-live.json   → cancel 200 ok:true 后终态仍 failed（finalize 后写覆盖））。
 *
 * 竞窗机制（本文件诊断锚点）：
 *   - 取消链置位时序：killLocalToolJob（tools-executor.js:166）→
 *     requestActiveToolJobCancellation（active-job.js:62）同步置位
 *     owner.cancelRequested 后才 SIGTERM——HTTP 链（finalizeJobRun）在
 *     :1086/:1090 依 flag/durable 双检查收敛 cancelled，in-process 无竞窗。
 *   - agent/MCP 链（run-plugin-script.js _runPluginScript）：execFile 回调
 *     （:730-735）直接 finalizePluginRun——全程不检查 owner.cancelRequested
 *     与 durable status；err 分支（:391）与 artifact 校验分支（:582）经
 *     db.updateToolJob（db.js:149 无 status CAS，COALESCE 按 id 覆写）无条件
 *     落 failed——取消击杀与取消落库之间 close 事件先到时，取消分类被
 *     失败/artifact 分支覆盖。
 *
 * 契约：取消击杀已发出（owner.cancelRequested 置位 + SIGTERM 终止在途）后，
 *   finalize 必须先于 artifact 校验/失败分支把作业收敛为 cancelled，
 *   取消路由的 durable cancelled 落库无论先后到达都不得被翻转为 failed。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PLUGIN_ID = 'block141sleeper';

async function waitUntil(fn, label, timeoutMs = 20000, debugFn = null) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try { value = await fn(); } catch { value = null; }
    if (value) return value;
    if (Date.now() > deadline) {
      let observed = '';
      if (debugFn) {
        try { observed = ' | observed=' + JSON.stringify(await debugFn()); } catch (e) { observed = ' | observed-err=' + e.message; }
      }
      throw new Error('waitUntil 超时: ' + label + observed);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// ── 共享 harness（单进程单 db.js 单例；两测试共用同一 tmp/db） ──────────
// 形态与 test/block130-queue.test.mjs 同构：BIOF3_DB_PATH → 生产 migration 链
// → db.js 异步 facade。执行器 binPath 钉 process.execPath（零外部运行时依赖，
// 插件脚本以 JS 内容落地、扩展名不影响执行）。
process.env.BIOF3_DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-block141-')),
  'biof3.db',
);
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.BIOF3_DB_PATH, path.join(ROOT, 'src', 'migrations'));
const dbMod = require('../core/biof3-server/db.js');
const db = dbMod.getAsyncDatabase();

const tempDir = path.dirname(process.env.BIOF3_DB_PATH);
const pluginDir = path.join(tempDir, 'plugins', PLUGIN_ID);
fs.mkdirSync(path.join(pluginDir, 'scripts'), { recursive: true });
fs.writeFileSync(
  path.join(pluginDir, 'plugin.json'),
  JSON.stringify({ id: PLUGIN_ID, name: 'BLOCK-141 cancel race probe', version: '0.0.1', language: 'python' }),
);
// outputs 声明 required 产物：取消竞窗下 finalize 若走进 artifact 校验分支，
// 必然以 "Required artifact … was not produced"（artifact-truth.js:313）误分类——
// 与实机走查观察同形。
fs.writeFileSync(
  path.join(pluginDir, 'tool-definition.json'),
  JSON.stringify({
    id: PLUGIN_ID,
    name: 'BLOCK-141 cancel race probe',
    version: '0.0.1',
    language: 'python',
    inputs: [],
    outputs: [
      { id: 'summary_csv', type: 'file', filename: 'summary.csv', required: true },
      { id: 'zip', type: 'file', filename: 'all_results.zip', required: true },
    ],
  }),
);
fs.writeFileSync(
  path.join(pluginDir, 'scripts', PLUGIN_ID + '.py'),
  [
    "const fs = require('fs');",
    "const path = require('path');",
    "const jobDir = process.argv[2];",
    "fs.writeFileSync(path.join(jobDir, 'output', 'started.marker'), 'running');",
    "setTimeout(() => process.exit(0), 120000);",
    '',
  ].join('\n'),
);
// 测试进程独占替换全局插件注册表（本文件即该注册表的唯一消费者，无需保存恢复——
// 原 `const realPlugins = globalThis._biof3Plugins` 从未回读，no-unused-vars 真修删除）。
globalThis._biof3Plugins = new Map();
globalThis._biof3Plugins.set(PLUGIN_ID, {
  id: PLUGIN_ID,
  language: 'python',
  pluginDir,
  scriptPath: path.join(pluginDir, 'scripts'),
});

// 执行器注册表钉 node 自身：binPath 存在 → runtime preflight 通过（BLOCK-66 门）。
// 仓内注册表只有 R（getExecutor('python') 直接 throw），这里整体替换为测试执行器。
const executorsMod = require('../core/shared-backend/executors');
executorsMod.getExecutor = (lang) => ({
  name: lang,
  binPath: process.execPath,
  buildSpawnCommand: (script, jobDir) => ({ cmd: process.execPath, args: [script, jobDir] }),
  checkPackageInstalled: () => ({ checked: true, missing: [] }),
  getRuntimeVersion: () => 'block141-test-node',
});

const { activeToolJobs } = require('../core/biof3-server/helpers/tool-job-lifecycle-registry.js');
const { requestActiveToolJobCancellation } = require('../core/biof3-server/helpers/tools-executor/active-job.js');

test('BLOCK-128-① 竞窗契约：取消击杀在途时 finalize 必须落 cancelled（分类先于 artifact/失败分支；HK-01 红转绿）', async () => {
  const { _runPluginScript } = require('../core/biof3-server/mcp/registry/run-plugin-script.js');
  const toolJobId = 'tj_block141_race';
  const jobDir = path.join(tempDir, 'tool-jobs', toolJobId);
  fs.mkdirSync(path.join(jobDir, 'output'), { recursive: true });
  const seams = {
    resolveJobLayout: () => ({ jobDir, outputDir: path.join(jobDir, 'output') }),
    createMcpExecutionContext: () => ({ context: {}, canonicalizePath: (p) => p }),
    runPluginToolRemote: async () => { throw new Error('remote seam must not be used'); },
  };
  const plugin = { id: PLUGIN_ID, language: 'python', pluginDir };
  const scriptPath = path.join(pluginDir, 'scripts', PLUGIN_ID + '.py');

  const runPromise = _runPluginScript(
    dbMod, null, plugin, scriptPath, {}, 'block141-user',
    null, null, null, null, seams,
  );

  // 等 owner 登记 + 子进程起跑（agent 路径作业 id 由 db.createToolJob 生成前未知，
  // 这里以固定 existingToolJobId 不适用——从共享登记表按 toolId 探测）。
  let ownerJobId = null;
  await waitUntil(() => {
    for (const [id, owner] of activeToolJobs) {
      if (owner.toolId === PLUGIN_ID) {
        ownerJobId = id;
        return owner.process || null;
      }
    }
    return null;
  }, 'agent 路径 owner 登记且子进程已 spawn');
  await waitUntil(
    () => fs.existsSync(path.join(jobDir, 'output', 'started.marker')),
    '子进程真实运行（started.marker）',
  );

  // 生产取消链原语：killLocalToolJob 的返回值就是 requestActiveToolJobCancellation
  // （tools-executor.js:175）——flag 置位 + SIGTERM，与实机取消走查同形。
  const cancelResult = requestActiveToolJobCancellation(activeToolJobs, ownerJobId);
  assert.equal(cancelResult.active, true, '取消必须命中在途 owner（实机 local.active=true 同形）');
  assert.equal(cancelResult.processStarted, true, '击杀必须落在已 spawn 的子进程上');

  // 取消路由的 durable 落库（routes/tools-platform.js:97-112 同形 SQL）——
  // 竞窗的另一侧：无论它与 finalize 谁先谁后（实机两种交错都出现过），
  // 终态都必须收敛 cancelled。
  await db
    .prepare(
      'UPDATE tool_jobs SET status=?, error=?, completed_at=?, process_pid=?, heartbeat_at=? '
      + 'WHERE id=? AND status IN (?,?,?)',
    )
    .run('cancelled', null, Date.now(), null, null, ownerJobId, 'pending', 'running', 'cancelled');

  await runPromise;

  const row = await db.prepare('SELECT status, error FROM tool_jobs WHERE id = ?').get(ownerJobId);
  assert.equal(
    row.status,
    'cancelled',
    '取消击杀后终态必须 cancelled；当前落 ' + row.status + '（误分类证据 error=' + String(row.error || '').slice(0, 120) + '）'
      + '——实机走查 acceptance/block-128/acceptance-live.json 同形',
  );
});

test('BLOCK-128-① 对照组：HTTP finalizeJobRun 链 in-process 取消收敛 cancelled + ③ ownership pid 落库', async () => {
  const { createToolsExecutor } = require('../core/biof3-server/helpers/tools-executor.js');
  const jobsDir = path.join(tempDir, 'tool-jobs-http');
  const executor = createToolsExecutor({
    db,
    dbMod,
    config: {
      localResultsDir: tempDir,
      mkdirSandbox: (p) => fs.mkdirSync(p, { recursive: true }),
    },
    notify: { toolJobFailed() {}, toolJobCompleted() {} },
    jobsDir,
    scriptsDir: path.join(tempDir, 'tool-scripts'),
    publicDemoJobIds: new Set(),
    safeJoinUnder: (root, p) => path.join(root, p),
    getUserId: () => 'block141-user',
    isSmokeTestRequest: () => true,
  });

  let response = null;
  await executor.handleToolRun(
    { body: { toolId: PLUGIN_ID, params: {} }, headers: {}, isInternal: false, requestId: 'block141-http' },
    {
      json(obj) { response = obj; return this; },
      status(code) { this.statusCode = code; return this; },
    },
  );
  assert.ok(response && response.jobId, 'HTTP 作业受理（jobId 返回）');
  const jobId = response.jobId;

  await waitUntil(() => activeToolJobs.get(jobId)?.process || null, 'HTTP 路径子进程 spawn');

  // ③ 写入点核实（tools-executor.js:1722-1724 ownership UPDATE child.pid）：
  // HTTP 路径必须落 pid；实机走查 pid=null 的是 agent 路径（无此 UPDATE）。
  await waitUntil(async () => {
    const row = await db.prepare('SELECT process_pid FROM tool_jobs WHERE id = ?').get(jobId);
    return row && row.process_pid != null ? row.process_pid : null;
  }, 'HTTP 路径 process_pid 落库（ownership UPDATE 生效）', 20000, async () => ({
    row: await db.prepare('SELECT status, process_pid, error FROM tool_jobs WHERE id = ?').get(jobId),
    owner: (() => { const o = activeToolJobs.get(jobId); return o ? { phase: o.phase, hasProcess: !!o.process } : null; })(),
  }));

  await waitUntil(
    () => fs.existsSync(path.join(jobsDir, jobId, 'output', 'started.marker')),
    'HTTP 路径子进程真实运行',
  );

  const local = executor.killLocalToolJob(jobId);
  assert.equal(local.active, true, 'killLocalToolJob 命中在途 owner');

  const row = await waitUntil(async () => {
    const current = await db.prepare('SELECT status FROM tool_jobs WHERE id = ?').get(jobId);
    return ['cancelled', 'failed', 'completed'].includes(current.status) ? current : null;
  }, 'HTTP 路径终态收敛');
  assert.equal(row.status, 'cancelled', 'HTTP 链（flag 置位先于 SIGTERM）终态必须 cancelled——当前即绿，作对照组钉住');
});

test('BLOCK-128-① 源码契约：createJobRunFinalizer 取消分类先于 artifact 真值校验（回归守护）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/biof3-server/helpers/tools-executor.js'), 'utf8');
  const start = src.indexOf('function createJobRunFinalizer');
  const end = src.indexOf('async function executeJob');
  assert.ok(start > 0 && end > start, 'createJobRunFinalizer 工厂在 executeJob 之前');
  const finalizerSrc = src.slice(start, end);

  const flagCheck = finalizerSrc.indexOf('if (active && active.cancelRequested)');
  const durableCheck = finalizerSrc.indexOf("currentJob.status === 'cancelled'");
  const truthCheck = finalizerSrc.indexOf('reconcileArtifactTruth');
  assert.ok(flagCheck > 0, 'finalize 入口必须检查 owner.cancelRequested（flag 置位路径）');
  assert.ok(durableCheck > 0, 'finalize 入口必须检查 durable cancelled（跨进程慢路径）');
  assert.ok(truthCheck > 0, 'artifact 真值校验必须在场');
  assert.ok(flagCheck < truthCheck && durableCheck < truthCheck,
    '取消分类（flag + durable）必须先于 artifact 真值校验——竞窗契约的排序不变量');
});
