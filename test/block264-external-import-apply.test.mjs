import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// BLOCK-264（C-35）— 外部配置导入应用面契约：
// apply（服务端重推导/selectedKeys 过滤/凭据拒绝/schema 校验/前值快照/审计）
// + rollback（按 applyId 还原前值/重复回滚 409/未知 404）

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b264-import-'));
process.env.PETRI_LOCAL_DATA_DIR = tempDir;

const express = require('express');
const { registerExternalImportRoutes } = require('../core/petri-server/routes/external-import.js');
const runtimePolicy = require('../core/petri-server/helpers/runtime-policy.js');

test.after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

async function makeServer() {
  const app = express();
  // 路由自带 express.json（per-route limit）；不再挂全局解析避免双重读流
  registerExternalImportRoutes(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, body) =>
    fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(async (res) => ({ status: res.status, body: await res.json() }));
  return { server, call };
}

const CODEX_STRICT = 'model = "gpt-5"\napproval_policy = "untrusted"\nsandbox_mode = "read-only"\n';
const CODEX_LOOSE = 'approval_policy = "never"\n';

test('BLOCK-264 apply — happy path：重推导→校验→写→前值快照→审计', async () => {
  const { server, call } = await makeServer();
  try {
    runtimePolicy.writeStore({}); // 干净起点
    const res = await call('/api/import/external-agent/apply', { source: 'codex', content: CODEX_STRICT });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.deepEqual(res.body.appliedKeys, ['runtime::approvalDefaultMode']);
    assert.match(res.body.applyId, /^imp-/);
    assert.equal(res.body.rollbackAvailable, true);
    assert.equal(runtimePolicy.readStore().approvalDefaultMode, 'read');

    const audit = JSON.parse(fs.readFileSync(path.join(tempDir, 'import-audit.jsonl'), 'utf8').trimEnd().split('\n')[0]);
    assert.equal(audit.kind, 'apply');
    assert.equal(audit.applyId, res.body.applyId);
    assert.deepEqual(audit.previous, [{ key: 'runtime::approvalDefaultMode', value: null }]);
  } finally { server.close(); }
});

test('BLOCK-264 apply — selectedKeys 过滤 + 未知键 400', async () => {
  const { server, call } = await makeServer();
  try {
    runtimePolicy.writeStore({});
    const skipped = await call('/api/import/external-agent/apply', { source: 'codex', content: CODEX_STRICT, selectedKeys: [] });
    assert.equal(skipped.status, 200);
    assert.deepEqual(skipped.body.appliedKeys, []);
    assert.equal(skipped.body.applyId, null);
    assert.equal(runtimePolicy.readStore().approvalDefaultMode, undefined);

    const unknown = await call('/api/import/external-agent/apply', { source: 'codex', content: CODEX_STRICT, selectedKeys: ['runtime::nope'] });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, 'unknown_key');
    assert.deepEqual(unknown.body.unknownKeys, ['runtime::nope']);
  } finally { server.close(); }
});

test('BLOCK-264 apply — 覆盖已有值时前值进快照（第二次 apply 换档）', async () => {
  const { server, call } = await makeServer();
  try {
    runtimePolicy.writeStore({ approvalDefaultMode: 'full' });
    const res = await call('/api/import/external-agent/apply', { source: 'codex', content: CODEX_STRICT });
    assert.equal(res.status, 200);
    assert.equal(runtimePolicy.readStore().approvalDefaultMode, 'read');
    const lines = fs.readFileSync(path.join(tempDir, 'import-audit.jsonl'), 'utf8').trimEnd().split('\n');
    const mine = lines.map((l) => JSON.parse(l)).find((e) => e.applyId === res.body.applyId);
    assert.deepEqual(mine.previous, [{ key: 'runtime::approvalDefaultMode', value: 'full' }]);
  } finally { server.close(); }
});

test('BLOCK-264 apply — 不可解析内容 400（不写盘）', async () => {
  const { server, call } = await makeServer();
  try {
    runtimePolicy.writeStore({});
    const bad = await call('/api/import/external-agent/apply', { source: 'codex', content: '!!! not toml [[[' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'unparsable_config');
    assert.deepEqual(Object.keys(runtimePolicy.readStore()), []);
  } finally { server.close(); }
});

test('BLOCK-264 rollback — 还原前值并审计；重复回滚 409；未知 404', async () => {
  const { server, call } = await makeServer();
  try {
    runtimePolicy.writeStore({ approvalDefaultMode: 'full' });
    const apply = await call('/api/import/external-agent/apply', { source: 'codex', content: CODEX_STRICT });
    const applyId = apply.body.applyId;
    assert.equal(runtimePolicy.readStore().approvalDefaultMode, 'read');

    const rb = await call('/api/import/external-agent/rollback', { applyId });
    assert.equal(rb.status, 200);
    assert.deepEqual(rb.body.restoredKeys, ['runtime::approvalDefaultMode']);
    assert.equal(runtimePolicy.readStore().approvalDefaultMode, 'full');

    const again = await call('/api/import/external-agent/rollback', { applyId });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already_rolled_back');

    const missing = await call('/api/import/external-agent/rollback', { applyId: 'imp-nonexistent' });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'apply_not_found');
  } finally { server.close(); }
});

test('BLOCK-264 apply — 前值为 null 的回滚＝删除覆盖层键（回落默认）', async () => {
  const { server, call } = await makeServer();
  try {
    runtimePolicy.writeStore({});
    const apply = await call('/api/import/external-agent/apply', { source: 'codex', content: CODEX_LOOSE });
    assert.equal(runtimePolicy.readStore().approvalDefaultMode, 'full');
    const rb = await call('/api/import/external-agent/rollback', { applyId: apply.body.applyId });
    assert.equal(rb.status, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(runtimePolicy.readStore(), 'approvalDefaultMode'), false, 'null 前值回滚应删除键');
  } finally { server.close(); }
});

test('BLOCK-264 preview — 行为不变（dryRun 只读）', async () => {
  const { server, call } = await makeServer();
  try {
    runtimePolicy.writeStore({});
    const res = await call('/api/import/external-agent/preview', { source: 'codex', content: CODEX_STRICT });
    assert.equal(res.status, 200);
    assert.equal(res.body.dryRun, true);
    assert.equal(res.body.wrote, false);
    assert.deepEqual(Object.keys(runtimePolicy.readStore()), []);
  } finally { server.close(); }
});
