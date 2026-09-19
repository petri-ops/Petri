/**
 * BLOCK-88 P3 — 项目授权边界契约测试（D4/D5）。
 *
 * 覆盖：
 * 1. grants 存储：授权幂等 / isProjectGranted / 吊销 / 未授权诚实 false / 参数缺一拒绝
 * 2. 宿主管理 REST：GET 含项目名 / POST 授权 / DELETE 吊销（二次吊销 404）
 * 3. 网关访客面：GET /federation/api/granted-projects 按会话署名返回被授权项目
 *    （附项目名；无署名会话诚实空 + note）
 *
 * 委托入口的越界 403 与授权放行由实机脚本 block88-p3-project-grants.cjs 断言
 * （chat.js 全链需真实模型轮次，契约层不重复 boot）。
 *
 * 运行：node --test test/block88-project-grants.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-block88-p3-'));
process.env.BIOF3_DB_PATH = path.join(tempDir, 'block88-p3.db');
process.env.BIOF3_LOCAL_DATA_DIR = path.join(tempDir, 'data');

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');

const { runMigrations } = require(path.join(ROOT, 'src/migration-runner.js'));
await runMigrations(path.join(tempDir, 'block88-p3.db'), path.join(ROOT, 'src', 'migrations'));

const grants = require(path.join(ROOT, 'core/shared-backend/federation-grants.js'));
const { buildMobileGateway } = require(path.join(ROOT, 'core/biof3-server/mobile-gateway/index.js'));
const { getStores, resetStoresForTest } = require(path.join(ROOT, 'core/biof3-server/mobile-gateway/pairing.js'));

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}
async function body(response) {
  return response.json();
}

test('BLOCK-88 P3: grants store — idempotent grant, check, revoke, honest negatives', () => {
  const dir = path.join(tempDir, 'grants-store');
  assert.equal(grants.isProjectGranted(dir, '工程师 A', 'p_1'), false, 'default zero-grant');

  const g1 = grants.grantProject(dir, ' 工程师 A ', 'p_1');
  assert.equal(g1.ok, true);
  assert.equal(grants.isProjectGranted(dir, '工程师 A', 'p_1'), true);
  // 幂等：重复授权不堆叠
  grants.grantProject(dir, '工程师 A', 'p_1');
  assert.equal(grants.listGrants(dir).filter((g) => g.engineer === '工程师 A').length, 1);

  // 键净化：trim + 40 字封顶由 store 统一处理（此处验 trim 等价）
  assert.equal(grants.isProjectGranted(dir, ' 工程师 A ', 'p_1'), true);

  const rv = grants.revokeProject(dir, '工程师 A', 'p_1');
  assert.equal(rv.ok, true);
  assert.equal(grants.isProjectGranted(dir, '工程师 A', 'p_1'), false);
  assert.equal(grants.revokeProject(dir, '工程师 A', 'p_1').error, 'grant_not_found');
  assert.equal(grants.grantProject(dir, '', 'p_1').ok, false);
  assert.equal(grants.grantProject(dir, '工程师 A', '').ok, false);
});

test('BLOCK-88 P3: host admin REST — list with project names, grant, revoke (404 on double)', async () => {
  const db = require(path.join(ROOT, 'core/biof3-server/db.js')).getDatabase();
  db.prepare("INSERT INTO projects (id, name, status, created_at, updated_at) VALUES ('p_grant_me', '授权演示项目', 'active', ?, ?)")
    .run(new Date().toISOString(), new Date().toISOString());

  const express = require('express');
  const app = express();
  // 注意：不挂 app 级 express.json——admin 路由自带路由级 json（双重解析会
  // 消费已耗尽的 stream → 500，federation.test.mjs 同款先例警告）。
  require(path.join(ROOT, 'core/biof3-server/routes/federation-admin.js'))(app, { dataDir: path.join(tempDir, 'grants-admin') });
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const empty = await body(await fetch(`${base}/api/federation/grants`));
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.grants, []);

    const granted = await body(await fetch(`${base}/api/federation/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engineer: '工程师 A', projectId: 'p_grant_me' }),
    }));
    assert.equal(granted.ok, true);

    const listed = await body(await fetch(`${base}/api/federation/grants`));
    assert.equal(listed.grants.length, 1);
    assert.equal(listed.grants[0].engineer, '工程师 A');
    assert.equal(listed.grants[0].projectName, '授权演示项目', 'project name enriched');

    const missing = await body(await fetch(`${base}/api/federation/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engineer: '工程师 A' }),
    }));
    assert.equal(missing.ok, false, 'missing projectId rejected');

    const revoked = await body(await fetch(`${base}/api/federation/grants?engineer=${encodeURIComponent('工程师 A')}&projectId=p_grant_me`, { method: 'DELETE' }));
    assert.equal(revoked.ok, true);
    const again = await fetch(`${base}/api/federation/grants?engineer=${encodeURIComponent('工程师 A')}&projectId=p_grant_me`, { method: 'DELETE' });
    assert.equal(again.status, 404, 'double revoke must 404');
  } finally {
    await closeServer(server);
  }
});

test('BLOCK-88 P3: gateway granted-projects — scoped by session identity, honest empty without', async () => {
  const gwDir = path.join(tempDir, 'gateway-node');
  resetStoresForTest();
  const stores = getStores(gwDir);
  const engineerSession = stores.sessions.createSession({
    name: '联邦访客',
    identity: { displayName: '工程师 A', device: 'macOS' },
  });
  const plainSession = stores.sessions.createSession({ name: '手机设备-01' });
  grants.grantProject(gwDir, '工程师 A', 'p_grant_me');

  const { app: gatewayApp } = buildMobileGateway({ dataDir: gwDir });
  const server = await listen(gatewayApp);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const mine = await body(await fetch(`${base}/federation/api/granted-projects`, {
      headers: { Authorization: `Bearer ${engineerSession.sessionToken}` },
    }));
    assert.equal(mine.ok, true);
    assert.equal(mine.engineer, '工程师 A');
    assert.deepEqual(mine.projects, [{ projectId: 'p_grant_me', projectName: '授权演示项目' }]);

    const plain = await body(await fetch(`${base}/federation/api/granted-projects`, {
      headers: { Authorization: `Bearer ${plainSession.sessionToken}` },
    }));
    assert.equal(plain.ok, true);
    assert.deepEqual(plain.projects, []);
    assert.equal(plain.note, 'session_without_engineer_identity');
  } finally {
    await closeServer(server);
  }
});

test.after(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (e) {
    if (process.platform !== 'win32') throw e;
  }
});
