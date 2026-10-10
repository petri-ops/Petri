/**
 * BLOCK-110 P2 — 知识库 Jev 二跳契约（默认关 + fail-open + 注入拦截 + 相关性过滤）。
 *
 * D-A 裁决：检索内容出站默认关闭（PETRI_JEV_KNOWLEDGE_GUARD 未设=透传零变化），
 * =1 显式开启后：is_relevant noul < 0.5 丢弃；has_injection noul ≥ 0.70 丢弃并标注；
 * Jev 失败 fail-open 保留该条（诚实降级：Jev 失败不得移除内容）。
 * VECTOR_THRESHOLD=0.55 第一道硬阈值保留不动。
 */
import assert from 'node:assert/strict';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// 内存 DB 自举（migration 009 建 knowledge_* 表）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-b110-p2-'));
  const db = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.join(root, 'src', 'migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* 句柄延迟释放 */ }
  });
}

const DECISION_PATH = require.resolve(path.join(root, 'core', 'petri-server', 'helpers', 'decision-api.js'));
const KNOWLEDGE_PATH = path.join(root, 'core', 'petri-server', 'helpers', 'knowledge-space.js');
const ks = require(KNOWLEDGE_PATH);

// 种子：默认空间（启用）+ 1 文档 + 3 块。chunk-c 向量 [0.8,0.6,0] 与查询 [1,0,0] 的
// sim≈0.8 ≥ 0.55 过硬阈值——但语义无关（红烧肉）→ 正是二跳相关性过滤的目标场景。幂等。
function seedKnowledge() {
  const Database = require('better-sqlite3');
  const db = new Database(process.env.PETRI_DB_PATH);
  db.prepare(`INSERT OR REPLACE INTO knowledge_spaces (id, name, enabled, embedding_model, created_at, updated_at)
    VALUES ('ks_default', 'P2 测试空间', 1, 'text-embedding-v3', datetime('now'), datetime('now'))`).run();
  db.prepare(`INSERT OR REPLACE INTO knowledge_documents (id, space_id, name, kind, status, chunk_count, created_at, updated_at)
    VALUES ('doc-p2', 'ks_default', 'P2 测试文档', 'text', 'ready', 3, datetime('now'), datetime('now'))`).run();
  const vec = (a) => Buffer.from(new Float32Array(a).buffer);
  const chunks = [
    ['chunk-a', 0, '片段 A：React useEffect 依赖数组说明', [1, 0, 0]],
    ['chunk-b', 1, '片段 B：useMemo 性能优化实践', [0.9, 0.1, 0]],
    ['chunk-c', 2, '片段 C：红烧肉的做法与火候', [0.8, 0.6, 0]],
  ];
  for (const [id, seq, text, v] of chunks) {
    db.prepare(`INSERT OR REPLACE INTO knowledge_chunks (id, doc_id, space_id, seq, text, embedding, dim, model, created_at)
      VALUES (?, 'doc-p2', 'ks_default', ?, ?, ?, 3, 'text-embedding-v3', datetime('now'))`)
      .run(id, seq, text, vec(v));
  }
  db.close();
}

const EMBED_QUERY = async () => [[1, 0, 0]];

function installDecisionMock(impl) {
  const dec = require(DECISION_PATH);
  require.cache[DECISION_PATH] = {
    id: DECISION_PATH, filename: DECISION_PATH, loaded: true,
    exports: { ...dec, askDecision: async (p) => (impl ? impl(p) : dec.askDecision(p)) },
  };
}

const mocks2 = { calls: [] };

