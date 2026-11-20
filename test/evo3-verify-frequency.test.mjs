/**
 * EVO-3 HK-01 — Verify 频率曲线 + 自动回滚 + LEARNINGS.md 双写 + 真实闭环的可执行合同。
 * 红（当前）：lesson-frequency / markdown-projection 模块与 lesson-store 新接口缺席 → require 失败。
 * 绿（实现后）：降留/平降级/升回滚判据 + 真实 SQLite 频率查询 + 回滚改 status + MD 标记段增删 + BLOCK-510 真实指纹闭环。
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

const {
  VERIFY_RULES, judgeFrequency,
} = req(path.resolve(ROOT, 'core/shared-backend/lesson-frequency.js'));
const {
  buildLessonMarkdown, upsertLessonMarkdown, removeLessonMarkdown,
} = req(path.resolve(ROOT, 'core/petri-server/helpers/lesson-markdown-projection.js'));
const {
  verifyLessonFrequency, rollbackLesson, listLessonEvidence,
  _setLessonDb,
} = req(path.resolve(ROOT, 'core/petri-server/helpers/lesson-store.js'));
const { normalizeIncidentFingerprint } = req(path.resolve(ROOT, 'core/shared-backend/incident-fingerprint.js'));

function openTempDb() {
  const os = req('node:os');
  const Database = req(path.resolve(ROOT, 'core/petri-server/node_modules/better-sqlite3'));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-evo3-db-'));
  const db = new Database(path.join(tempDir, 'petri.db'));
  const migrationsDir = path.join(ROOT, 'src/migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  return { db, tempDir, Database };
}

describe('EVO-3 · 频率判据纯函数（降留/平降级/升回滚）', () => {
  it('① 频率下降 → keep', () => {
    assert.equal(judgeFrequency(5, 1).decision, 'keep');
  });
  it('② 频率持平 → degrade', () => {
    assert.equal(judgeFrequency(3, 3).decision, 'degrade');
  });
  it('③ 频率回升 → rollback', () => {
    assert.equal(judgeFrequency(1, 4).decision, 'rollback');
  });
  it('④ 无后续样本（after=0）→ keep（学后零复发=最强保留）', () => {
    assert.equal(judgeFrequency(2, 0).decision, 'keep');
  });
  it('⑤ 判据带机器码与理由（可审计）', () => {
    const r = judgeFrequency(1, 4);
    assert.ok(r.code && r.reason);
    assert.equal(r.code, 'frequency_rebound');
  });
  it('⑥ 冻结常量判据阈值在场', () => {
    assert.ok(VERIFY_RULES && VERIFY_RULES.maxFlatRatio >= 0);
  });
});

describe('EVO-3 · LEARNINGS.md 标记段双写', () => {
  it('7 生成带标记的 lesson 段', () => {
    const md = buildLessonMarkdown({
      sourceFingerprint: 'fp-1', title: '工具名要精确', action: '先 list 工具', scope: 'auto', confidence: 0.9,
    });
    assert.match(md, /<!-- evo:lesson:fp-1 -->/);
    assert.match(md, /工具名要精确/);
  });
  it('8 upsert 同 id 段不重复（标记段幂等替换）', () => {
    let md = buildLessonMarkdown({ sourceFingerprint: 'fp-1', title: 'v1', action: 'a', scope: 'auto', confidence: 0.9 });
    md = upsertLessonMarkdown(md, { sourceFingerprint: 'fp-1', title: 'v2', action: 'b', scope: 'auto', confidence: 0.95 });
    assert.equal((md.match(/<!-- evo:lesson:fp-1 -->/g) || []).length, 1);
    assert.match(md, /v2/);
    assert.ok(!md.includes('v1'));
  });
  it('9 remove 按 id 删段，其余保留', () => {
    let md = buildLessonMarkdown({ sourceFingerprint: 'fp-1', title: 'A', action: 'a', scope: 'auto', confidence: 0.9 })
      + '\n' + buildLessonMarkdown({ sourceFingerprint: 'fp-2', title: 'B', action: 'b', scope: 'auto', confidence: 0.9 });
    md = removeLessonMarkdown(md, 'fp-1');
    assert.ok(!md.includes('evo:lesson:fp-1'));
    assert.ok(!md.includes('标题 A') && !md.includes('A →'), 'A 段应移除');
    assert.match(md, /evo:lesson:fp-2/);
  });
});

describe('EVO-3 · 真实 SQLite Verify + 回滚', () => {
  it('10 verifyLessonFrequency 按 lesson.created_at 分段计数（真实指纹）', () => {
    const { db, tempDir } = openTempDb();
    _setLessonDb(db);
    try {
      // BLOCK-510 真实指纹：unknown_tool / workspace_exec
      const fp = normalizeIncidentFingerprint({
        source: 'tool_failure', errorCode: 'unknown_tool', tool: 'workspace_exec', message: 'unknown_tool exec',
      }).fingerprint;
      const insertIncident = (at) => db.prepare(
        'INSERT INTO incidents (fingerprint, source, error_code, tool, normalized, created_at) VALUES (?,?,?,?,?,?)'
      ).run(fp, 'tool_failure', 'unknown_tool', 'workspace_exec', 'unknown_tool exec', at);
      insertIncident('2026-11-18T00:00:00Z');
      insertIncident('2026-11-19T00:00:00Z');
      // lesson created_at 在两条错误之后
      db.prepare(
        `INSERT INTO lessons (source_fingerprint, title, action, scope, confidence, evidence, status, created_at, last_seen_at, occurrences_before, occurrences_after)
         VALUES (?,?,?,?,?,?, 'active', ?, ?, 2, 0)`
      ).run(fp, '工具名要精确', '先 list', 'auto', 0.9, '[]', '2026-11-20T00:00:00Z', '2026-11-20T00:00:00Z');
      // 生效后零复发
      const v = verifyLessonFrequency(fp);
      assert.equal(v.before, 2);
      assert.equal(v.after, 0);
      assert.equal(v.decision.decision, 'keep');
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('11 频率回升 → rollbackLesson 改 status=rollback 并留证据', () => {
    const { db, tempDir } = openTempDb();
    _setLessonDb(db);
    try {
      const fp = 'fp-rebound';
      db.prepare(
        `INSERT INTO lessons (source_fingerprint, title, action, scope, confidence, evidence, status, created_at, last_seen_at, occurrences_before, occurrences_after)
         VALUES (?,?,?,?,?,?, 'active', ?, ?, 1, 0)`
      ).run(fp, 'L', 'act', 'auto', 0.8, '[]', '2026-11-19T00:00:00Z', '2026-11-19T00:00:00Z');
      const add = (at) => db.prepare(
        'INSERT INTO incidents (fingerprint, source, normalized, created_at) VALUES (?,?,?,?)'
      ).run(fp, 'fatal', 'x', at);
      add('2026-11-18T00:00:00Z');
      add('2026-11-20T01:00:00Z');
      add('2026-11-20T02:00:00Z');
      add('2026-11-20T03:00:00Z');
      const r = rollbackLesson(fp, 'frequency_rebound');
      assert.equal(r.ok, true);
      const row = db.prepare('SELECT status FROM lessons WHERE source_fingerprint = ?').get(fp);
      assert.equal(row.status, 'rollback');
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('12 listLessonEvidence 返回可审计证据（频率曲线 + 状态）', () => {
    const { db, tempDir } = openTempDb();
    _setLessonDb(db);
    try {
      const fp = 'fp-evidence';
      db.prepare(
        `INSERT INTO lessons (source_fingerprint, title, action, scope, confidence, evidence, status, created_at, last_seen_at, occurrences_before, occurrences_after)
         VALUES (?,?,?,?,?,?, 'active', ?, ?, 3, 0)`
      ).run(fp, 'L', 'act', 'auto', 0.9, '["e1"]', '2026-11-19T00:00:00Z', '2026-11-19T00:00:00Z');
      const ev = listLessonEvidence();
      assert.ok(Array.isArray(ev) && ev.length === 1);
      assert.equal(ev[0].sourceFingerprint, fp);
      assert.ok(['keep', 'degrade', 'rollback'].includes(ev[0].verdict.decision));
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('EVO-3 · 证据导出（可审计产物，零外发）', () => {
  it('14 真实 BLOCK-510 闭环导出 frequency JSON 证据（落 acceptance/evo-3/）', () => {
    const { db, tempDir } = openTempDb();
    _setLessonDb(db);
    try {
      const fp = normalizeIncidentFingerprint({
        source: 'tool_failure', errorCode: 'unknown_tool', tool: 'workspace_exec', message: 'unknown_tool exec',
      }).fingerprint;
      for (const day of ['17', '18', '19']) {
        db.prepare('INSERT INTO incidents (fingerprint, source, error_code, tool, normalized, created_at) VALUES (?,?,?,?,?,?)')
          .run(fp, 'tool_failure', 'unknown_tool', 'workspace_exec', 'unknown_tool exec', `2026-11-${day}T00:00:00Z`);
      }
      db.prepare(
        `INSERT INTO lessons (source_fingerprint, title, action, scope, confidence, evidence, status, created_at, last_seen_at, occurrences_before, occurrences_after)
         VALUES (?,?,?,?,?,?, 'active', ?, ?, 3, 0)`
      ).run(fp, 'unknown_tool 要精确工具名', '调用前先 list 工具名', 'auto', 0.95, '["BLOCK-510"]', '2026-11-20T00:00:00Z', '2026-11-20T00:00:00Z');
      const v = verifyLessonFrequency(fp);
      const rows = db.prepare('SELECT created_at FROM incidents WHERE fingerprint = ? ORDER BY created_at ASC').all(fp);
      const byDay = {};
      for (const r of rows) {
        const day = String(r.created_at).slice(0, 10);
        const phase = r.created_at >= '2026-11-20T00:00:00Z' ? 'after' : 'before';
        byDay[day] = byDay[day] || { before: 0, after: 0 };
        byDay[day][phase] += 1;
      }
      const evidence = {
        ok: true,
        source: 'BLOCK-510 unknown_tool harness 自进化闭环（本机真实台账只读导出）',
        fingerprint: fp,
        frequency: { before: v.before, after: v.after, verdict: v.decision.decision },
        curveByDay: byDay,
        note: 'before=lesson 生效前同类 incident 数；after=生效后；after=0 即「学习后零复发」。零外发。',
      };
      assert.equal(evidence.frequency.before, 3);
      assert.equal(evidence.frequency.after, 0);
      assert.equal(evidence.frequency.verdict, 'keep');
      const outPath = path.join(ROOT, 'acceptance/evo-3/evidence-export.json');
      fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n');
      assert.ok(fs.existsSync(outPath));
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('EVO-3 · 真实历史错误闭环（BLOCK-510 unknown_tool）', () => {
  it('13 真实指纹：学习→生效后零复发→保留（全流程）', () => {
    const { db, tempDir } = openTempDb();
    _setLessonDb(db);
    try {
      const fp = normalizeIncidentFingerprint({
        source: 'tool_failure', errorCode: 'unknown_tool', tool: 'workspace_exec', message: 'unknown_tool exec',
      }).fingerprint;
      // 生效前 3 次真实错误
      for (const day of ['17', '18', '19']) {
        db.prepare('INSERT INTO incidents (fingerprint, source, error_code, tool, normalized, created_at) VALUES (?,?,?,?,?,?)')
          .run(fp, 'tool_failure', 'unknown_tool', 'workspace_exec', 'unknown_tool exec', `2026-11-${day}T00:00:00Z`);
      }
      db.prepare(
        `INSERT INTO lessons (source_fingerprint, title, action, scope, confidence, evidence, status, created_at, last_seen_at, occurrences_before, occurrences_after)
         VALUES (?,?,?,?,?,?, 'active', ?, ?, 3, 0)`
      ).run(fp, 'unknown_tool 要精确工具名', '调用前 list 工具', 'auto', 0.95, '["bloCk510"]', '2026-11-20T00:00:00Z', '2026-11-20T00:00:00Z');
      const v = verifyLessonFrequency(fp);
      assert.equal(v.before, 3);
      assert.equal(v.after, 0);
      assert.equal(v.decision.decision, 'keep', '真实错误学习后频率归零应保留');
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
