import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { extractRestorableRoute, buildRestoreUrl, loadLastRoute, saveLastRoute, computeStartupLoadUrl } = require('../src/main/_main-window-state.js');

// BLOCK-185 冷启动深链恢复的安全门：只恢复同源本地 SPA 路由，拒外部/协议相对/scheme。
test('extractRestorableRoute: 同源深链抽出相对路由', () => {
  assert.equal(
    extractRestorableRoute('http://localhost:3000/project/p1?mode=result&job=j2', 'http://localhost:3000/'),
    '/project/p1?mode=result&job=j2',
  );
  assert.equal(
    extractRestorableRoute('http://localhost:3000/settings?section=ai#frag', 'http://localhost:3000/'),
    '/settings?section=ai#frag',
  );
});

test('extractRestorableRoute: 根路由/跨源/异常返回 null', () => {
  assert.equal(extractRestorableRoute('http://localhost:3000/', 'http://localhost:3000/'), null);
  assert.equal(extractRestorableRoute('http://evil.com/x', 'http://localhost:3000/'), null);
  assert.equal(extractRestorableRoute('http://localhost:3001/x', 'http://localhost:3000/'), null); // 端口不同源
  assert.equal(extractRestorableRoute('not a url', 'http://localhost:3000/'), null);
  assert.equal(extractRestorableRoute(null, 'http://localhost:3000/'), null);
});

test('buildRestoreUrl: 合法相对路由拼当前 origin', () => {
  assert.equal(
    buildRestoreUrl('http://localhost:3000/', '/project/p1?job=j2'),
    'http://localhost:3000/project/p1?job=j2',
  );
  // 端口漂移免疫：存的是 path，恢复拼当前 base
  assert.equal(
    buildRestoreUrl('http://localhost:3999/', '/project/p1'),
    'http://localhost:3999/project/p1',
  );
});

test('buildRestoreUrl: 拒绝开放重定向与绝对 URL（安全红线）', () => {
  assert.equal(buildRestoreUrl('http://localhost:3000/', '//evil.com/x'), null); // 协议相对
  assert.equal(buildRestoreUrl('http://localhost:3000/', 'http://evil.com/x'), null); // 含 scheme
  assert.equal(buildRestoreUrl('http://localhost:3000/', 'javascript:alert(1)'), null);
  assert.equal(buildRestoreUrl('http://localhost:3000/', 'project/p1'), null); // 不以 / 开头
  assert.equal(buildRestoreUrl('http://localhost:3000/', ''), null);
  assert.equal(buildRestoreUrl('http://localhost:3000/', null), null);
});

test('saveLastRoute/loadLastRoute: 临时目录往返 + 缺文件返 null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b185-route-'));
  try {
    const p = join(dir, 'main-window-route.json');
    assert.equal(loadLastRoute(p), null); // 未写前缺文件 → null（回落根）
    assert.equal(saveLastRoute(p, '/project/p1?job=j2'), true);
    assert.equal(loadLastRoute(p), '/project/p1?job=j2');
    // 覆盖写：恢复以最后一次为准
    saveLastRoute(p, '/settings?section=ai');
    assert.equal(loadLastRoute(p), '/settings?section=ai');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeStartupLoadUrl: 三分支决策（恢复/测试实例禁用/无路由回落）', () => {
  // 非测试实例 + 有效存路由 → 恢复深链
  assert.equal(
    computeStartupLoadUrl({ baseUrl: 'http://localhost:3000/', isTestInstance: false, savedRoute: '/project/p1?job=j2' }),
    'http://localhost:3000/project/p1?job=j2',
  );
  // 非测试实例 + 无存路由 → 回落根
  assert.equal(
    computeStartupLoadUrl({ baseUrl: 'http://localhost:3000/', isTestInstance: false, savedRoute: null }),
    'http://localhost:3000/',
  );
  // 非测试实例 + 非法存路由（外部）→ 回落根（安全门）
  assert.equal(
    computeStartupLoadUrl({ baseUrl: 'http://localhost:3000/', isTestInstance: false, savedRoute: '//evil.com/x' }),
    'http://localhost:3000/',
  );
  // 测试实例 → 永不恢复，追加 ?test=1（护 CDP 探针落已知 base，永久红线）
  assert.equal(
    computeStartupLoadUrl({ baseUrl: 'http://localhost:3000/', isTestInstance: true, savedRoute: '/project/p1?job=j2' }),
    'http://localhost:3000/?test=1',
  );
});
