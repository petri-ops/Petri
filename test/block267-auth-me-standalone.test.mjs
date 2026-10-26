import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// BLOCK-267 — /api/auth/me standalone 500 清偿（AUDIT-LOG 🟡 存量）：
// server.js 传给 bootstrap 的 `db` 是 raw better-sqlite3 handle（无助手方法），
// auth.js 却调 `db.getUserByIdAsync` → undefined → 恒 500。
// 修复=auth.js 直接 require 助手模块（与 bootstrap 其它消费同源）。

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b267-auth-'));
process.env.PETRI_LOCAL_DATA_DIR = tempDir;
process.env.PETRI_DB_PATH = path.join(tempDir, 'b267.db');

{
  const Database = require('better-sqlite3');
  const boot = new Database(process.env.PETRI_DB_PATH);
  for (const file of fs.readdirSync('src/migrations').filter((n) => n.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join('src/migrations', file), 'utf8'));
  }
  boot.close();
}

test.after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('BLOCK-267 — /api/auth/me standalone 200（不再恒 500）', async () => {
  const express = require('express');
  const { setupBootstrap } = require('../core/petri-server/bootstrap.js');
  const { db } = require('../core/petri-server/db.js');
  const app = express();
  setupBootstrap(app, { db });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const resp = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/me`);
    const body = await resp.json();
    assert.equal(resp.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.user.id, 'local-user');
  } finally {
    server.close();
  }
});

test('BLOCK-267 — 源码面：auth.js 不再在入参 db 上调助手方法', () => {
  const src = fs.readFileSync('core/petri-server/auth.js', 'utf8');
  // 剥注释行后检查（注释里允许出现旧写法作历史说明）
  const code = src.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.ok(code.includes("require('./db')"), '应直接 require 助手模块');
  assert.ok(!/[^.]db\.getUserByIdAsync/.test(code), '不得回退到入参 db 调用');
});
