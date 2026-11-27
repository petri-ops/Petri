/**
 * item 88 第三波 HK-01 — wb 五态投影接线。
 * ①wb overview 读面（真 HTTP 集成：express + 迁移库 + 真路由注册）
 * ②五态+依赖+任务书经 /api/wb/overview 精确投影（含 spec/验收/计量不丢）
 * ③无 wb 数据的项目诚实空投影
 * ④OrchestrationGraph 状态色含五态（§4.4，纯函数级断言）
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { bootstrapTestDb } = require_(path.join(ROOT, 'test', 'helpers', 'bootstrap-db.mjs'));
const dbPath = bootstrapTestDb('item88-wave3-wb-');

process.env.PETRI_DB_PATH = dbPath;
const Database = require_(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));

// 迁移库补 wb 两表（026 已含则 no-op）+ 演示数据
{
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS wb_goals (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, description TEXT NOT NULL,
    budget_cny REAL, status TEXT NOT NULL DEFAULT 'draft', acceptance_json TEXT, created_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS wb_tasks (
    id TEXT PRIMARY KEY, goal_id TEXT, spec_json TEXT, status TEXT NOT NULL DEFAULT 'draft',
    worker_task_id TEXT, priority INTEGER NOT NULL DEFAULT 0, dependencies_json TEXT, created_at TEXT NOT NULL
  )`);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO wb_goals (id, project_id, description, budget_cny, status, acceptance_json, created_at) VALUES (?,?,?,?,?,?,?)')
    .run('hk_goal_1', 'hk_proj', 'HK 演示目标', 9.9, 'active', JSON.stringify({ 验收标准: ['x'] }), now);
  const rows = [
    ['hk_t1', 'accepted', 10, '[]'],
    ['hk_t2', 'running', 20, '[]'],
    ['hk_t3', 'blocked', 30, JSON.stringify(['hk_t1'])],
    ['hk_t4', 'needs-user', 40, '[]'],
    ['hk_t5', 'queued', 50, '[]'],
  ];
  for (const [id, status, priority, deps] of rows) {
    db.prepare('INSERT INTO wb_tasks (id, goal_id, spec_json, status, priority, dependencies_json, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, 'hk_goal_1', JSON.stringify({ 产物类型: `${id} 产物`, 验收标准: ['a'], 计量: { tokenUsed: 1 } }), status, priority, deps, now);
  }
  db.close();
}

const { registerWbOverviewRoutes } = require_(path.join(ROOT, 'core', 'petri-server', 'routes', 'wb-overview.js'));

function call(app, url) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      fetch(`http://127.0.0.1:${port}${url}`)
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((error) => { server.close(); resolve({ status: -1, body: { error: String(error) } }); });
    });
  });
}

test('HK-88w-1：真 HTTP 集成——五态任务经 /api/wb/overview 精确投影', async () => {
  const app = express();
  registerWbOverviewRoutes(app);
  const res = await call(app, '/api/wb/overview?projectId=hk_proj');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.goals.length, 1);
  const goal = res.body.goals[0];
  assert.equal(goal.id, 'hk_goal_1');
  assert.equal(goal.tasks.length, 5);
  const statuses = goal.tasks.map((t) => t.status).sort();
  assert.deepEqual(statuses, ['accepted', 'blocked', 'needs-user', 'queued', 'running'], '五态齐');
  const blocked = goal.tasks.find((t) => t.status === 'blocked');
  assert.deepEqual(blocked.dependencies, ['hk_t1'], '依赖不丢');
  assert.ok(blocked.spec['产物类型'], '任务书不丢');
  const t1 = goal.tasks.find((t) => t.id === 'hk_t1');
  assert.ok(t1.spec.计量 && t1.spec.验收标准, '计量/验收不丢');
});

test('HK-88w-2：无 wb 数据的项目诚实空投影', async () => {
  const app = express();
  registerWbOverviewRoutes(app);
  const res = await call(app, '/api/wb/overview?projectId=no_such_proj');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.goals, []);
});

test('HK-88w-3：缺 projectId → 400（fail-closed）', async () => {
  const app = express();
  registerWbOverviewRoutes(app);
  const res = await call(app, '/api/wb/overview');
  assert.equal(res.status, 400);
});

test('HK-88w-4（钉）：OrchestrationGraph 状态色含五态（§4.4）', () => {
  const source = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'workspace-panels', 'OrchestrationGraph.tsx'), 'utf8');
  for (const status of ['accepted', 'running', 'blocked', 'needs-user', 'queued']) {
    assert.ok(new RegExp(`^\\s+'?${status}'?:`, 'm').test(source), `STATUS_COLOR 缺 ${status}`);
  }
});
