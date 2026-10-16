import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractRestorableRoute, buildRestoreUrl } = require('../src/main/_main-window-state.js');

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
