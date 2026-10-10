'use strict';

/**
 * C-23（BLOCK-144 技术债清尾批）· finalizeJobRun 与 pumpQueuedToolJobs 行为级补测。
 *
 * 覆盖缺口（BLOCK-135 冷复核 F6）：既有覆盖只有取消收敛 e2e（block141）、
 * 分类排序/工厂单定义/重试接线源码契约（block141:250 / block57 / block135-retry-policy），
 * 五条行为路径无覆盖：
 *   ① finalizeJobRun 正常完成路径（status=completed + provenance 落库）；
 *   ② 失败路径（markJobFailed 分支，重试默认关）；
 *   ③ 取消 durable 慢路径（行已 cancelled、flag 未置位 → finalizeCancellation，
 *      block141 只钉了 flag 置位快路径）；
 *   ④ 队列泵 pending 拉起 + maxConcurrent 上限 + 槽位释放后排空；
 *   ⑤ 泵空转（无 pending：只发候选 SELECT、零迭代、零拉起）。
 *
 * harness 与 block141/block130 同构：真 SQLite（生产 migration 链）+ db.js 异步
 * facade + 真工厂 createToolsExecutor + 真子进程（执行器注册表钉 node 自身，
 * 零外部运行时依赖）。HK-01：④按「槽位释放后排空」契约先落红（现状缺陷见
 * 该用例注释），实证后修产品代码转绿；①②③⑤能直接写绿=该路径本可测，如实记录。
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

// ── 共享 harness（单进程单 db.js 单例） ─────────────────────────────
process.env.PETRI_DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block144-c23-')),
  'petri.db',
);
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(ROOT, 'src', 'migrations'));
const dbMod = require('../core/petri-server/db.js');
const db = dbMod.getAsyncDatabase();

const tempDir = path.dirname(process.env.PETRI_DB_PATH);
const jobsDir = path.join(tempDir, 'tool-jobs');
const scriptsDir = path.join(tempDir, 'tool-scripts');

// 执行器注册表整体钉 node 自身（block141 同形）：binPath 存在 → preflight 过。
const executorsMod = require('../core/shared-backend/executors');
executorsMod.getExecutor = (lang) => ({
  name: lang,
  binPath: process.execPath,
  buildSpawnCommand: (script, jobDir) => ({ cmd: process.execPath, args: [script, jobDir] }),
  checkPackageInstalled: () => ({ checked: true, missing: [] }),
  getRuntimeVersion: () => 'block144-c23-test-node',
});

// 两个测试插件：
//  - c23full：声明 required 产物 summary.csv，脚本真实产出 → 走完 artifact truth
//    + provenance 完成链（①用）。
//  - c23lite：无 required 产物，脚本按 params.mode 分行为（ok/boom/sleep），
//    服务 ②失败 ③取消 ④泵。
const pluginRoot = path.join(tempDir, 'plugins');
function writePlugin(pluginId, outputs, scriptBody) {
  const pluginDir = path.join(pluginRoot, pluginId);
  fs.mkdirSync(path.join(pluginDir, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({ id: pluginId, name: pluginId, version: '0.0.1', language: 'python' }),
  );
  fs.writeFileSync(
    path.join(pluginDir, 'tool-definition.json'),
    JSON.stringify({ id: pluginId, name: pluginId, version: '0.0.1', language: 'python', inputs: [], outputs }),
  );
  fs.writeFileSync(path.join(pluginDir, 'scripts', pluginId + '.py'), scriptBody);
  return { id: pluginId, language: 'python', pluginDir, scriptPath: path.join(pluginDir, 'scripts') };
}

const c23Full = writePlugin(
  'c23full',
  [{ id: 'summary_csv', type: 'file', filename: 'summary.csv', required: true }],
  [
    "const fs = require('fs');",
    "const path = require('path');",
    "const jobDir = process.argv[2];",
    "fs.mkdirSync(path.join(jobDir, 'output'), { recursive: true });",
    "fs.writeFileSync(path.join(jobDir, 'output', 'summary.csv'), 'gene,padj' + String.fromCharCode(10) + 'TP53,0.01' + String.fromCharCode(10));",
    "process.exit(0);",
    '',
  ].join('\n'),
);

const c23Lite = writePlugin(
  'c23lite',
  [],
  [
    "const fs = require('fs');",
    "const path = require('path');",
    "const jobDir = process.argv[2];",
    "fs.mkdirSync(path.join(jobDir, 'output'), { recursive: true });",
    "let mode = 'ok';",
    "try { mode = (JSON.parse(fs.readFileSync(path.join(jobDir, 'params.json'), 'utf8')).mode) || 'ok'; } catch {}",
    "if (mode === 'sleep') {",
    "  let sleepMs = 2500;",
    "  try { sleepMs = JSON.parse(fs.readFileSync(path.join(jobDir, 'params.json'), 'utf8')).sleepMs || 2500; } catch {}",
    "  fs.writeFileSync(path.join(jobDir, 'output', 'started.marker'), 'running');",
    "  setTimeout(() => process.exit(0), sleepMs);",
    "} else if (mode === 'boom') {",
    "  console.error('C23-BOOM-STDERR');",
    "  process.exit(3);",
    "} else {",
    "  fs.writeFileSync(path.join(jobDir, 'output', 'done.marker'), 'ok');",
    "  process.exit(0);",
    "}",
    '',
  ].join('\n'),
);

// 测试进程独占替换全局插件注册表（block141 同形；本文件即唯一消费者）。
globalThis._petriPlugins = new Map();
globalThis._petriPlugins.set(c23Full.id, c23Full);
globalThis._petriPlugins.set(c23Lite.id, c23Lite);

const notifyStub = {
  toolJobFailed() {},
  toolJobCompleted() {},
  custom() {},
};

const { createToolsExecutor } = require('../core/petri-server/helpers/tools-executor.js');
const executor = createToolsExecutor({
  db,
  dbMod,
  config: {
    localResultsDir: tempDir,
    mkdirSandbox: (p) => fs.mkdirSync(p, { recursive: true }),
  },
  notify: notifyStub,
  jobsDir,
  scriptsDir,
  publicDemoJobIds: new Set(),
  safeJoinUnder: (root, p) => path.join(root, p),
  getUserId: () => 'c23-user',
  isSmokeTestRequest: () => false,
});

// 构造期有一发即忘的启动 zombie 扫描：先让它对空表跑完，避免与测试行竞态
//（block130 同款前提）。
await new Promise((resolve) => setTimeout(resolve, 80));

const { notifyScheduler, setSchedulerPump } = require('../core/petri-server/helpers/tool-job-lifecycle-registry.js');
const { activeToolJobs } = require('../core/petri-server/helpers/tool-job-lifecycle-registry.js');

async function submitToolRun(toolId, params = {}) {
  let response = null;
  await executor.handleToolRun(
    { body: { toolId, params }, headers: {}, isInternal: false, requestId: 'c23-' + Math.random().toString(36).slice(2) },
    {
      json(obj) { response = obj; return this; },
      status(code) { this.statusCode = code; return this; },
    },
  );
  assert.ok(response && response.jobId, 'HTTP 作业受理（jobId 返回），实得 ' + JSON.stringify(response));
  return response.jobId;
}

async function getRow(jobId) {
  return db.prepare('SELECT id, status, error, result_json, retry_count FROM tool_jobs WHERE id = ?').get(jobId);
}

function jobDirOf(jobId) {
  return path.join(jobsDir, jobId);
}

// env 保全（泵的 maxConcurrent 与重试开关都按次读 env）。
// env 名直写字面量（与 block135-retry-policy 同惯例，避开计算成员访问）。
function withEnvClean(run) {
  const hadMax = Object.prototype.hasOwnProperty.call(process.env, 'PETRI_TOOL_MAX_CONCURRENT');
  const savedMax = process.env.PETRI_TOOL_MAX_CONCURRENT;
  const hadRetry = Object.prototype.hasOwnProperty.call(process.env, 'PETRI_TOOL_RETRY_MAX');
  const savedRetry = process.env.PETRI_TOOL_RETRY_MAX;
  try {
    delete process.env.PETRI_TOOL_MAX_CONCURRENT;
    delete process.env.PETRI_TOOL_RETRY_MAX;
    return run();
  } finally {
    if (hadMax) process.env.PETRI_TOOL_MAX_CONCURRENT = savedMax;
    else delete process.env.PETRI_TOOL_MAX_CONCURRENT;
    if (hadRetry) process.env.PETRI_TOOL_RETRY_MAX = savedRetry;
    else delete process.env.PETRI_TOOL_RETRY_MAX;
  }
}

test('C23-① finalizeJobRun 正常完成：status=completed + Artifact Truth + provenance 落库（直接绿：该路径本可测）', async () => {
  await withEnvClean(async () => {
    const jobId = await submitToolRun('c23full', {});
    const row = await waitUntil(async () => {
      const current = await getRow(jobId);
      return current && current.status === 'completed' ? current : null;
    }, '作业收敛 completed', 20000, async () => ({ row: await getRow(jobId) }));
    assert.equal(row.error, null);

    const result = JSON.parse(row.result_json);
    const outDir = path.join(jobDirOf(jobId), 'output');
    // 完成面：结果绑定本作业真实目录
    assert.equal(result.toolJobId, jobId);
    assert.equal(result.resultDir, outDir);
    assert.equal(result.outputDir, outDir);
    // run.log 落盘（finalizer 统一 STDOUT/STDERR/EXIT 汇总）
    const runLog = fs.readFileSync(path.join(outDir, 'run.log'), 'utf8');
    assert.ok(runLog.includes('=== STDOUT ==='), 'run.log 必须含 STDOUT 段');
    assert.ok(runLog.includes('OK'), '成功作业 run.log EXIT 段应为 OK');
    // Artifact Truth：required 产物在案且带 sha256
    const summary = (result.artifacts || []).find((item) => item && item.filename === 'summary.csv');
    assert.ok(summary, 'artifacts 必须含声明的 summary.csv：' + JSON.stringify(result.artifacts));
    assert.match(String(summary.sha256 || ''), /^[a-f0-9]{64}$/, '产物必须带 sha256');
    assert.equal(summary.path, path.join(outDir, 'summary.csv'));
    // provenance 落库：executionProvenance + provenanceRef 与磁盘 provenance.json 同源
    assert.ok(result.executionProvenance && result.executionProvenance.provenanceHash, 'result 必须附 executionProvenance');
    assert.equal(result.provenanceRef.toolJobId, jobId);
    assert.equal(result.provenanceRef.path, path.join(jobDirOf(jobId), 'provenance.json'));
    const onDisk = JSON.parse(fs.readFileSync(result.provenanceRef.path, 'utf8'));
    assert.equal(onDisk.provenanceHash, result.provenanceRef.provenanceHash, 'provenanceRef 哈希必须与落盘 provenance.json 一致');
    // is_test_run=0：jobDir 保留（provenance.json 在场即证），测试作业才清理
    assert.equal(fs.existsSync(path.join(jobDirOf(jobId), 'provenance.json')), true);
  });
});

test('C23-② finalizeJobRun 失败路径：markJobFailed 分支收敛 failed + failure 真值（重试默认关，不重排；直接绿）', async () => {
  await withEnvClean(async () => {
    // 前提钉死：重试策略默认关闭（PETRI_TOOL_RETRY_MAX 未设），失败直落终态不重排
    assert.equal(Object.prototype.hasOwnProperty.call(process.env, 'PETRI_TOOL_RETRY_MAX'), false);
    const jobId = await submitToolRun('c23lite', { mode: 'boom' });
    const row = await waitUntil(async () => {
      const current = await getRow(jobId);
      return current && current.status === 'failed' ? current : null;
    }, '作业收敛 failed', 20000, async () => ({ row: await getRow(jobId) }));

    assert.ok(
      String(row.error || '').includes('C23-BOOM-STDERR'),
      '失败消息必须带子进程 stderr，实得：' + String(row.error || '').slice(0, 200),
    );
    const result = JSON.parse(row.result_json);
    assert.deepEqual(result.failure, { phase: 'execute', reason: 'nonzero_exit', exitCode: 3 });
    assert.equal(result.toolJobId, jobId);
    // 未重排：retry_count 仍为 0 且行不在 pending
    assert.equal(row.retry_count ?? 0, 0, '重试关闭时不得重排（retry_count 不增）');
    assert.equal(row.status, 'failed');
  });
});

test('C23-③ finalizeJobRun 取消 durable 慢路径：行已 cancelled、flag 未置位 → 收敛 cancelled 不翻 completed（直接绿）', async () => {
  await withEnvClean(async () => {
    const jobId = await submitToolRun('c23lite', { mode: 'sleep' });
    const dir = jobDirOf(jobId);
    await waitUntil(
      () => fs.existsSync(path.join(dir, 'output', 'started.marker')),
      '子进程真实运行（started.marker）',
    );

    // 取消路由的 durable 落库（routes/tools-platform.js:97-112 同形 SQL）——
    // 不调 killLocalToolJob，owner.cancelRequested 保持 false，单测 :1090 分支：
    // 脚本自退（exit 0）后 finalize 必须按 durable cancelled 收敛，不得走进完成链。
    await db
      .prepare(
        'UPDATE tool_jobs SET status=?, error=?, completed_at=?, process_pid=?, heartbeat_at=? '
        + 'WHERE id=? AND status IN (?,?,?)',
      )
      .run('cancelled', null, Date.now(), null, null, jobId, 'pending', 'running', 'cancelled');

    // 等待谓词必须是「cancelled 且 result_json 已由 finalize 的 settle 落库」：
    // 外部 UPDATE 自己就会把 status 置 cancelled，单等 status 会立刻假满足。
    const row = await waitUntil(async () => {
      const current = await getRow(jobId);
      return current && current.status === 'cancelled' && current.result_json != null ? current : null;
    }, '脚本自退后 finalize 按 durable cancelled 收敛（settle 落 result_json）', 20000, async () => ({ row: await getRow(jobId) }));

    assert.equal(row.status, 'cancelled', '成功退出也不得翻转为 completed——取消分类先于完成链');
    assert.equal(row.error, null);
    const result = JSON.parse(row.result_json);
    assert.deepEqual(result.cancellation, {
      phase: 'execute',
      reason: 'user_stop',
      terminalStatus: 'cancelled',
      processExitConfirmed: true,
    });
  });
});

test('C23-④ 队列泵：pending 按创建序拉起、槽位释放后排空、maxConcurrent 上限（HK-01 红转绿）', async () => {
  await withEnvClean(async () => {
    // 用户 A（默认 max=2）：两行排队——契约：槽位释放后按创建序拉起并最终排空
    const insert = dbMod.db.prepare(
      "INSERT INTO tool_jobs (id, user_id, tool_id, params_json, status, is_test_run, created_at) VALUES (?, ?, 'c23lite', ?, 'pending', 0, ?)",
    );
    const mkQueuedJob = (id, userId, createdAt, params = { mode: 'ok' }) => {
      fs.mkdirSync(jobDirOf(id), { recursive: true });
      fs.writeFileSync(path.join(jobDirOf(id), 'params.json'), JSON.stringify(params));
      insert.run(id, userId, JSON.stringify(params), createdAt);
    };
    // a1 慢作业（1200ms）：让 running 窗口可确定性观察「a1 运行中 a2 仍在排队」；
    // a2 快作业：a1 终态触发下一泵后排空。
    mkQueuedJob('c23q_a1', 'c23-pump-a', Date.now(), { mode: 'sleep', sleepMs: 1200 });
    mkQueuedJob('c23q_a2', 'c23-pump-a', Date.now() + 1);

    notifyScheduler(); // 工厂已注册真泵（共享 registry）

    // 槽位释放契约：首个排队作业必须被拉起（现行产品码计数把 pending 自身与
    // 其它排队行算进并发占用 → A 完成后计数仍 ≥ max → 永不拉起。此断言即红测）。
    await waitUntil(async () => {
      const row = await getRow('c23q_a1');
      return row && row.status !== 'pending' ? row : null;
    }, '泵必须拉起首个排队作业（槽位释放契约；现状：占用计数含 pending 自身→队列搁浅）', 8000,
    async () => ({
      a1: await getRow('c23q_a1'),
      a2: await getRow('c23q_a2'),
    }));

    // 创建序：a1 先于 a2——a1 运行窗口内 a2 必仍在排队（一次泵只拉一个）
    await waitUntil(async () => {
      const row = await getRow('c23q_a1');
      return row && row.status === 'running' ? row : null;
    }, 'a1 进入 running');
    const a2WhileA1Running = await getRow('c23q_a2');
    assert.equal(a2WhileA1Running.status, 'pending', '一次泵只拉一个：a1 运行中 a2 必须仍在排队');

    // 排空：a1 终态触发下一泵 → a2 拉起并完成（队列不死锁）
    await waitUntil(async () => {
      const row = await getRow('c23q_a2');
      return row && row.status === 'completed' ? row : null;
    }, 'a1 终态后泵必须拉起 a2 并排空队列', 20000, async () => ({
      a1: await getRow('c23q_a1'),
      a2: await getRow('c23q_a2'),
    }));
    const a1Final = await getRow('c23q_a1');
    assert.equal(a1Final.status, 'completed');

    // 用户 B（max=1）：上限契约——k1 运行中 k2 不得并发拉起；k1 终态后 k2 才起
    process.env.PETRI_TOOL_MAX_CONCURRENT = '1';
    try {
      mkQueuedJob('c23q_b1', 'c23-pump-b', Date.now(), { mode: 'sleep', sleepMs: 1200 });
      mkQueuedJob('c23q_b2', 'c23-pump-b', Date.now() + 1);
      notifyScheduler();
      await waitUntil(async () => {
        const row = await getRow('c23q_b1');
        return row && row.status === 'running' ? row : null;
      }, 'max=1 时 k1 被拉起', 8000, async () => ({ b1: await getRow('c23q_b1'), b2: await getRow('c23q_b2') }));
      const b2WhileK1Running = await getRow('c23q_b2');
      assert.equal(b2WhileK1Running.status, 'pending', 'maxConcurrent=1：k1 运行中 k2 不得拉起');
      await waitUntil(async () => {
        const row = await getRow('c23q_b2');
        return row && row.status === 'completed' ? row : null;
      }, 'k1 终态释放槽位后 k2 拉起排空', 20000, async () => ({
        b1: await getRow('c23q_b1'),
        b2: await getRow('c23q_b2'),
      }));
    } finally {
      delete process.env.PETRI_TOOL_MAX_CONCURRENT;
    }
  });
});

test('C23-⑤ 泵空转：无 pending 时只发一条候选 SELECT、零迭代、零拉起（直接绿）', async () => {
  // 独立工厂 + 计数 facade（block130 同形）：按 SQL 精确计数观察泵的空转形态。
  const counters = { pumpSelectCalls: 0, perUserCountCalls: 0 };
  const countingDb = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        run: (...p) => stmt.run(...p),
        get: (...p) => {
          if (sql.includes('SELECT COUNT(*) AS n FROM tool_jobs WHERE user_id = ?')) counters.perUserCountCalls += 1;
          return stmt.get(...p);
        },
        all: (...p) => {
          if (sql.includes('ORDER BY created_at ASC LIMIT 50')) counters.pumpSelectCalls += 1;
          return stmt.all(...p);
        },
      };
    },
  };
  const idleJobsDir = path.join(tempDir, 'tool-jobs-idle'); // 存在但无任何作业行
  fs.mkdirSync(idleJobsDir, { recursive: true });
  // 隔离防御：清掉任何前序用例可能的 pending 残留（如 ④ 缺陷复现时的搁浅行），
  // 保证「空转」前提 = 候选 SELECT 真空。
  dbMod.db.prepare("DELETE FROM tool_jobs WHERE status = 'pending'").run();
  const idleExecutor = createToolsExecutor({
    db: countingDb,
    dbMod,
    config: { localResultsDir: tempDir, mkdirSandbox: (p) => fs.mkdirSync(p, { recursive: true }) },
    notify: notifyStub,
    jobsDir: idleJobsDir,
    scriptsDir,
    publicDemoJobIds: new Set(),
    safeJoinUnder: (root, p) => path.join(root, p),
    getUserId: () => 'c23-idle-user',
    isSmokeTestRequest: () => true, // 空转面测试：不产生真实作业
  });
  assert.ok(typeof idleExecutor.handleToolRun === 'function', '空转工厂构造成功');
  await new Promise((resolve) => setTimeout(resolve, 80)); // 启动扫描对空表跑完

  const activeBefore = activeToolJobs.size;
  notifyScheduler(); // 本工厂的泵已覆盖共享 registry 槽位
  await new Promise((resolve) => setTimeout(resolve, 150));

  try {
    assert.equal(counters.pumpSelectCalls, 1, '一次泵 tick 恰好一条候选 SELECT');
    assert.equal(counters.perUserCountCalls, 0, '无候选行时不得进入逐行迭代（零 per-user 计数）');
    assert.equal(activeToolJobs.size, activeBefore, '空转不得拉起任何作业');
  } finally {
    setSchedulerPump(null); // 不把本文件注册的泵留给后续测试
  }
});
