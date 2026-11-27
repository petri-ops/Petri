/**
 * item 87 第二阶段 HK-01 — 教练循环引擎四钉。
 * ①影子决策讲解轨迹钉（每决策点有结构化讲解记录，落 task_events 可回放）
 * ②交接比例滑移钉（随成功记录自动调整，纯函数阈值）
 * ③复盘分歧点结构化钉（五字段结构化，自由文本拒绝）
 * ④反馈对照钉（产物观察 vs 品味样本逐维度结构化对照）
 * 外加：迁移字节一致 / bio 试点域白名单 / 迁移库建表断言。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const requireFrom = (rel) => require_(path.join(ROOT, rel));
const Database = require_(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
const { bootstrapTestDb } = requireFrom('test/helpers/bootstrap-db.mjs');
const dbPath = bootstrapTestDb('item87-coaching-http-');
const {
  DO_COACHING_TABLES,
  ensureDoCoachingSchema,
  buildDoCoachingMigrationSql,
} = requireFrom('core/shared-backend/do-coaching-schema.js');
const {
  PILOT_DOMAINS,
  computeHandoverPhase,
  createCoachingRun,
  recordDecisionExplanation,
  recordReview,
  listDivergences,
  insertTasteSample,
  compareAgainstSamples,
} = requireFrom('core/shared-backend/do-coaching.js');

function freshDb() {
  const db = new Database(':memory:');
  ensureDoCoachingSchema(db);
  // 教练轨迹落 task_events（与 wb/loop 同表；DDL 同形防御，真实库由 store/迁移建）
  db.exec(`CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_task_events_task_seq ON task_events(task_id, seq)');
  return db;
}

test('HK-87c-0：迁移字节一致 + 三表建表 + 试点白名单', () => {
  const sqlPath = path.join(ROOT, 'src', 'migrations', '027_do_coaching.sql');
  assert.ok(fs.existsSync(sqlPath), '迁移 027 应存在');
  assert.equal(buildDoCoachingMigrationSql(), fs.readFileSync(sqlPath, 'utf8'), '迁移文件与 schema 模块逐字节一致');
  assert.deepEqual(PILOT_DOMAINS, ['bioinformatics'], '试点白名单=只 bio');
  const db = freshDb();
  for (const table of DO_COACHING_TABLES) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table), `表应存在 ${table}`);
  }
});

test('HK-87c-1（钉①）：影子决策讲解轨迹——每决策点一条结构化讲解落 task_events 可回放', () => {
  const db = freshDb();
  const run = createCoachingRun(db, { goalId: 'demo_wb_goal_1', taskId: 'demo_agent_task_primary', domain: 'bioinformatics', userId: 'local-user' });
  assert.ok(run.ok, `创建应成功：${JSON.stringify(run)}`);
  assert.equal(run.phase, 'shadowing', '新用户默认影子全做');

  // 合法讲解（含岔路口）
  const ok1 = recordDecisionExplanation(db, {
    runId: run.runId, taskId: 'demo_agent_task_primary',
    explanation: {
      decision: 'design 公式放 ~ batch + condition',
      why: '批次变量在前可在 condition 检验里被边际化掉',
      domainConvention: 'DESeq2 惯例：关心的变量放最后',
      forkOptions: ['~ condition（忽略批次）', '~ batch + condition'],
    },
  });
  assert.ok(ok1.ok, `讲解应入库：${JSON.stringify(ok1)}`);

  const ok2 = recordDecisionExplanation(db, {
    runId: run.runId, taskId: 'demo_agent_task_primary',
    explanation: { decision: 'padj 阈值取 0.1', why: '社区惯例默认', domainConvention: 'BH 校正后 0.1' },
  });
  assert.ok(ok2.ok);

  // 轨迹可回放：task_events 两条 coaching.decision_explanation，payload 结构化
  const events = db.prepare("SELECT * FROM task_events WHERE event_type = 'coaching.decision_explanation' ORDER BY seq").all();
  assert.equal(events.length, 2, `每决策点一条讲解事件（实际 ${events.length}）`);
  const payload = JSON.parse(events[0].payload);
  for (const field of ['decision', 'why', 'domainConvention', 'forkOptions', 'runId']) {
    const value = Object.entries(payload).find(([key]) => key === field)?.[1];
    assert.ok(value !== undefined, `讲解 payload 应含 ${field}`);
  }

  // 缺 why 的自由文本拒绝（钉①反向）
  const bad = recordDecisionExplanation(db, {
    runId: run.runId, taskId: 'demo_agent_task_primary',
    explanation: { decision: '选了 A' },
  });
  assert.equal(bad.ok, false, '缺 why 的讲解必须拒绝');

  // 计数同步
  const runRow = db.prepare('SELECT decision_count FROM do_coaching_runs WHERE run_id = ?').get(run.runId);
  assert.equal(runRow.decision_count, 2);
});

test('HK-87c-2（钉②）：交接比例滑移——随成功记录自动调整（方向与 88 相反、引擎同源形状）', () => {
  // 数据不足不动
  assert.equal(computeHandoverPhase({ accepted: 0, total: 1 }).phase, 'shadowing');
  assert.equal(computeHandoverPhase({ accepted: 1, total: 5 }).phase, 'shadowing');
  // 达标进交接
  const scaffold = computeHandoverPhase({ accepted: 2, total: 4 });
  assert.equal(scaffold.phase, 'scaffolding');
  assert.equal(scaffold.handoverRatio, 0.5);
  // 高成功率高频次进独立
  const independent = computeHandoverPhase({ accepted: 5, total: 5 });
  assert.equal(independent.phase, 'independent');
  assert.equal(independent.handoverRatio, 1);
  // 成功率不足退回影子
  assert.equal(computeHandoverPhase({ accepted: 2, total: 10 }).phase, 'shadowing');
  // 引擎落到 run 创建：accepted 记录变化 → 新 run 相位变化
  const db = freshDb();
  const run1 = createCoachingRun(db, { goalId: 'g', domain: 'bioinformatics', userId: 'u', accepted: 0, total: 0 });
  assert.equal(run1.phase, 'shadowing');
  const run2 = createCoachingRun(db, { goalId: 'g2', domain: 'bioinformatics', userId: 'u', accepted: 6, total: 6 });
  assert.equal(run2.phase, 'independent');
});

test('HK-87c-3（钉③）：复盘分歧点结构化——五字段齐才入库，自由文本拒绝', () => {
  const db = freshDb();
  const run = createCoachingRun(db, { goalId: 'g', domain: 'bioinformatics', userId: 'local-user' });

  const freeText = recordReview(db, { runId: run.runId, divergences: ['就是没按惯例走'] });
  assert.equal(freeText.ok, false, '自由文本分歧必须拒绝');

  const missingField = recordReview(db, {
    runId: run.runId,
    divergences: [{ decision: 'design', userChoice: '~ condition', domainConvention: '~ batch + condition', costOfDeviation: '批次效应混入' }],
  });
  assert.equal(missingField.ok, false, '缺 sourceRef 必须拒绝');

  const ok = recordReview(db, {
    runId: run.runId,
    divergences: [{
      decision: 'design 公式',
      userChoice: '~ condition',
      domainConvention: '~ batch + condition',
      costOfDeviation: '批次效应混入 condition 检验，padj 失真',
      sourceRef: 'bioconductor-deseq2',
    }],
  });
  assert.ok(ok.ok, `结构化分歧应入库：${JSON.stringify(ok)}`);
  const history = listDivergences(db, { userId: 'local-user', domain: 'bioinformatics' });
  assert.equal(history.length, 1);
  assert.equal(history[0].divergences[0].sourceRef, 'bioconductor-deseq2');
});

test('HK-87c-4（钉④）：反馈对照——产物观察 vs 品味样本逐维度结构化输出', () => {
  const db = freshDb();
  const sampleInput = {
    sampleId: 'hk_sample_stat',
    domain: 'bioinformatics',
    dimension: '统计口径',
    good: JSON.stringify({ 期待: 'padj（BH 校正）阈值显式写出，up/down 分计数' }),
    bad: JSON.stringify({ 反例: 'p<0.05 未校正当显著清单' }),
    rationale: 'Genome-wide 检验不做多重校正时大部分为假阳性',
    sourceRef: 'bioconductor-deseq2',
  };
  const seeded = insertTasteSample(db, sampleInput);
  assert.ok(seeded.ok);
  // 重复幂等
  const seededAgain = insertTasteSample(db, sampleInput);
  assert.equal(seededAgain.existed, true, '同 id 重复入库幂等');

  const result = compareAgainstSamples(db, {
    domain: 'bioinformatics',
    artifactObservations: [
      { dimension: '统计口径', observation: '报告写「p<0.05 共 500 基因显著」，无校正无分计数', matches: false },
    ],
  });
  assert.ok(result.ok, `对照应成功：${JSON.stringify(result)}`);
  assert.equal(result.comparisons.length, 1);
  const comparison = result.comparisons[0];
  assert.equal(comparison.status, 'compared');
  assert.equal(comparison.dimension, '统计口径');
  assert.ok(comparison.sample.good, '样本好判例在场（对照事实呈现）');
  assert.ok(comparison.sample.rationale, '理由在场（预评呈现对照事实，终审归人）');
  assert.equal(comparison.matches, false, '对照判定结构化在场');

  // 未覆盖维度 → no_sample 诚实标注（不硬凑）
  const partial = compareAgainstSamples(db, {
    domain: 'bioinformatics',
    artifactObservations: [{ dimension: '图表规范', observation: 'PCA 未注明变换方式' }],
  });
  assert.equal(partial.comparisons[0].status, 'no_sample', '无样本维度诚实标注 no_sample');
});

test('HK-87c-5：试点边界——非 bio 域创建/记录一律拒绝', () => {
  const db = freshDb();
  const refused = createCoachingRun(db, { goalId: 'g', domain: 'web-dev', userId: 'u' });
  assert.equal(refused.ok, false, '非试点域必须拒绝');
  assert.match(refused.error, /白名单/);
});

// ── 真 HTTP 集成（express + 迁移库 + 真路由注册）─────────────────────
const express = require_('express');

function makeApp() {
  // 注意：不挂全局 express.json——do-coaching 路由自带 route-level bodyJson，
  // 双解析器会让第二级拿到「stream is not readable」（首验实测）。
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'local-user', role: 'admin' }; next(); });
  const { registerDoCoachingRoutes } = requireFrom('core/petri-server/routes/do-coaching.js');
  registerDoCoachingRoutes(app);
  return app;
}

function callHttp(app, method, url, body) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      }).then(async (res) => {
        const json = await res.json().catch(() => ({}));
        server.close();
        resolve({ status: res.status, json });
      }).catch((error) => { server.close(); resolve({ status: -1, json: { error: String(error) } }); });
    });
  });
}

test('HK-87c-6（真 HTTP 集成）：runs→decisions→reviews→samples/seed→summary 全链', async () => {
  // 迁移库补 wb_goals（summary JOIN 需要）与 tasks/task_events（轨迹）
  const dbw = new Database(dbPath);
  dbw.exec(`CREATE TABLE IF NOT EXISTS wb_goals (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, description TEXT NOT NULL,
    budget_cny REAL, status TEXT NOT NULL DEFAULT 'draft', acceptance_json TEXT, created_at TEXT NOT NULL
  )`);
  dbw.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, params TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'running', created_at TEXT NOT NULL, finished_at TEXT, error TEXT,
    user_id TEXT, agent_status TEXT, retry_count INTEGER DEFAULT 0, next_retry_at TEXT, max_retries INTEGER DEFAULT 0
  )`);
  dbw.exec(`CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, seq INTEGER NOT NULL,
    event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  dbw.prepare("INSERT INTO wb_goals (id, project_id, description, status, created_at) VALUES ('hk_goal_c', 'hk_proj_c', 'HK 教练目标', 'active', ?)")
    .run(new Date().toISOString());
  dbw.prepare("INSERT INTO tasks (id, type, params, status, created_at, user_id, agent_status) VALUES ('hk_task_c', 'agent_loop', ?, 'running', ?, 'local-user', 'running')")
    .run(JSON.stringify({ conversationId: 'hk_conv_c' }), new Date().toISOString());
  dbw.close();

  const app = makeApp();
  const created = await callHttp(app, 'POST', '/api/do/coaching/runs', {
    goalId: 'hk_goal_c', taskId: 'hk_task_c', domain: 'bioinformatics', userId: 'local-user',
  });
  assert.equal(created.status, 200, `创建 run 应 200：${JSON.stringify(created)}`);
  const runId = created.json.runId;
  assert.equal(created.json.phase, 'shadowing');

  const decision = await callHttp(app, 'POST', '/api/do/coaching/decisions', {
    runId, taskId: 'hk_task_c',
    explanation: { decision: '预过滤 rowSums>=10', why: '省内存与多重检验负担', domainConvention: 'DESeq2 vignette 惯例' },
  });
  assert.equal(decision.status, 200, `决策讲解应 200：${JSON.stringify(decision)}`);

  const review = await callHttp(app, 'POST', '/api/do/coaching/reviews', {
    runId,
    divergences: [{
      decision: 'contrast 方向', userChoice: 'Treatment vs Control（默认字母序）',
      domainConvention: '显式声明 ref/treatment', costOfDeviation: '上调/下调全反', sourceRef: 'bioconductor-deseq2',
    }],
  });
  assert.equal(review.status, 200, `复盘应 200：${JSON.stringify(review)}`);

  const seedRes = await callHttp(app, 'POST', '/api/do/coaching/samples/seed', {});
  assert.equal(seedRes.status, 200, `品味样本播种应 200：${JSON.stringify(seedRes)}`);
  assert.equal(seedRes.json.total, 5, 'bio 草稿 5 组样本全入库');

  const summary = await callHttp(app, 'GET', '/api/do/coaching/summary?projectId=hk_proj_c');
  assert.equal(summary.status, 200);
  assert.equal(summary.json.runs.length, 1);
  assert.equal(summary.json.runs[0].decision_count, 1);
  assert.equal(summary.json.divergences.length, 1);

  // 轨迹可回放：task_events 里有 run_started + decision_explanation
  const dbRead = new Database(dbPath, { readonly: true });
  const events = dbRead.prepare("SELECT event_type FROM task_events WHERE task_id = 'hk_task_c' ORDER BY seq").all().map((r) => r.event_type);
  assert.ok(events.includes('coaching.run_started'), 'run_started 事件在场');
  assert.ok(events.includes('coaching.decision_explanation'), '决策讲解事件在场');
  dbRead.close();

  // 非 bio 域 HTTP 拒绝
  const refused = await callHttp(app, 'POST', '/api/do/coaching/runs', { goalId: 'x', domain: 'web-dev', userId: 'u' });
  assert.equal(refused.status, 400, '非试点域 HTTP 必须 400');
});
