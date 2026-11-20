/**
 * EVO-2 HK-01 — Distill 聚类 + lesson 生成 + 分级写入决策 + prompt 注入段的可执行合同。
 * 红（当前）：lesson-distiller / lesson-store / lesson-render 模块缺席 → require 失败。
 * 绿（实现后）：合成多次失败→1 条可执行 lesson；红线内资产写入被拒；prompt 段有界；upsert 累加。
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
  LESSON_LIMITS, clusterIncidents, buildLesson, distillLessons,
} = req(path.resolve(ROOT, 'core/shared-backend/lesson-distiller.js'));
const {
  applyLessonDecision, upsertLesson, listActiveLessons, lessonStoreStats,
  _setLessonDb, _resetLessonStats,
} = req(path.resolve(ROOT, 'core/petri-server/helpers/lesson-store.js'));
const {
  renderSelfEvolutionForPrompt,
} = req(path.resolve(ROOT, 'core/petri-server/helpers/lesson-render.js'));

function incident(source, errorCode, message, conv, at) {
  return { source, error_code: errorCode, normalized: message, conversation_id: conv, created_at: at };
}

describe('EVO-2 · Distill 聚类 + lesson 生成（零模型纯函数）', () => {
  it('① 同 fingerprint 多次失败聚成 1 簇，频次/趋势/影响会话数正确', () => {
    const rows = [
      incident('tool_failure', 'unknown_tool', 'unknown_tool exec', 'conv_a', '2026-11-18T10:00:00Z'),
      incident('tool_failure', 'unknown_tool', 'unknown_tool exec', 'conv_b', '2026-11-19T10:00:00Z'),
      incident('tool_failure', 'unknown_tool', 'unknown_tool exec', 'conv_b', '2026-11-20T10:00:00Z'),
    ];
    // 聚类键由 incident-fingerprint 的 fingerprint 给出；注入一个稳定 fake fingerprint 便于断言
    const withFp = rows.map((r, i) => ({ ...r, fingerprint: 'fp-' + (i === 0 ? 'x' : 'x') }));
    const clusters = clusterIncidents(withFp);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].occurrences, 3);
    assert.equal(clusters[0].affectedConversations, 2);
    assert.ok(['up', 'flat', 'down'].includes(clusters[0].trend));
  });

  it('② 不同 fingerprint 分成不同簇', () => {
    const rows = [
      { ...incident('fatal', 'agent_run_failed', 'boom', 'c1', '2026-11-20T00:00:00Z'), fingerprint: 'fp-a' },
      { ...incident('tool_failure', 'unknown_tool', 'bad tool', 'c1', '2026-11-20T01:00:00Z'), fingerprint: 'fp-b' },
    ];
    assert.equal(clusterIncidents(rows).length, 2);
  });

  it('③ buildLesson 产出可执行 lesson（title/action/scope/confidence/evidence 齐全）', () => {
    const cluster = {
      fingerprint: 'fp-x', source: 'tool_failure', errorCode: 'unknown_tool',
      occurrences: 5, affectedConversations: 3, trend: 'up', firstSeen: 't1', lastSeen: 't5',
      samples: [{ normalized: 'unknown_tool exec', conversation_id: 'c1', created_at: 't1' }],
    };
    const lesson = buildLesson(cluster);
    assert.equal(lesson.sourceFingerprint, 'fp-x');
    assert.ok(lesson.title && lesson.action && lesson.scope);
    assert.ok(lesson.confidence >= 0 && lesson.confidence <= 1);
    assert.ok(Array.isArray(lesson.evidence) && lesson.evidence.length >= 1, '证据指针至少一条');
    assert.ok(['auto', 'ack', 'draft'].includes(lesson.scope));
  });

  it('④ 低置信 lesson 标 needs_human，不自动执行', () => {
    const cluster = {
      fingerprint: 'fp-low', source: 'fatal', errorCode: 'agent_run_failed',
      occurrences: 1, affectedConversations: 1, trend: 'flat',
      firstSeen: 't1', lastSeen: 't1', samples: [{ normalized: 'rare', created_at: 't1' }],
    };
    const lesson = buildLesson(cluster);
    assert.equal(lesson.status, 'needs_human');
    assert.ok(lesson.confidence < LESSON_LIMITS.autoConfidenceThreshold);
  });

  it('⑤ distillLessons 从全是低量的样本产出零自动 lesson（防凭空生成）', () => {
    const rows = [
      { ...incident('fatal', 'agent_run_failed', 'one-off', 'c1', 't1'), fingerprint: 'fp-1' },
    ];
    const lessons = distillLessons(rows);
    assert.ok(lessons.every((l) => l.status === 'needs_human'), '单次失败不得自动执行');
  });
});

describe('EVO-2 · 分级写入决策（红线 fail-closed）', () => {
  it('6 低风险 LEARNINGS.md → auto 放行', () => {
    const d = applyLessonDecision({ sourceFingerprint: 'fp-x', scope: 'auto' }, '.petri/LEARNINGS.md');
    assert.equal(d.action, 'auto');
    assert.equal(d.allowed, true);
  });

  it('7 中风险策略文件 → ack 待裁决', () => {
    const d = applyLessonDecision({ sourceFingerprint: 'fp-x', scope: 'ack' }, 'tool-approval-policy.json');
    assert.equal(d.action, 'ack');
    assert.equal(d.allowed, true);
  });

  it('8 高风险 installed skill → draft 只出草案', () => {
    const d = applyLessonDecision({ sourceFingerprint: 'fp-x', scope: 'draft' }, '.petri/installed-skills/foo/SKILL.md');
    assert.equal(d.action, 'draft');
  });

  it('9 红线内资产（harness 源码/注册表）一律 rejected，即使 lesson.scope=auto', () => {
    const forbidden = [
      'core/petri-server/agent-runner.js',
      'core/petri-server/agent-tools/registry.js',
      'core/shared-backend/loop-orchestrator.js',
      'resources/skills/paper-writing/SKILL.md',
      '.env',
    ];
    for (const t of forbidden) {
      const d = applyLessonDecision({ sourceFingerprint: 'fp-x', scope: 'auto' }, t);
      assert.equal(d.action, 'rejected', `${t} 应被拒`);
      assert.equal(d.allowed, false);
      assert.match(d.reason, /forbidden|not_in_allowlist/);
    }
  });

  it('10 lesson.scope 与目标白名单 tier 不一致时以红线 tier 为准（拒绝优先）', () => {
    // lesson 声称 auto，但目标是 ack 档策略文件 → 实际只能 ack，不得越权自动写
    const d = applyLessonDecision({ sourceFingerprint: 'fp-x', scope: 'auto' }, 'agent-rules.json');
    assert.equal(d.action, 'ack');
    assert.equal(d.effectiveTier, 'ack');
  });
});

describe('EVO-2 · selfEvolution prompt 注入段', () => {
  it('11 空 lessons → 零注入', () => {
    assert.equal(renderSelfEvolutionForPrompt([]), '');
  });

  it('12 lesson 渲染成有界 prompt 段（含行为指令 + 证据）', () => {
    const block = renderSelfEvolutionForPrompt([
      { title: '工具名要精确', action: '调用前先 list 工具', scope: 'auto', confidence: 0.9,
        evidence: ['fingerprint=abc'] },
    ]);
    assert.match(block, /selfEvolution|自进化|经验/);
    assert.match(block, /工具名要精确/);
    assert.ok(block.length <= LESSON_LIMITS.maxPromptChars);
  });

  it('13 超量 lessons 截断到条数上限', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      title: 'L' + i, action: 'act', scope: 'auto', confidence: 0.9, evidence: ['e'],
    }));
    const block = renderSelfEvolutionForPrompt(many);
    const count = (block.match(/^\n- /gm) || []).length;
    assert.ok(count <= LESSON_LIMITS.maxPromptEntries, `条数 ${count} 应 ≤ ${LESSON_LIMITS.maxPromptEntries}`);
  });

  it('14 system-prompt 有 selfEvolution 预算键 + add 调用（源级断言）', () => {
    const s = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/system-prompt.js'), 'utf8');
    assert.match(s, /selfEvolution:/);
    assert.match(s, /renderSelfEvolutionForPrompt/);
    // 必须落在 body（动态段），不进 base/staticPrefix
    assert.match(s, /add\(clipSection\(renderSelfEvolutionForPrompt/);
  });

  it('15 migration 024 创建 lessons 表（源级断言）', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'src/migrations/024_lessons.sql'), 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS lessons/);
    assert.match(sql, /source_fingerprint\s+TEXT\s+NOT NULL/);
    assert.match(sql, /idx_lessons_fingerprint/);
  });
});

describe('EVO-2 · 端到端闭环（真实 SQLite：合成失败→lesson→upsert→读取→注入）', () => {
  function openTempDb() {
    const os = req('node:os');
    const Database = req(path.resolve(ROOT, 'core/petri-server/node_modules/better-sqlite3'));
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-evo2-db-'));
    const db = new Database(path.join(tempDir, 'petri.db'));
    const migrationsDir = path.join(ROOT, 'src/migrations');
    for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
      db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    }
    return { db, tempDir };
  }

  it('16 upsert 同 fingerprint 两次→一行（ON CONFLICT 更新不重复插）', () => {
    const { db, tempDir } = openTempDb();
    _setLessonDb(db);
    _resetLessonStats();
    try {
      const lesson = distillLessons([
        { ...incident('tool_failure', 'unknown_tool', 'unknown_tool exec', 'c1', '2026-11-20T00:00:00Z'), fingerprint: 'fp-e2e' },
        { ...incident('tool_failure', 'unknown_tool', 'unknown_tool exec', 'c2', '2026-11-20T01:00:00Z'), fingerprint: 'fp-e2e' },
      ])[0];
      const r1 = upsertLesson(lesson);
      const r2 = upsertLesson({ ...lesson, confidence: 0.95, status: 'active' });
      assert.equal(r1.ok, true);
      assert.equal(r2.ok, true);
      assert.equal(r1.id, r2.id, '同 fingerprint 应同一行');
      const count = db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE source_fingerprint = ?').get('fp-e2e').n;
      assert.equal(count, 1);
      const row = db.prepare('SELECT confidence, status FROM lessons WHERE source_fingerprint = ?').get('fp-e2e');
      assert.equal(row.confidence, 0.95);
      assert.equal(row.status, 'active');
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('17 完整链路：合成多次失败→lesson→落库→读出 active→注入 prompt 段', () => {
    const { db, tempDir } = openTempDb();
    _setLessonDb(db);
    try {
      const fp = 'fp-tool-unknown';
      const rows = Array.from({ length: 4 }, (_, i) => ({
        ...incident('tool_failure', 'unknown_tool', 'unknown_tool exec', 'conv_' + i, '2026-11-20T0' + i + ':00:00Z'),
        fingerprint: fp,
      }));
      const lessons = distillLessons(rows);
      assert.equal(lessons.length, 1);
      const auto = lessons[0];
      assert.equal(auto.status, 'active', '多次同类失败应可自动执行');
      upsertLesson(auto);
      const active = listActiveLessons(8);
      assert.ok(active.some((l) => l.sourceFingerprint === fp));
      const block = renderSelfEvolutionForPrompt(active);
      assert.match(block, /工具名要精确|工具前核对/);
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('18 写入失败 fail-soft：upsert 抛错不阻断、计数可观测', () => {
    _setLessonDb({ prepare() { throw new Error('simulated db down'); } });
    _resetLessonStats();
    const lesson = buildLesson({ fingerprint: 'fp-x', source: 'fatal', occurrences: 3, affectedConversations: 2, trend: 'up', samples: [] });
    assert.doesNotThrow(() => upsertLesson(lesson));
    assert.equal(lessonStoreStats().failures, 1);
  });
});
