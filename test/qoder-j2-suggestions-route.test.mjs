/**
 * QODER-J2 P2 路由端到端契约（2026-11-23）。
 *
 * 真实起 Express + skill-suggestions 路由，seed lessons 表，验证：
 * 建议可读（GET 草案列表）/ 忽略写独立账本（POST）/ 忽略后 GET 过滤 / 不自动建任务。
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'j2-suggestions-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir;
process.env.PETRI_DB_PATH = path.join(tmpDir, 'petri.db');

const Database = require(path.join(ROOT, 'core/petri-server/node_modules/better-sqlite3'));
const bootDb = new Database(process.env.PETRI_DB_PATH);
for (const file of fs.readdirSync(path.join(ROOT, 'src/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
  bootDb.exec(fs.readFileSync(path.join(ROOT, 'src/migrations', file), 'utf8'));
}
// seed 一条可归因到 script-host 的 lesson
bootDb.exec(`INSERT INTO lessons (source_fingerprint, title, action, scope, confidence, status, occurrences_before, occurrences_after, created_at, last_seen_at)
  VALUES ('j2_fp1', '工具描述含糊', '按编码规范补充 coding review 的工具 description 示例', 'draft', 0.8, 'active', 3, 0, datetime('now'), datetime('now'))`);
bootDb.close();

const register = require(path.join(ROOT, 'core/petri-server/routes/skill-suggestions.js'));
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
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GET 建议可读：draft tier、不自动建任务、prompt 草案可读', async () => {
  const res = await fetch(`${base}/api/harness/skill-suggestions`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.tier, 'draft');
  assert.equal(data.autoApply, false);
  const match = data.suggestions.find((s) => s.sourceFingerprint === 'j2_fp1');
  assert.ok(match, 'seeded lesson 须产出建议');
  assert.equal(match.skillId, 'coding-playbook');
  assert.ok(match.prompt.includes('编码规范'), 'prompt 草案须含 action');
});

test('忽略写独立账本 + 忽略后 GET 过滤 + unignore 恢复', async () => {
  const ignored = await fetch(`${base}/api/harness/skill-suggestions/ignore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fingerprint: 'j2_fp1', reason: '测试忽略' }),
  });
  assert.equal((await ignored.json()).ok, true);
  const afterIgnore = await (await fetch(`${base}/api/harness/skill-suggestions`)).json();
  assert.equal(afterIgnore.suggestions.some((s) => s.sourceFingerprint === 'j2_fp1'), false, '忽略后不再出现');
  assert.ok(afterIgnore.ignoredCount >= 1);

  const restored = await fetch(`${base}/api/harness/skill-suggestions/ignore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fingerprint: 'j2_fp1', action: 'unignore' }),
  });
  assert.equal((await restored.json()).ok, true);
  const afterRestore = await (await fetch(`${base}/api/harness/skill-suggestions`)).json();
  assert.ok(afterRestore.suggestions.some((s) => s.sourceFingerprint === 'j2_fp1'), '取消忽略后恢复');
});
