/**
 * QODER-L6 审计路由端到端（2026-11-23）：真实 Express + 临时 dataDir，
 * 验证 GET 空投影 / POST 追加 JSONL / GET 见事件 / 凭据字段脱敏 / 非法事件拒绝。
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l6-audit-e2e-'));
process.env.PETRI_LOCAL_DATA_DIR = tmp;

const register = require(path.join(ROOT, 'core/petri-server/routes/plugin-lifecycle-audit.js'));
let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  register(app);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('GET 空账本返回 ok:true 空事件（fail-soft）', async () => {
  const out = await (await fetch(`${base}/api/harness/plugin-audit`)).json();
  assert.equal(out.ok, true);
  assert.equal(out.total, 0);
});

test('POST 追加经脱敏；GET 可见；非法事件 400', async () => {
  const added = await fetch(`${base}/api/harness/plugin-audit/append`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor: 'user', kind: 'trust', from: 'ask', to: 'allow', token: 'SECRET_XYZ' }),
  });
  assert.equal((await added.json()).ok, true);
  const file = fs.readFileSync(path.join(tmp, 'plugin-lifecycle-audit.jsonl'), 'utf8');
  assert.ok(!file.includes('SECRET_XYZ'), '凭据字段须脱敏');
  const out = await (await fetch(`${base}/api/harness/plugin-audit`)).json();
  assert.equal(out.total, 1);
  assert.equal(out.events[0].kind, 'trust');

  const bad = await fetch(`${base}/api/harness/plugin-audit/append`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'bogus' }),
  });
  assert.equal(bad.status, 400);
});
