/**
 * EVO-0 HK-01 — Harness 自进化基座的可执行合同。
 * 红（当前）：incident-fingerprint / harness-redline 模块缺席 → require 失败。
 * 绿（实现后）：fingerprint 归一化稳定 / 脱敏零残留 / 红线不可改 / migration 023 可建表。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const req = createRequire(import.meta.url);

const { INCIDENT_LIMITS, redactIncidentPayload, normalizeIncidentFingerprint } =
  req(path.resolve(ROOT, 'core/shared-backend/incident-fingerprint.js'));
const { EVOLUTION_REDLINE, classifyEvolutionTarget, assertEvolutionTargetAllowed } =
  req(path.resolve(ROOT, 'core/shared-backend/harness-redline.js'));

describe('EVO-0 · incident fingerprint 归一化/脱敏', () => {
  it('① 同义输入（不同会话 id / 时间戳 / 临时路径）得到同一 fingerprint', () => {
    const a = normalizeIncidentFingerprint({
      source: 'tool_failure', errorCode: 'unknown_tool', tool: 'workspace_exec',
      message: 'unknown_tool exec at conv_abc123 2026-11-20T10:00:00Z /tmp/foo.js'
    });
    const b = normalizeIncidentFingerprint({
      source: 'tool_failure', errorCode: 'unknown_tool', tool: 'workspace_exec',
      message: 'unknown_tool exec at conv_xyz789 2026-11-21T11:22:33Z /tmp/bar.js'
    });
    assert.equal(a.fingerprint, b.fingerprint);
  });

  it('② 不同错误得到不同 fingerprint', () => {
    const a = normalizeIncidentFingerprint({ source: 'fatal', message: 'TypeError: cannot read x' });
    const b = normalizeIncidentFingerprint({ source: 'fatal', message: 'ReferenceError: y is not defined' });
    assert.notEqual(a.fingerprint, b.fingerprint);
  });

  it('③ 敏感 token / 邮箱 / 会话 id 脱敏零残留', () => {
    const raw = 'key=sk-abc123SECRET token user@example.com conv_abc123';
    const r = redactIncidentPayload({ message: raw });
    const out = JSON.stringify(r);
    assert.ok(!out.includes('sk-abc123SECRET'), '密钥残留');
    assert.ok(!out.includes('user@example.com'), '邮箱残留');
    assert.ok(!out.includes('conv_abc123'), '会话 id 残留');
  });

  it('④ fingerprint 为 64 位 sha256 十六进制', () => {
    const r = normalizeIncidentFingerprint({ message: 'boom' });
    assert.match(r.fingerprint, /^[0-9a-f]{64}$/);
  });

  it('⑤ 超长输入按有界上限截断（不 OOM）', () => {
    const r = normalizeIncidentFingerprint({ message: 'x'.repeat(100000) });
    assert.ok(r.normalized.length <= INCIDENT_LIMITS.maxRawLength);
  });
});

describe('EVO-0 · 不可修改红线守卫', () => {
  it('⑥ harness 自身源码 / 工具注册表 / approval 链一律拒绝', () => {
    const forbidden = [
      'core/petri-server/agent-runner.js',
      'core/shared-backend/loop-orchestrator.js',
      'core/petri-server/agent-tools/registry.js',
      'core/petri-server/agent-tools/tool-defs/workspace.js',
      'core/petri-server/helpers/agent-execution-policy.js',
      'core/petri-server/agent-tools/agent-tool-interceptor.js',
      'resources/skills/paper-writing/SKILL.md',
      '.env', '.git/config', '.petri-secrets/key'
    ];
    for (const target of forbidden) {
      const r = classifyEvolutionTarget(target);
      assert.equal(r.allowed, false, `${target} 应被拒`);
      assert.throws(() => assertEvolutionTargetAllowed(target));
    }
  });

  it('⑦ 允许的进化写入面放行（LEARNINGS / 可写策略 / installed skill）', () => {
    const allowed = [
      '.petri/LEARNINGS.md',
      '.petri/MEMORY.md',
      'agent-rules.json',
      'tool-approval-policy.json',
      '.petri/installed-skills/foo/SKILL.md'
    ];
    for (const target of allowed) {
      const r = classifyEvolutionTarget(target);
      assert.equal(r.allowed, true, `${target} 应放行`);
      assert.doesNotThrow(() => assertEvolutionTargetAllowed(target));
    }
  });

  it('⑧ 红线表自身 owner=code（agent 不可改）', () => {
    assert.equal(EVOLUTION_REDLINE.owner, 'code');
  });
});

describe('EVO-0 · migration 023 建表', () => {
  it('⑨ migration 023 创建 incidents 表且含 fingerprint 索引（源级断言）', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'src/migrations/023_incidents.sql'), 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS incidents/);
    assert.match(sql, /fingerprint\s+TEXT\s+NOT NULL/);
    assert.match(sql, /idx_incidents_fingerprint/);
  });

  it('⑩ 真实 SQLite 执行全部 migration 后 incidents 表可写可读（端到端建表）', () => {
    const os = req('node:os');
    const Database = req(path.resolve(ROOT, 'core/petri-server/node_modules/better-sqlite3'));
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-evo0-db-'));
    const db = new Database(path.join(tempDir, 'petri.db'));
    try {
      const migrationsDir = path.join(ROOT, 'src/migrations');
      for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
        db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
      }
      const fp = normalizeIncidentFingerprint({ source: 'fatal', message: 'boom' }).fingerprint;
      db.prepare(
        'INSERT INTO incidents (fingerprint, source, normalized, created_at) VALUES (?, ?, ?, ?)'
      ).run(fp, 'fatal', 'boom', '2026-11-20T00:00:00Z');
      const row = db.prepare('SELECT fingerprint, source FROM incidents WHERE fingerprint = ?').get(fp);
      assert.equal(row.source, 'fatal');
      const cols = db.prepare('PRAGMA table_info(incidents)').all().map((c) => c.name);
      for (const col of ['fingerprint', 'source', 'error_code', 'tool', 'phase', 'normalized', 'conversation_id', 'created_at']) {
        assert.ok(cols.includes(col), `缺列 ${col}`);
      }
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
