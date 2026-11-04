#!/usr/bin/env node
/**
 * scripts/block349-retention-live.mjs — BLOCK-349 探针 E：tool_jobs retention 长跑节拍取证（UI-458 实机腿）。
 *
 * 双腿设计：
 *   腿1（真实老化数据）：拷贝主 dev 栈真实 DB（.petri-dev-user-data/data/petri.db）到临时目录，
 *     统计 tool_jobs 年龄分布 → 对副本跑生产 sweeper（helpers/tool-jobs-retention.js
 *     retentionSweep，与 jobs/retention-sweeper 既有节拍同一函数）→ 前后计数对账。
 *   腿2（边界夹具）：隔离 DB 构造四类行—— aged completed / aged is_public=1（动态公开保护）/
 *     recent completed / aged 但命中 protectedJobIds（静态演示保护）→ 断言「只删 aged 非保护终态」。
 *
 * 诚实标注：腿1=真实库 + 生产 sweeper 路径（不写生产库，只写副本）；30 天自然老化
 * 不可等待，以 created_at 实测年龄分布说明真实库确有超 30 天行（真老化清偿样本）。
 * 证据落 acceptance/block-349/retention-live.json。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'acceptance', 'block-349', 'retention-live.json');
const Database = require('better-sqlite3');
const { retentionSweep } = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'tool-jobs-retention.js'));

const DEV_DB = path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db');
const DAY = 24 * 60 * 60 * 1000;
const result = { at: new Date().toISOString(), retentionDays: 30, legs: {} };

function jobStats(db) {
  return {
    total: db.prepare('SELECT COUNT(*) AS n FROM tool_jobs').get().n,
    byStatus: db.prepare('SELECT status, COUNT(*) AS n FROM tool_jobs GROUP BY status ORDER BY n DESC').all(),
    agedOver30d: db.prepare('SELECT COUNT(*) AS n FROM tool_jobs WHERE created_at < ?').get(Date.now() - 30 * DAY).n,
    oldest: db.prepare('SELECT MIN(created_at) AS t FROM tool_jobs').get().t,
  };
}

// ---------- 腿1：真实 DB 副本 ----------
try {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'block349-retention-'));
  const dbPath = path.join(tmp, 'petri.db');
  fs.copyFileSync(DEV_DB, dbPath);
  for (const suffix of ['-wal', '-shm']) {
    const src = DEV_DB + suffix;
    if (fs.existsSync(src)) { try { fs.copyFileSync(src, dbPath + suffix); } catch { /* 快照竞态容忍 */ } }
  }
  const db = new Database(dbPath);
  const before = jobStats(db);
  const sweep = retentionSweep({ db, retentionDays: 30, jobsDir: null });
  const after = jobStats(db);
  // 复核：删掉的行必须全部满足「超 30 天 + 终态 + 非公开」（生产保护边界）
  let boundaryViolation = null;
  for (const id of sweep.ids) {
    const orig = new Database(DEV_DB, { readonly: true }).prepare('SELECT status, is_public, created_at FROM tool_jobs WHERE id = ?').get(id);
    if (!orig) { boundaryViolation = `id=${id} 不在生产库中（不应发生）`; break; }
    if (!(Date.now() - orig.created_at > 30 * DAY) || !['completed', 'failed', 'cancelled'].includes(orig.status) || orig.is_public === 1) {
      boundaryViolation = `id=${id} 不满足删除边界（age=${Math.round((Date.now() - orig.created_at) / DAY)}d status=${orig.status} is_public=${orig.is_public}）`;
      break;
    }
  }
  result.legs.realDb = {
    source: '.petri-dev-user-data/data/petri.db（拷贝副本，生产库不受影响）',
    before, sweep, after, deleted: before.total - after.total,
    boundaryCheck: boundaryViolation ? `VIOLATION: ${boundaryViolation}` : 'PASS（全部删除行满足 超30天+终态+非公开）',
    oldestAgeDays: before.oldest ? Math.round((Date.now() - before.oldest) / DAY) : null,
  };
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (e) {
  result.legs.realDb = { error: String(e && e.stack || e).slice(0, 400) };
}

// ---------- 腿2：边界夹具 ----------
try {
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'block349-retention-fx-'));
  const dbPath = path.join(tmp2, 'fixture.db');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE tool_jobs (
    id TEXT PRIMARY KEY, user_id TEXT, tool_id TEXT, params_json TEXT, status TEXT, name TEXT,
    is_test_run INTEGER, is_public INTEGER, result_json TEXT, completed_at BIGINT, error TEXT,
    conversation_id TEXT, ack_token TEXT, ack_status TEXT, ack_expires_at BIGINT, project_id TEXT,
    process_pid INTEGER, heartbeat_at BIGINT, retry_count INTEGER, execution_target_id TEXT,
    created_at BIGINT)`);
  const ins = db.prepare('INSERT INTO tool_jobs (id, tool_id, status, is_public, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)');
  const d40 = Date.now() - 40 * DAY;
  const d2 = Date.now() - 2 * DAY;
  ins.run('aged-completed', 'demo-tool', 'completed', 0, d40, d40);
  ins.run('aged-public', 'demo-tool', 'completed', 1, d40, d40);       // is_public=1 保护
  ins.run('aged-protected', 'demo-tool', 'completed', 0, d40, d40);    // protectedJobIds 保护
  ins.run('recent-completed', 'demo-tool', 'completed', 0, d2, d2);    // 未超窗保留
  ins.run('aged-running', 'demo-tool', 'running', 0, d40, null);       // 非终态永不删
  const sweep2 = retentionSweep({ db, retentionDays: 30, jobsDir: null, protectedJobIds: ['aged-protected'] });
  const remaining = db.prepare('SELECT id FROM tool_jobs ORDER BY id').all().map((r) => r.id);
  const pass = JSON.stringify(remaining) === JSON.stringify(['aged-protected', 'aged-public', 'aged-running', 'recent-completed'])
    && sweep2.ids.includes('aged-completed') && sweep2.ids.length === 1;
  result.legs.fixture = { remaining, sweepResult: sweep2, pass, expectation: '仅 aged-completed 被删；is_public=1 / protected / recent / running 全保留' };
  db.close();
  fs.rmSync(tmp2, { recursive: true, force: true });
} catch (e) {
  result.legs.fixture = { error: String(e && e.stack || e).slice(0, 400) };
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
const leg1Ok = !result.legs.realDb.error && String(result.legs.realDb.boundaryCheck || '').startsWith('PASS');
const leg2Ok = result.legs.fixture.pass === true;
console.log(`[block349-retention] 腿1(真实库) ${leg1Ok ? 'OK' : 'ERR'} 腿2(夹具边界) ${leg2Ok ? 'OK' : 'ERR'} → ${path.relative(ROOT, OUT)}`);
if (result.legs.realDb.before) {
  console.log(`  真实库 tool_jobs=${result.legs.realDb.before.total}（最老 ${result.legs.realDb.oldestAgeDays} 天）超期30天=${result.legs.realDb.before.agedOver30d} → sweep 删 ${result.legs.realDb.deleted}；${result.legs.realDb.boundaryCheck}`);
}
process.exitCode = leg1Ok && leg2Ok ? 0 : 1;
