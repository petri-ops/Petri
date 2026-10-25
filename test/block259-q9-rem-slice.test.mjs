/**
 * BLOCK-259 Q9-REM 最小切片 — D1 模型价格面契约。
 *
 * 价格必须来自 ai-usage 的单一 source（AI_PRICING），不走前端硬编码/第二真相。
 */

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b259-q9-slice-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir;
process.env.PETRI_DB_PATH = path.join(tmpDir, 'petri.db');

// ai-usage/db.js 在 require 时预编译 DAO，必须先建全 schema（同实机启动顺序）。
const Database = require('better-sqlite3');
const bootDb = new Database(process.env.PETRI_DB_PATH);
const migrationsDir = path.join(ROOT, 'src', 'migrations');
for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
  bootDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
}
bootDb.close();

const { registerAiSettingsRoutes } = require(path.join(ROOT, 'core/petri-server/routes/ai-settings-api.js'));
const aiUsage = require(path.join(ROOT, 'core/petri-server/helpers/ai-usage.js'));

let server = null;
let base = '';

before(async () => {
  const app = express();
  registerAiSettingsRoutes(app);
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  // Windows better-sqlite3 句柄进程退出前未释放 → EPERM/EBUSY；测试债容忍（同仓先例）。
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch { /* EPERM/EBUSY */ }
});

test('BLOCK-259 D1 — /api/ai/pricing 与 AI_PRICING 同源，逐模型 input/output 可见', async () => {
  const response = await fetch(`${base}/api/ai/pricing`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.deepEqual(body.pricing, aiUsage.AI_PRICING, '价格必须与 ai-usage 单一源逐字一致');
  assert.equal(body.pricing['deepseek-chat'].input, 0.5);
  assert.equal(body.pricing['deepseek-chat'].output, 8);
  assert.equal(body.pricing['deepseek-chat'].cacheHit, 0.1);
  assert.ok(!JSON.stringify(body).toLowerCase().includes('apikey'), '价格面不得出现凭据字段');
});