test.beforeEach(() => {
  delete process.env.PETRI_JEV_KNOWLEDGE_GUARD;
  mocks2.calls.length = 0;
  installDecisionMock((p) => {
    mocks2.calls.push(p);
    const state = p.state || '';
    // 片段 A（React）→ 相关 0.9 无注入 0.1；片段 B（useMemo）→ 相关 0.9；片段 C（红烧肉）→ 无关 0.05
    const relevant = state.includes('片段 A') ? 0.9 : state.includes('片段 B') ? 0.9 : 0.05;
    const injection = state.includes('INJECT') ? 0.95 : 0.05;
    return Promise.resolve({
      ok: true,
      answers: {
        is_relevant: { type: 'noul', noul: relevant },
        has_injection: { type: 'noul', noul: injection },
      },
    });
  });
});

test('P2 — 默认关闭：未设开关时检索透传，Jev 零调用（D-A）', async () => {
  seedKnowledge();
  const r = await ks.searchKnowledge({ query: 'React 依赖数组', embed: EMBED_QUERY });
  assert.equal(mocks2.calls.length, 0, '默认关闭零 Jev 调用');
  assert.ok(r.hits.length >= 1, '硬阈值通道照常出命中');
  assert.equal(r.jevGuard, undefined, '无 jevGuard 标注');
});

test('P2 — 显式开启 + 相关性过滤：无关候选丢弃、相关保留、jevGuard 标注', async () => {
  seedKnowledge();
  process.env.PETRI_JEV_KNOWLEDGE_GUARD = '1';
  const r = await ks.searchKnowledge({ query: 'React 依赖数组', embed: EMBED_QUERY });
  assert.ok(r.jevGuard && r.jevGuard.enabled === true, 'jevGuard 在位');
  assert.ok(r.hits.length >= 1 && r.hits.length <= 3);
  const texts = r.hits.map((h) => h.text);
  assert.ok(!texts.some((t) => t.includes('红烧肉')), '无关片段（红烧肉）被二跳过滤');
  assert.ok(r.jevGuard.dropped.some((d) => d.why === 'irrelevant'), 'irrelevant 丢弃入档');
});

test('P2 — 注入拦截：含注入指令的候选被丢弃并标注（阈值 0.70）', async () => {
  seedKnowledge();
  process.env.PETRI_JEV_KNOWLEDGE_GUARD = '1';
  installDecisionMock((p) => {
    const state = p.state || '';
    const isA = state.includes('片段 A');
    return Promise.resolve({
      ok: true,
      answers: {
        is_relevant: { type: 'noul', noul: 0.9 },
        has_injection: { type: 'noul', noul: isA ? 0.05 : 0.95 },
      },
    });
  });
  const r = await ks.searchKnowledge({ query: 'React 依赖数组', embed: EMBED_QUERY });
  assert.ok(r.jevGuard.dropped.some((d) => d.why === 'injection'), '注入候选丢弃入档');
  assert.ok(r.jevGuard.injectionSuspects.length >= 1, '注入嫌疑标注在位');
  assert.ok(r.hits.every((h) => !h.text.includes('片段 B')), '注入片段不入最终命中');
});

test('P2 — fail-open：Jev 整体失败 → 原始命中透传（诚实降级不移除内容）', async () => {
  seedKnowledge();
  process.env.PETRI_JEV_KNOWLEDGE_GUARD = '1';
  installDecisionMock(() => Promise.resolve({ ok: false, reason: 'timeout' }));
  const r = await ks.searchKnowledge({ query: 'React 依赖数组', embed: EMBED_QUERY });
  assert.ok(r.hits.length >= 1, 'Jev 失败不移除内容（fail-open）');
  assert.ok(!r.jevGuard || !r.jevGuard.error, '降级不产生错误标注');
});

test('P2 — 缺 key → no_key 降级透传（无 key 诚实家法）', async () => {
  seedKnowledge();
  process.env.PETRI_JEV_KNOWLEDGE_GUARD = '1';
  delete process.env.TYPESAFE_API_KEY;
  installDecisionMock(null);
  const r = await ks.searchKnowledge({ query: 'React 依赖数组', embed: EMBED_QUERY });
  assert.ok(r.hits.length >= 1, '缺 key 透传照常出命中');
});
