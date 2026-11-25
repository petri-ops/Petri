/**
 * A3-D1 HK-01 — 注入边界 frequency_rebound 冻结门的可执行合同。
 * RED（当前）：lesson-injection-guard 模块缺席 → 逐例 require 失败。
 * GREEN（实现后）：rollback 剔除且 verdict 随行；degrade/keep/fail-open 保持注入；
 *   DB status 不变、无 LEARNINGS/MEMORY 门、红线表一字不改、零新依赖、agent-runner 先门后注入。
 *
 * 真源 API（已现读核对）：verifyLessonFrequency(fp) → {before, after, decision:{decision,code,reason}, ok}；
 * lesson 对象主键字段为 sourceFingerprint；rollback 唯一码 frequency_rebound。
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

const GUARD_PATH = path.resolve(ROOT, 'core/petri-server/helpers/lesson-injection-guard.js');
const STORE_PATH = path.resolve(ROOT, 'core/petri-server/helpers/lesson-store.js');
const RUNNER_PATH = path.resolve(ROOT, 'core/petri-server/agent-runner.js');
const REDLINE_PATH = path.resolve(ROOT, 'core/shared-backend/harness-redline.js');

function loadGuard() {
  return req(GUARD_PATH).guardLessonInjection;
}

const mkLesson = (fp) => ({
  sourceFingerprint: fp, title: 'T', action: 'A', scope: 'auto', confidence: 0.9, status: 'active',
});
const verdict = (decision, code, reason) => ({
  ok: true, before: 1, after: 4, decision: { decision, code, reason },
});

function openTempDb() {
  const os = req('node:os');
  const Database = req(path.resolve(ROOT, 'core/petri-server/node_modules/better-sqlite3'));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-a3d1-db-'));
  const db = new Database(path.join(tempDir, 'petri.db'));
  const migrationsDir = path.join(ROOT, 'src/migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  return { db, tempDir };
}

describe('A3-D1 · 注入边界 frequency_rebound 冻结', () => {
  it('1 rollback → 剔除本轮注入，冻结理由随 verdict 留痕', () => {
    const guard = loadGuard();
    const lesson = mkLesson('fp-rebound');
    const v = verdict('rollback', 'frequency_rebound', '生效后频率回升（1→4）：自动回滚该 lesson');
    const calls = [];
    const out = guard([lesson], (fp) => { calls.push(fp); return v; });
    assert.deepEqual(calls, ['fp-rebound'], '每条 lesson 按其 sourceFingerprint 取 verdict');
    assert.equal(out.lessons.length, 0, 'rollback 不进本轮注入');
    assert.equal(out.frozen.length, 1);
    assert.equal(out.frozen[0].sourceFingerprint, 'fp-rebound');
    assert.equal(out.frozen[0].verdict.decision, 'rollback');
    assert.equal(out.frozen[0].verdict.code, 'frequency_rebound');
    assert.match(out.frozen[0].verdict.reason, /频率回升/);
  });

  it('2 degrade（频率持平）不冻结、保持注入（D2）', () => {
    const guard = loadGuard();
    const lesson = mkLesson('fp-flat');
    const out = guard([lesson], () => verdict('degrade', 'frequency_flat', '频率基本持平：降级观察'));
    assert.equal(out.lessons.length, 1);
    assert.equal(out.lessons[0], lesson, 'degrade 原样注入，不降权不改写');
    assert.equal(out.frozen.length, 0);
  });

  it('3 keep（频率下降 / 零复发）不冻结、保持注入', () => {
    const guard = loadGuard();
    const a = mkLesson('fp-down');
    const b = mkLesson('fp-zero');
    const out = guard([a, b], () => verdict('keep', 'frequency_down', '保留'));
    assert.deepEqual(out.lessons, [a, b]);
    assert.equal(out.frozen.length, 0);
  });

  it('4 混合批量：只剔除 rollback，其余保序注入', () => {
    const guard = loadGuard();
    const rebound = mkLesson('fp-rebound');
    const flat = mkLesson('fp-flat');
    const keep = mkLesson('fp-keep');
    const out = guard([rebound, flat, keep], (fp) => (
      fp === 'fp-rebound'
        ? verdict('rollback', 'frequency_rebound', 'rb')
        : verdict('degrade', 'frequency_flat', 'flat')
    ));
    assert.deepEqual(out.lessons, [flat, keep]);
    assert.equal(out.frozen.length, 1);
  });

  it('5 verifier 读失败 ok:false → fail-open 注入（不误伤）', () => {
    const guard = loadGuard();
    const { judgeFrequency } = req(path.resolve(ROOT, 'core/shared-backend/lesson-frequency.js'));
    const lesson = mkLesson('fp-unknown');
    const out = guard([lesson], () => ({ ok: false, before: 0, after: 0, decision: judgeFrequency(0, 0) }));
    assert.equal(out.lessons.length, 1);
    assert.equal(out.frozen.length, 0);
  });

  it('6 verifier 抛错 → fail-open 且不影响主链（fail-soft）', () => {
    const guard = loadGuard();
    const lesson = mkLesson('fp-throw');
    const out = guard([lesson], () => { throw new Error('db down'); });
    assert.equal(out.lessons.length, 1);
    assert.equal(out.frozen.length, 0);
  });

  it('7 空 / 非数组输入 → 零注入零冻结', () => {
    const guard = loadGuard();
    assert.deepEqual(guard([], () => verdict('rollback', 'frequency_rebound', 'x')), { lessons: [], frozen: [] });
    assert.deepEqual(guard(null, null), { lessons: [], frozen: [] });
  });
});

describe('A3-D1 · 真源判据 + 真实 SQLite 接线', () => {
  it('8 rollback 唯一来源是 judgeFrequency 的 frequency_rebound（不改判据本体）', () => {
    const { judgeFrequency, VERIFY_RULES } = req(path.resolve(ROOT, 'core/shared-backend/lesson-frequency.js'));
    assert.equal(judgeFrequency(1, 4).decision, 'rollback');
    assert.equal(judgeFrequency(1, 4).code, 'frequency_rebound');
    assert.equal(judgeFrequency(3, 3).decision, 'degrade');
    assert.equal(judgeFrequency(2, 0).decision, 'keep');
    assert.equal(VERIFY_RULES.owner, 'code');
    assert.equal(VERIFY_RULES.minSamplesForRebound, 1);
  });

  it('9 真实 verifyLessonFrequency：rebound 剔除 / degrade 注入 / DB status 全不变（D3）', () => {
    const guard = loadGuard();
    const { listActiveLessons, verifyLessonFrequency, _setLessonDb } = req(STORE_PATH);
    const { db, tempDir } = openTempDb();
    _setLessonDb(db);
    try {
      const boundary = '2026-11-20T00:00:00Z';
      const putLesson = (fp, confidence) => db.prepare(
        `INSERT INTO lessons (source_fingerprint, title, action, scope, confidence, evidence, status,
           created_at, last_seen_at, occurrences_before, occurrences_after)
         VALUES (?,?,?,?,?,?, 'active', ?, ?, 0, 0)`
      ).run(fp, 'L', 'act', 'auto', confidence, '[]', boundary, boundary);
      const putIncident = (fp, at) => db.prepare(
        'INSERT INTO incidents (fingerprint, source, normalized, created_at) VALUES (?,?,?,?)'
      ).run(fp, 'fatal', 'x', at);
      putLesson('fp-rebound', 0.9);
      putLesson('fp-flat', 0.8);
      putIncident('fp-rebound', '2026-11-18T00:00:00Z');
      putIncident('fp-rebound', '2026-11-21T01:00:00Z');
      putIncident('fp-rebound', '2026-11-21T02:00:00Z');
      putIncident('fp-flat', '2026-11-18T00:00:00Z');
      putIncident('fp-flat', '2026-11-19T00:00:00Z');
      putIncident('fp-flat', '2026-11-21T01:00:00Z');
      putIncident('fp-flat', '2026-11-21T02:00:00Z');

      const lessons = listActiveLessons(8);
      assert.equal(lessons.length, 2);
      const out = guard(lessons, verifyLessonFrequency);
      assert.equal(out.lessons.length, 1, '仅 rollback 剔除');
      assert.equal(out.lessons[0].sourceFingerprint, 'fp-flat');
      assert.equal(out.frozen.length, 1);
      assert.equal(out.frozen[0].sourceFingerprint, 'fp-rebound');
      assert.equal(out.frozen[0].verdict.decision, 'rollback');
      assert.equal(out.frozen[0].verdict.code, 'frequency_rebound');
      // D3：注入边界过滤不碰 DB status，收口仍归既有 rollbackLesson
      assert.equal(db.prepare('SELECT status FROM lessons WHERE source_fingerprint = ?').get('fp-rebound').status, 'active');
      assert.equal(db.prepare('SELECT status FROM lessons WHERE source_fingerprint = ?').get('fp-flat').status, 'active');
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('A3-D1 · D2–D5 边界 + 零新依赖 + 接线位置', () => {
  const guardSrc = fs.existsSync(GUARD_PATH) ? fs.readFileSync(GUARD_PATH, 'utf8') : '';
  const runnerSrc = fs.readFileSync(RUNNER_PATH, 'utf8');

  it('10 不改 DB status：guard 无 rollbackLesson / UPDATE / status 写入（D3）', () => {
    assert.ok(guardSrc.length > 0, 'guard 模块须存在');
    assert.ok(!/rollbackLesson/.test(guardSrc));
    assert.ok(!/UPDATE\s+lessons/i.test(guardSrc));
    assert.ok(!/\bstatus\s*=/.test(guardSrc));
  });

  it('11 不纳入 LEARNINGS 回读、不给 MEMORY 加频率门（D4/D5）', () => {
    assert.ok(!/LEARNINGS\.md/.test(guardSrc));
    assert.ok(!/MEMORY\.md/.test(guardSrc));
  });

  it('12 红线表一字不改：owner:code / FORBIDDEN / ALLOWLIST 原样在场', () => {
    const { EVOLUTION_REDLINE, FORBIDDEN, FORBIDDEN_SEGMENTS, ALLOWLIST } = req(REDLINE_PATH);
    assert.equal(EVOLUTION_REDLINE.owner, 'code');
    assert.equal(EVOLUTION_REDLINE.version, 1);
    assert.equal(FORBIDDEN.length, 13);
    assert.equal(FORBIDDEN_SEGMENTS.length, 6);
    assert.deepEqual(ALLOWLIST.map((e) => [e.prefix, e.tier]), [
      ['.petri/LEARNINGS.md', 'auto'],
      ['.petri/MEMORY.md', 'auto'],
      ['agent-rules.json', 'ack'],
      ['tool-approval-policy.json', 'ack'],
      ['memory-policy.json', 'ack'],
      ['.petri/installed-skills/', 'draft'],
    ]);
  });

  it('13 零新依赖：新增 guard 为纯模块（零 require / 零 import）', () => {
    assert.ok(guardSrc.length > 0, 'guard 模块须存在');
    assert.ok(!/\brequire\s*\(/.test(guardSrc), 'guard 不得引入任何依赖');
    assert.ok(!/\bfrom\s+['"]/.test(guardSrc), 'guard 不得 import');
  });

  it('14 agent-runner 注入边界：先 guard 后写 selfEvolutionLessons', () => {
    const guardIdx = runnerSrc.indexOf('guardLessonInjection');
    const assignIdx = runnerSrc.indexOf('ctxForPrompt.selfEvolutionLessons =');
    assert.ok(guardIdx > 0, 'agent-runner 未接 guard');
    assert.ok(assignIdx > guardIdx, 'guard 必须早于 selfEvolutionLessons 赋值');
    assert.ok(/verifyLessonFrequency/.test(runnerSrc), 'guard 须消费真源 verifyLessonFrequency');
  });
});
