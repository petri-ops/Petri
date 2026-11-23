/**
 * QODER-L6 插件权限/生命周期/审计统一 — P1 纯函数 HK-01（2026-11-23）。
 *
 * 用户发令一次性推完；D 默认口径=沿用现有 JSONL 惯例（非评审稿写的 SQLite，零新依赖）。
 * 红线：不读写凭据、不改 handler、不把投影变成可迁移的信任真源。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = path.join(ROOT, 'core', 'shared-backend', 'plugin-lifecycle-audit.js');
const load = () => require(MODULE);

test('L6 模块存在且零新依赖', () => {
  assert.ok(fs.existsSync(MODULE), '须有 plugin-lifecycle-audit.js');
  assert.doesNotMatch(fs.readFileSync(MODULE, 'utf8'), /require\(['"](?!\.\.?\/|node:)/);
});

test('parseAuditLines：JSONL 逐行宽容，坏行不整份失败', () => {
  const { parseAuditLines } = load();
  const text = [
    JSON.stringify({ at: '2026-11-23T00:00:00Z', actor: 'user', kind: 'trust', from: 'ask', to: 'allow' }),
    'not-json',
    JSON.stringify({ at: '2026-11-23T00:01:00Z', actor: 'system', kind: 'install', from: null, to: 'p1' }),
  ].join('\n');
  const out = parseAuditLines(text);
  assert.equal(out.events.length, 2);
  assert.equal(out.skipped, 1);
  assert.equal(out.events[0].kind, 'trust');
});

test('formatAuditEvent：统一事件形状，脱敏（不含 token/凭据字段）', () => {
  const { formatAuditEvent } = load();
  const line = formatAuditEvent({ at: '2026-11-23T00:00:00Z', actor: 'user', kind: 'trust', from: 'ask', to: 'allow', token: 'secret' });
  const parsed = JSON.parse(line);
  assert.equal(parsed.kind, 'trust');
  assert.ok(!line.includes('secret'), '凭据字段不得进审计 JSONL');
  assert.equal(formatAuditEvent({ kind: 'bogus' }), null, '未知事件类型拒绝');
});

test('projectUnifiedAudit：多源合并按时间排序，只读投影不改写源', () => {
  const { projectUnifiedAudit } = load();
  const out = projectUnifiedAudit([
    { events: [{ at: '2026-11-23T00:02:00Z', actor: 'u', kind: 'install', from: null, to: 'p2' }] },
    { lines: JSON.stringify({ at: '2026-11-23T00:01:00Z', actor: 'u', kind: 'trust', from: 'ask', to: 'allow' }) },
  ]);
  assert.equal(out.events.length, 2);
  assert.ok(out.events[0].at < out.events[1].at, '按时间排序');
});

test('红线：信任判断与凭据不进投影', () => {
  const policy = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/mcp-server-policy.js'), 'utf8');
  const store = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/mcp-oauth-store.js'), 'utf8');
  assert.match(policy, /trust/);
  assert.match(store, /encryptTokens/);
});
