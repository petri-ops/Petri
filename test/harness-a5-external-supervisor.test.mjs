/**
 * A5 外部监督器 C 先行 — HK-01 红绿先行契约（只观测不动作）。
 *
 * 红（当前）：external-supervisor.js / metrics.supervisor / 两处接线缺席 → require/源级断言失败。
 * 绿（实现后）：心跳超时 + 异常退出各写 incident + metrics 计数 + 告警留痕；
 *               reasonCode/fingerprint 脱敏；零控制面动作；既有对账/DB 语义零漂移。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SUPERVISOR = path.join(ROOT, 'core/petri-server/helpers/external-supervisor.js');

const raw = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function makeDeps() {
  const incidents = [];
  const metricsCalls = [];
  const alarms = [];
  const healthCalls = [];
  const listeners = Object.create(null);
  return {
    incidents, metricsCalls, alarms, healthCalls, listeners,
    deps: {
      incidentLog: { recordIncident: (e) => incidents.push(e) },
      metrics: { recordSupervisorObservation: (e) => metricsCalls.push(e) },
      errorLog: { logError: (source, err, meta) => alarms.push({ source, err, meta }) },
      health: { buildHealthShape: (o) => { healthCalls.push(o); return { shape: true, ...o }; } },
      processEmitter: {
        on: (ev, fn) => {
          const existing = Object.entries(listeners).find(([k]) => k === ev)?.[1] ?? [];
          Object.assign(listeners, { [ev]: [...existing, fn] });
        },
        off: (ev, fn) => {
          const existing = Object.entries(listeners).find(([k]) => k === ev)?.[1] ?? [];
          Object.assign(listeners, { [ev]: existing.filter((f) => f !== fn) });
        },
      },
    },
  };
}

const loaded = () => {
  assert.ok(fs.existsSync(SUPERVISOR), 'external-supervisor.js 必须存在');
  return require(SUPERVISOR);
};

// ---- 观测三出口 --------------------------------------------------------

test('① 心跳超时 → incident(stall) + metrics 计数 + 告警留痕 + health shape', () => {
  const mod = loaded();
  const { deps, incidents, metricsCalls, alarms, healthCalls } = makeDeps();
  const sup = mod.createExternalSupervisor(deps);
  const rec = sup.observeHeartbeatTimeout({ sessionKey: 'tj_a1b2c3d4' });

  assert.equal(rec.kind, 'heartbeat_timeout');
  assert.equal(rec.reasonCode, mod.REASON_CODES.HEARTBEAT_TIMEOUT);
  assert.equal(rec.source, 'stall', '心跳超时复用既有 stall 白名单 source');
  assert.match(rec.fingerprint, /^[0-9a-f]{64}$/);
  assert.match(rec.session, /^[0-9a-f]{12}$/, '会话键经观测汇哈希，原始 id 不外泄');
  assert.ok(!rec.session.includes('tj_a1b2c3d4'));
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].source, 'stall');
  assert.equal(incidents[0].errorCode, mod.REASON_CODES.HEARTBEAT_TIMEOUT);
  assert.equal(incidents[0].tool, 'external-supervisor');
  assert.equal(metricsCalls.length, 1);
  assert.equal(metricsCalls[0].reasonCode, mod.REASON_CODES.HEARTBEAT_TIMEOUT);
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].source, 'external_supervisor');
  assert.match(alarms[0].err, /session_heartbeat_timeout/);
  assert.equal(alarms[0].meta.fingerprint, rec.fingerprint);
  assert.equal(healthCalls.length, 1);
  assert.equal(healthCalls[0].service, 'external-supervisor');
});

test('② 异常退出 → incident(fatal) + metrics 计数 + 告警留痕', () => {
  const mod = loaded();
  const { deps, incidents, metricsCalls, alarms } = makeDeps();
  const sup = mod.createExternalSupervisor(deps);
  const rec = sup.observeAbnormalExit({ sessionKey: 'tj_deadbeef' });

  assert.equal(rec.kind, 'abnormal_exit');
  assert.equal(rec.source, 'fatal', '异常退出复用既有 fatal 白名单 source');
  assert.equal(incidents[0].errorCode, mod.REASON_CODES.ABNORMAL_EXIT);
  assert.equal(metricsCalls[0].reasonCode, mod.REASON_CODES.ABNORMAL_EXIT);
  assert.match(alarms[0].err, /session_abnormal_exit/);
});

test('③ 脱敏零外发：会话键中的密钥/邮箱/会话 id/绝对路径不落任何出口', () => {
  const mod = loaded();
  const { deps, incidents, metricsCalls, alarms } = makeDeps();
  const sup = mod.createExternalSupervisor(deps);
  const secret = 'sk-livekey123456';
  const email = 'victim@example.com';
  const conv = 'conv_secret991';
  const absPath = '/Users/zhangdiandian/private/report.txt';
  sup.observeHeartbeatTimeout({ sessionKey: `${secret} ${email} ${conv} ${absPath}` });
  const all = JSON.stringify({ incidents, metricsCalls, alarms });
  for (const needle of [secret, email, conv, absPath, 'private/report']) {
    assert.ok(!all.includes(needle), `脱敏泄漏：${needle}`);
  }
});

test('④ 进程异常钩子只观测：收到 Error(含用户数据)不写入原文、不退出、可 dispose', () => {
  const mod = loaded();
  const { deps, incidents, listeners } = makeDeps();
  const sup = mod.createExternalSupervisor(deps);
  const dispose = sup.installProcessHooks();
  assert.equal(listeners.uncaughtException.length, 1);
  assert.equal(listeners.unhandledRejection.length, 1);
  const boom = new Error('secret user message sk-abcdef123456');
  assert.doesNotThrow(() => listeners.uncaughtException[0](boom));
  assert.equal(incidents.length, 1);
  assert.ok(!JSON.stringify(incidents).includes('secret user message'));
  assert.equal(incidents[0].errorCode, mod.REASON_CODES.ABNORMAL_EXIT);
  dispose();
  assert.equal(listeners.uncaughtException.length, 0);
});

test('⑤ fail-soft：任一出口抛错不阻断观测链，其余出口仍记账', () => {
  const mod = loaded();
  const base = makeDeps();
  base.deps.incidentLog.recordIncident = () => { throw new Error('db down'); };
  const sup = mod.createExternalSupervisor(base.deps);
  assert.doesNotThrow(() => sup.observeHeartbeatTimeout({ sessionKey: 'tj_x' }));
  assert.equal(base.metricsCalls.length, 1, 'incident 失败不得吞掉 metrics/告警');
  assert.equal(base.alarms.length, 1);
});

test('⑥ 快照可观测：按 reasonCode 累计', () => {
  const mod = loaded();
  const { deps } = makeDeps();
  const sup = mod.createExternalSupervisor(deps);
  sup.observeHeartbeatTimeout({ sessionKey: 'tj_1' });
  sup.observeHeartbeatTimeout({ sessionKey: 'tj_2' });
  sup.observeAbnormalExit({ sessionKey: 'tj_3' });
  const snap = sup.getSnapshot();
  assert.equal(snap.observations, 3);
  assert.equal(snap.byReason[mod.REASON_CODES.HEARTBEAT_TIMEOUT], 2);
  assert.equal(snap.byReason[mod.REASON_CODES.ABNORMAL_EXIT], 1);
});

// ---- 零控制面 / 接线源级断言 -------------------------------------------

test('⑦ 红线：观测模块无任何控制面动作代码', () => {
  const s = raw('core/petri-server/helpers/external-supervisor.js');
  for (const pattern of [
    /process\.kill/, /\.kill\(/, /child_process/, /\bspawn\s*\(/,
    /setInterval/, /setTimeout/, /process\.exit/,
    /\bUPDATE\s/, /\bDELETE\s/, /\bINSERT\s/, /recovery_required/,
  ]) {
    assert.ok(!pattern.test(s), `控制面/定时器/DB 写红线命中：${pattern}`);
  }
});

test('⑧ 接线：metrics.js 增 additive supervisor 计数（不改既有字段）', () => {
  const m = require(path.join(ROOT, 'core/shared-backend/metrics.js'));
  m.resetMetrics();
  assert.equal(typeof m.recordSupervisorObservation, 'function');
  m.recordSupervisorObservation({ reasonCode: 'session_heartbeat_timeout' });
  const snap = m.getMetricsSnapshot();
  assert.equal(snap.supervisor.observations, 1);
  assert.equal(snap.supervisor.byReason.session_heartbeat_timeout, 1);
  assert.equal(snap.ipc.total, 0, '既有 metrics 字段零漂移');
  m.resetMetrics();
  assert.equal(m.getMetricsSnapshot().supervisor.observations, 0);
});

test('⑨ 接线：对账器仅在真收口时通知观测（默认 no-op / 抛错不阻断 / DB 语义不变）', () => {
  const Database = require(path.join(ROOT, 'core/petri-server/node_modules/better-sqlite3'));
  const { reconcileStaleRunningToolJobs, DEFAULT_STALE_AFTER_MS } = require(
    path.join(ROOT, 'core/petri-server/helpers/stale-running-reconciler.js'));
  const dir = mkdtempSync(join(tmpdir(), 'a5-reconciler-'));
  const db = new Database(join(dir, 't.db'));
  db.exec('CREATE TABLE tool_jobs (id TEXT PRIMARY KEY, status TEXT, created_at INTEGER, heartbeat_at INTEGER, error TEXT, completed_at INTEGER)');
  const now = Date.now();
  db.prepare('INSERT INTO tool_jobs (id,status,created_at,heartbeat_at) VALUES (?,?,?,?)')
    .run('tj_a5', 'running', now, now - DEFAULT_STALE_AFTER_MS - 1000);

  const seen = [];
  const r = reconcileStaleRunningToolJobs({ db, now: () => now, onHeartbeatTimeout: (e) => seen.push(e) });
  assert.deepEqual(r.reconciled, ['tj_a5'], 'DB 收口语义不变');
  assert.equal(db.prepare('SELECT status FROM tool_jobs WHERE id=?').get('tj_a5').status, 'failed');
  assert.equal(seen.length, 1, '真收口才通知观测');
  assert.equal(seen[0].sessionKey, 'tj_a5', '对账器只透传 id，脱敏由观测汇负责');

  // 观测回调抛错不得阻断对账
  db.prepare("UPDATE tool_jobs SET status='running' WHERE id=?").run('tj_a5');
  assert.doesNotThrow(() => reconcileStaleRunningToolJobs({
    db, now: () => now,
    onHeartbeatTimeout: () => { throw new Error('observer down'); },
  }));
  // 默认 no-op：既有调用方行为零漂移
  db.prepare("UPDATE tool_jobs SET status='running' WHERE id=?").run('tj_a5');
  assert.deepEqual(reconcileStaleRunningToolJobs({ db, now: () => now }).reconciled, ['tj_a5']);
  db.close(); rmSync(dir, { recursive: true, force: true });
});

test('⑩ 接线：server-main 装进程钩子 + 对账器传观测回调 + health 带 supervisor 细节', () => {
  const s = raw('core/petri-server/server-main.js');
  assert.match(s, /installSupervisorProcessHooks\(\)/, '进程异常钩子须安装');
  assert.match(s, /onHeartbeatTimeout:\s*\(\{\s*sessionKey\s*\}\)?\s*=>/ , '对账器须接观测回调');
  const routes = raw('core/petri-server/routes/index.js');
  assert.match(s, /supervisorSnapshot/, 'legacy health 兜底面须带 supervisor 细节');
  assert.match(routes, /supervisorSnapshot/, 'modular health 面（先匹配）须带 supervisor 细节');
  const u = raw('acceptance/harness-observability/U-EXTERNAL-SUPERVISOR.md');
  assert.match(u, /status: pending_user_ruling/, 'U canonical 状态不擅自翻（BLOCK-520 P0/P2 治理）');
});
