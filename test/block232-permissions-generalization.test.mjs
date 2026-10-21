/**
 * BLOCK-232 — Q-DOMAIN P4-B：权限通用化（data 资源权限 + legacy 别名）。
 *
 * 钉住四件事：
 *   1. `data` 是通用数据面权限键，`single-cell`/`spatial` 为 legacy 别名（组内显式任一 true 即授予）。
 *   2. legacy 键的逐键语义不变（显式优先 → 默认），存量 JSON 零迁移。
 *   3. `/api/data/*` 写 gate 与 `/api/run` 计算 gate 已收敛；guest 共用同一解析器。
 *   4. 本地 admin（LOCAL_USER.role=admin）行为零变化。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dbStub = { users: {}, siteSetting: null };
const dbPath = require.resolve(path.join(ROOT, 'core/petri-server/db.js'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    getUserById: (id) => dbStub.users[id] || null,
    getSiteSetting: (_key) => (dbStub.siteSetting == null ? null : { value: dbStub.siteSetting }),
  },
};

const permissions = require(path.join(ROOT, 'core/petri-server/helpers/permissions.js'));
const guestPath = require.resolve(path.join(ROOT, 'core/petri-server/helpers/guest-permissions.js'));

function row(perms, role = 'user') {
  return { id: 'u1', role, permissions: perms == null ? null : JSON.stringify(perms) };
}

function freshGuest() {
  delete require.cache[guestPath];
  return require(guestPath);
}

function gate(req) {
  let settled = null;
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      settled = { kind: 'json', status: this.statusCode, body };
      return this;
    },
  };
  permissions.moduleGate(req, res, () => {
    settled = { kind: 'next' };
  });
  assert.ok(settled, 'moduleGate 必须同步落定（next 或 json）');
  return settled;
}

test('权限键：data 进入 MODULE_KEYS / DEFAULT_PERMS，默认关闭', () => {
  assert.ok(permissions.MODULE_KEYS.includes('data'));
  assert.ok(permissions.MODULE_KEYS.includes('single-cell'), 'legacy 键保留');
  assert.ok(permissions.MODULE_KEYS.includes('spatial'), 'legacy 键保留');
  assert.equal(permissions.DEFAULT_PERMS.data, false);
});

test('can(data)：legacy 显式任一 true 即授予，组内 OR 与旧 gate 等价', () => {
  assert.equal(permissions.can(row({ 'single-cell': true }), 'data'), true);
  assert.equal(permissions.can(row({ spatial: true }), 'data'), true);
  assert.equal(permissions.can(row({ 'single-cell': false, spatial: true }), 'data'), true);
  assert.equal(permissions.can(row({ 'single-cell': false, spatial: false }), 'data'), false);
  assert.equal(permissions.can(row({}), 'data'), false);
  assert.equal(permissions.can(row(null), 'data'), false);
  assert.equal(permissions.can(row({ data: true }), 'data'), true);
  assert.equal(permissions.can(row({ data: false }), 'data'), false);
  assert.equal(permissions.can(row({ data: false, 'single-cell': true }), 'data'), true, '组内 legacy true 仍授予');
  assert.equal(permissions.can({ role: 'user', permissions: '{bad json' }, 'data'), false);
});

test('can(legacy)：逐键语义不变（不被 data 组改写）', () => {
  assert.equal(permissions.can(row({ 'single-cell': true }), 'single-cell'), true);
  assert.equal(permissions.can(row({ 'single-cell': true }), 'spatial'), false);
  assert.equal(permissions.can(row({ spatial: true }), 'single-cell'), false);
  assert.equal(permissions.can(row({ spatial: false }), 'spatial'), false);
});

test('本地 admin：无论存储值如何都放行 data', () => {
  const admin = { id: 'local-user', role: 'admin', permissions: JSON.stringify({ data: false, 'single-cell': false }) };
  assert.equal(permissions.can(admin, 'data'), true);
  assert.equal(permissions.can(admin, 'single-cell'), true);
  const gateResult = gate({ path: '/api/data/projects', method: 'POST', user: admin });
  assert.deepEqual(gateResult, { kind: 'next' });
});

test('effectivePermissions：输出 data，且保留 legacy 键原语义', () => {
  const effective = permissions.effectivePermissions(row({ 'single-cell': true }));
  assert.equal(effective.data, true);
  assert.equal(effective['single-cell'], true);
  assert.equal(effective.spatial, false);
  assert.equal(effective.copilot, true);
  const admin = permissions.effectivePermissions({ role: 'admin', permissions: null });
  assert.equal(admin.data, true);
  assert.equal(admin['single-cell'], true);
});

test('normalizePermissionsForStore：接受 data、保留 legacy、未知键丢弃、reset 为 null', () => {
  const stored = permissions.normalizePermissionsForStore({
    data: 1,
    'single-cell': 0,
    spatial: 'yes',
    unknown: true,
    tools_only: ['a', 2, 'b'],
  });
  assert.deepEqual(JSON.parse(stored), { data: true, 'single-cell': false, spatial: true, tools_only: ['a', 'b'] });
  assert.equal(permissions.normalizePermissionsForStore({}), null);
  assert.equal(permissions.normalizePermissionsForStore(null), null);
  assert.equal(permissions.normalizePermissionsForStore('{bad'), null);
});

test('moduleGate：/api/data 写面用 data 判定（legacy 兼容、失败 module=data）', () => {
  dbStub.users.u1 = row({ 'single-cell': true });
  assert.deepEqual(gate({ path: '/api/data/projects', method: 'POST', user: { id: 'u1' } }), { kind: 'next' });

  dbStub.users.u1 = row({ data: true });
  assert.deepEqual(gate({ path: '/api/data/projects/1', method: 'DELETE', user: { id: 'u1' } }), { kind: 'next' });

  dbStub.users.u1 = row({});
  const denied = gate({ path: '/api/data/projects', method: 'POST', user: { id: 'u1' } });
  assert.equal(denied.kind, 'json');
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, 'module_forbidden');
  assert.equal(denied.body.module, 'data');
  assert.doesNotMatch(denied.body.message, /单细胞|空间组学/);
});

test('moduleGate：/api/data 读面与既有路由映射不变', () => {
  dbStub.users.u1 = row({});
  assert.deepEqual(gate({ path: '/api/data/projects', method: 'GET', user: { id: 'u1' } }), { kind: 'next' });
  assert.equal(permissions.routeRequiresModuleGate({ path: '/api/data/projects', method: 'POST' }), true);
  assert.equal(permissions.routeRequiresModuleGate({ path: '/api/data/projects', method: 'GET' }), false);
  assert.equal(permissions.routeRequiresModuleGate({ path: '/api/run', method: 'POST' }), true);
  assert.equal(permissions.routeRequiresModuleGate({ path: '/api/tools/run', method: 'POST' }), true);
});

test('moduleGate：/api/run = tools 或 data', () => {
  dbStub.users.u1 = row({ data: true });
  assert.deepEqual(gate({ path: '/api/run', method: 'POST', user: { id: 'u1' } }), { kind: 'next' });
  dbStub.users.u1 = row({ tools: true });
  assert.deepEqual(gate({ path: '/api/run', method: 'POST', user: { id: 'u1' } }), { kind: 'next' });
  dbStub.users.u1 = row({});
  const denied = gate({ path: '/api/run', method: 'POST', user: { id: 'u1' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.module, 'tools');
});

test('guest：存量 single-cell 授权自动获得 data（同步/异步同源），默认仍拒绝', async () => {
  dbStub.siteSetting = JSON.stringify({ 'single-cell': true });
  let gp = freshGuest();
  assert.equal(gp.effectiveGuestPermissions().data, true);
  assert.equal((await gp.effectiveGuestPermissionsAsync()).data, true);
  assert.equal(gp.canGuest('data'), true);
  assert.deepEqual(gate({ path: '/api/data/projects', method: 'POST', user: null }), { kind: 'next' });

  dbStub.siteSetting = null;
  gp = freshGuest();
  assert.equal(gp.effectiveGuestPermissions().data, false);
  assert.equal((await gp.effectiveGuestPermissionsAsync()).data, false);
  const denied = gate({ path: '/api/data/projects', method: 'POST', user: null });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.module, 'data');
});

test('本地身份契约：LOCAL_USER 仍是 admin（桌面零拦截的根）', () => {
  const { LOCAL_USER } = require(path.join(ROOT, 'core/petri-server/auth.js'));
  assert.equal(LOCAL_USER.role, 'admin');
  assert.equal(permissions.can(LOCAL_USER, 'data'), true);
});
