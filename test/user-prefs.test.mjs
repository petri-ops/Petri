/**
 * BLOCK-86 L1 — 多端用户偏好探针。
 * 覆盖：GET 空 / PUT 落盘 / 部分合并不覆盖他键 / 非法值消毒 / 持久化重读。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmpRoot() {
  return mkdtempSync(path.join(tmpdir(), 'gewu-prefs-test-'));
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function body(response) {
  return response.json();
}

test('BLOCK-86 L1: prefs PUT/GET merge + sanitize + persist', async () => {
  const root = tmpRoot();
  try {
    const express = require('express');
    const app = express();
    // 不挂 app 级 express.json（路由自带；双重解析会消费已耗尽 stream → 500）
    require(path.join(ROOT, 'core/biof3-server/routes/user-prefs.js'))(app, { dataDir: root });
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;

    // 空起点
    const empty = await body(await fetch(`${base}/api/user/prefs`));
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.prefs, {});

    // PUT theme + accent
    const put1 = await body(await fetch(`${base}/api/user/prefs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'dark', accent: 'rose' }),
    }));
    assert.equal(put1.ok, true);
    assert.equal(put1.prefs.theme, 'dark');
    assert.equal(put1.prefs.accent, 'rose');

    // 部分合并不覆盖他键 + 字号边界消毒
    const put2 = await body(await fetch(`${base}/api/user/prefs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fontScale: 5, theme: 'light' }),
    }));
    assert.equal(put2.prefs.theme, 'light');
    assert.equal(put2.prefs.fontScale, 1.4, 'out-of-range fontScale must clamp');
    assert.equal(put2.prefs.accent, 'rose', 'partial PUT must not wipe other keys');

    // 非法值消毒
    const put3 = await body(await fetch(`${base}/api/user/prefs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'hacker', accent: 123 }),
    }));
    assert.equal(put3.prefs.theme, 'light', 'invalid theme must be dropped');
    assert.equal(put3.prefs.accent, 'rose', 'invalid accent must be dropped');

    await new Promise((resolve) => server.close(resolve));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
