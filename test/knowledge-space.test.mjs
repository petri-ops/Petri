// BLOCK-69 P0 — 知识空间检索内核单测
// 跑法：node --test test/knowledge-space.test.mjs（必须 Node 24：core/biof3-server better-sqlite3 ABI 137）
// BIOF3_DB_PATH / BIOF3_LOCAL_DATA_DIR 必须在 require db.js 前生效。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'biof3-server');
const require = createRequire(import.meta.url);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-block69-'));
process.env.BIOF3_DB_PATH = path.join(tempRoot, 'biof3.db');
process.env.BIOF3_LOCAL_DATA_DIR = tempRoot;
process.on('exit', () => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
});

// migration-runner 无 BIOF3_BETTER_SQLITE3_ROOT 时在 require 期即 plain require 根
// node_modules 的 better-sqlite3（Electron ABI 145）；必须在 require 前指到 core 的 Node ABI 构建。
process.env.BIOF3_BETTER_SQLITE3_ROOT = R_SERVER;
const { runMigrations } = require('../src/migration-runner.js');
const migrationsDir = resolve(__dirname, '..', 'src', 'migrations');

// 自举即按生产路径跑全量迁移（migration-runner + schema_migrations 追踪），
// 之后 db.js 在 require 期才能安全 prepare projects 等表。
const bootVersion = await runMigrations(process.env.BIOF3_DB_PATH, migrationsDir);

test('migration 009 已应用且重放为 no-op：三表 + FTS 虚表 + 默认空间种子行', async () => {
  assert.ok(bootVersion >= 9, `bootstrap applied migrations, latest >= 9, got ${bootVersion}`);
  // 重放：schema_migrations 已记录 → 幂等 no-op（不重复 ALTER/INSERT）
  const replay = await runMigrations(process.env.BIOF3_DB_PATH, migrationsDir);
  assert.equal(replay, bootVersion);
  const ksFresh = require('../core/biof3-server/helpers/knowledge-space.js');
  const space = ksFresh.getSpace();
  assert.ok(space, 'default space row seeded');
  assert.equal(space.id, 'ks_default');
  assert.equal(space.enabled, 0);
  assert.equal(ksFresh.listDocuments().length, 0);
});

const ks = require('../core/biof3-server/helpers/knowledge-space.js');
const sqlite = require('../core/biof3-server/db.js').getDatabase();

// ---------- D3 chunker ----------

test('chunkText: 标题边界成块、段落不跨标题合并', () => {
  const text = [
    '# 基因背景',
    'TP53 是重要的抑癌基因，参与细胞凋亡调控。',
    '',
    'BRCA1 与同源重组修复相关。',
    '',
    '## 数据来源',
    '本节描述 TCGA 队列的样本处理流程。',
  ].join('\n');
  const chunks = ks.chunkText(text);
  assert.equal(chunks.length, 2, `short doc packs per-section, got ${chunks.length}`);
  assert.ok(chunks[0].text.startsWith('# 基因背景'), 'first chunk opens with its heading');
  assert.ok(chunks[1].text.startsWith('## 数据来源'), 'heading never merged into previous section');
  assert.ok(chunks[0].text.includes('BRCA1'), 'paragraphs stay under own heading');
  assert.equal(chunks[0].seq, 0);
});

test('chunkText: 超限长文按句切 + 重叠 + 不丢内容', () => {
  const sentence = '这是一个用于测试超长段落切分行为的句子，包含基因名 TP53 与 BRCA2。';
  const longPara = Array.from({ length: 200 }, () => sentence).join('');
  const chunks = ks.chunkText(longPara);
  assert.ok(chunks.length >= 3, `expect multiple chunks, got ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(
      chunk.text.length <= ks.CHUNK_MAX_CHARS + ks.CHUNK_OVERLAP_CHARS,
      `chunk too long: ${chunk.text.length}`
    );
  }
  // 无内容丢失：首块头部与末块尾部仍在
  assert.ok(chunks[0].text.startsWith(sentence.slice(0, 10)));
  const lastChunk = chunks[chunks.length - 1].text;
  assert.ok(lastChunk.includes('BRCA2'), 'tail content preserved');
});

test('chunkText: 碎块合并 + 空文本返回空数组', () => {
  assert.deepEqual(ks.chunkText(''), []);
  assert.deepEqual(ks.chunkText('   \n  '), []);
  const tiny = ks.chunkText('短句一。\n\n短句二。');
  assert.equal(tiny.length, 1, 'tiny paragraphs pack into one chunk');
});

// ---------- FTS 通道 ----------

function insertReadyDoc(docId, name, chunks) {
  sqlite
    .prepare(
      `INSERT INTO knowledge_documents (id, space_id, name, kind, size, status, chunk_count, created_at, updated_at)
       VALUES (?, ?, ?, 'text', 100, 'ready', ?, datetime('now'), datetime('now'))`
    )
    .run(docId, ks.SPACE_ID, name, chunks.length);
  chunks.forEach(([seq, text, vec]) => {
    const chunkId = `${docId}_c${seq}`;
    sqlite
      .prepare(
        `INSERT INTO knowledge_chunks (id, doc_id, space_id, seq, text, embedding, dim, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      // BLOCK-94 F1 模型隔离：向量通道只认当前嵌入模型产出的 chunk，夹具同产线形状
      .run(chunkId, docId, ks.SPACE_ID, seq, text, vec || null, vec ? ks.EMBEDDING_DIM : null, vec ? ks.EMBEDDING_MODEL : null);
    sqlite.prepare('INSERT INTO knowledge_chunks_fts (chunk_id, text) VALUES (?, ?)').run(chunkId, text);
  });
}

const NO_VEC = () => [];

test('FTS 通道: ≥3 字中文/英文 token 命中；<3 字短词走 LIKE 兜底', () => {
  insertReadyDoc('doc_fts', '基因笔记', [
    [0, 'TP53 基因在细胞凋亡中发挥核心作用，p53 信号通路监控基因组完整性。'],
    [1, 'BRCA1 突变与同源重组修复缺陷相关，可增加乳腺癌发病风险。'],
  ]);
  const english = ks.ftsSearch('TP53', 5);
  assert.equal(english.length, 1);
  assert.equal(english[0].chunkId, 'doc_fts_c0');

  const chinese = ks.ftsSearch('细胞凋亡', 5);
  assert.equal(chinese.length, 1);

  // 2 字短词：trigram 无法索引 → LIKE 兜底仍命中（c0 含「基因」；c1 无）
  const short = ks.ftsSearch('基因', 5);
  assert.equal(short.length, 1, 'LIKE fallback hits only the chunk containing the token');
  assert.equal(short[0].chunkId, 'doc_fts_c0');

  assert.equal(ks.ftsSearch('不存在的词汇组', 5).length, 0);
});

// ---------- 向量通道 + RRF 融合 ----------

// LCG 伪随机 + 归一化：不同 seed 的向量在 1024 维下近似正交（cos ≈ 0），可控构造相关度
function normalizeVec(v) {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}
function makeVec(seed) {
  const v = new Float32Array(ks.EMBEDDING_DIM);
  let s = Math.floor(seed * 7919) % 2147483647 || 42;
  for (let i = 0; i < v.length; i++) {
    s = (s * 48271) % 2147483647;
    v[i] = (s / 2147483647) * 2 - 1;
  }
  return normalizeVec(v);
}
function blendVec(a, b, w) {
  const v = new Float32Array(ks.EMBEDDING_DIM);
  for (let i = 0; i < v.length; i++) v[i] = a[i] * w + b[i] * (1 - w);
  return normalizeVec(v);
}
function toBuf(v) {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

test('RRF 融合: 双通道命中排名优先于单通道；向量阈值 0.55 过滤', async () => {
  const qVec = makeVec(1);
  insertReadyDoc('doc_rrf', '融合笔记', [
    // 双通道命中（向量相同 sim=1.0 + 含关键词）
    [0, '转录组差异表达分析使用 DESeq2 进行，TP53 表达显著上调。', toBuf(qVec)],
    // 仅向量相近（语义近似，无关键词）
    [1, 'RNA-seq 的 groups comparison 由该工具完成，p 值校正后报表。', toBuf(blendVec(qVec, makeVec(5), 0.9))],
    // 仅 FTS 命中（关键词精确，向量正交 → 阈值过滤）
    [2, 'TP53 突变谱汇总表格，含 VAF 分布。', toBuf(makeVec(99))],
    // 两通道都不命中
    [3, '完全无关的段落，讨论烹饪方法与食材搭配。', toBuf(makeVec(123))],
  ]);

  const result = await ks.searchKnowledge({ query: 'TP53 表达', embed: async () => [qVec] });
  assert.equal(result.spaceEnabled, false, 'space not enabled yet — search still works (工具层语义)');
  assert.equal(result.readyChunks, 6, 'ready chunks across docs');
  assert.ok(result.hits.length >= 2, 'fused hits returned');
  const top = result.hits[0];
  assert.equal(top.chunkId, 'doc_rrf_c0', 'dual-channel hit ranks first');
  assert.ok(top.channels.vector != null && top.channels.fts != null, 'top hit has both channels');
  assert.ok(top.score > 0);
  // 弱向量（makeVec(1.0001) 与 qVec 夹角极小）必过阈值；无关向量必不过
  const ids = result.hits.map((h) => h.chunkId);
  assert.ok(!ids.includes('doc_rrf_c3'), 'irrelevant chunk filtered by vector threshold');
  assert.ok(ids.includes('doc_rrf_c2'), 'FTS-only hit survives fusion (keyword precision channel)');
});

test('searchKnowledge: 空查询/无 ready chunk 诚实空返回', async () => {
  const empty = await ks.searchKnowledge({ query: '  ', embed: NO_VEC });
  assert.deepEqual(empty.hits, []);
  const none = await ks.searchKnowledge({ query: '完全不匹配的长查询词组', embed: async () => [makeVec(777)] });
  assert.deepEqual(none.hits, [], 'no channel hits → empty');
  const embedFail = await ks.searchKnowledge({ query: '细胞凋亡', embed: async () => { throw new Error('no key'); } });
  assert.equal(embedFail.embeddingAvailable, false, 'embed failure honest');
});

// ---------- 注入块 ----------

test('buildPromptBlock: 命中渲染、无命中空串、预算截断', async () => {
  const result = await ks.searchKnowledge({ query: 'TP53 表达', embed: async () => [makeVec(1)] });
  const { block } = ks.buildPromptBlock(result.hits);
  assert.ok(block.includes('知识空间检索结果'));
  assert.ok(block.includes('《融合笔记》'));
  assert.ok(block.includes('knowledge_search'));
  const empty = ks.buildPromptBlock([]);
  assert.equal(empty.block, '');

  const tiny = ks.buildPromptBlock(result.hits, 10);
  assert.equal(tiny.block, '', 'budget smaller than first head → empty block');
});

// ---------- D10 删除语义 ----------

test('deleteDocument: 单事务清除 chunks+FTS+doc 行，两通道同灭；原始目录移除', async () => {
  const docDir = ks.docDir('doc_rrf');
  fs.mkdirSync(docDir, { recursive: true });
  fs.writeFileSync(path.join(docDir, 'source.txt'), 'raw payload');

  const out = ks.deleteDocument('doc_rrf');
  assert.equal(out.deleted, 'doc_rrf');

  assert.equal(ks.getDocument('doc_rrf'), null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM knowledge_chunks WHERE doc_id=?').get('doc_rrf').c, 0);
  // 断言用等值 IN 形状：trigram FTS5 对 UNINDEXED 列的 LIKE 谓词被优化劫持恒返回空（不可用作删除/计数）
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) c FROM knowledge_chunks_fts WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE doc_id = ?)')
      .get('doc_rrf').c,
    0,
    'FTS rows gone'
  );
  assert.ok(!fs.existsSync(docDir), 'raw dir removed');

  const after = await ks.searchKnowledge({ query: 'TP53 表达', embed: async () => [makeVec(1)] });
  assert.equal(after.readyChunks, 2, 'only doc_fts remains');
  assert.ok(!after.hits.some((h) => h.docId === 'doc_rrf'), 'deleted doc unreachable via both channels');
});

test('deleteDocument: 不存在的文档 fail-closed', () => {
  assert.throws(() => ks.deleteDocument('doc_missing'), /knowledge_document_not_found/);
});

// ---------- 空间开关 ----------

test('setSpaceEnabled: 开关读写单一真相在 DB', () => {
  ks.setSpaceEnabled(true);
  assert.equal(ks.getSpace().enabled, 1);
  ks.setSpaceEnabled(false);
  assert.equal(ks.getSpace().enabled, 0);
});

test('clearSpace: 全清文档+分块+FTS，空间行保留', async () => {
  insertReadyDoc('doc_clear', '待清文档', [[0, '清空测试内容段落。']]);
  const out = ks.clearSpace();
  assert.equal(out.cleared, 2); // doc_fts + doc_clear
  assert.equal(ks.listDocuments().length, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM knowledge_chunks').get().c, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM knowledge_chunks_fts').get().c, 0);
  assert.ok(ks.getSpace(), 'space row survives clear');
});

// ---------- P1：agent 工具面 ----------

const { getToolContract } = require('../core/biof3-server/agent-tools/registry.js');
const { decideAgentToolCall } = require('../core/biof3-server/agent-tools/agent-tool-policy.js');
const { tool_knowledge_search, tool_knowledge_status } = require('../core/biof3-server/agent-tools/knowledge-tools.js');

test('knowledge 工具契约：retrieval/none/R0，只读面全档位可用', () => {
  const search = getToolContract('knowledge_search');
  const status = getToolContract('knowledge_status');
  assert.ok(search && status, 'contracts registered');
  assert.equal(search.category, 'retrieval');
  assert.equal(search.sideEffect, 'none');
  assert.equal(search.riskTier, 'R0');
  assert.equal(status.sideEffect, 'none');
  // 只读：plan 模式不收编
  for (const [name, args] of [['knowledge_search', { query: 'x' }], ['knowledge_status', {}]]) {
    const d = decideAgentToolCall({ name, args, ctx: { planMode: true, accessMode: 'read' }, contract: getToolContract(name) });
    assert.equal(d.decision, 'allow', `${name} should be allowed in plan/read mode`);
  }
});

test('knowledge_search 工具：无嵌入 key 时 FTS 通道仍可用（诚实标注）', async () => {
  insertReadyDoc('doc_tool', '工具面笔记', [
    [0, '单细胞转录组的质控标准包括线粒体基因比例过滤。'],
  ]);
  ks.setSpaceEnabled(true);
  const result = await tool_knowledge_search({ query: '线粒体基因' }, { userId: 'u_test' });
  assert.equal(result.spaceEnabled, true);
  assert.ok(Array.isArray(result.hits));
  assert.ok(result.hits.length >= 1, 'FTS channel hit without embedding key');
  assert.ok(result.hits[0].text.includes('线粒体基因'));

  const empty = await tool_knowledge_search({ query: '' }, { userId: 'u_test' });
  assert.equal(empty.error, 'query_required');

  const miss = await tool_knowledge_search({ query: '完全不相关词组查询' }, { userId: 'u_test' });
  assert.deepEqual(miss.hits, []);

  // plan §6 验收语义：开关关闭 = 工具层同样不可见（不返回任何命中）
  ks.setSpaceEnabled(false);
  const disabled = await tool_knowledge_search({ query: '线粒体基因' }, { userId: 'u_test' });
  assert.equal(disabled.spaceEnabled, false);
  assert.deepEqual(disabled.hits, [], 'disabled space → tool returns no hits');
  assert.ok(/未启用/.test(disabled.message));
});

test('knowledge_status 工具：状态投影', () => {
  const status = tool_knowledge_status();
  assert.equal(status.spaceEnabled, false);
  assert.ok(status.documentCount >= 1);
  assert.ok(Array.isArray(status.documents));
});

// ---------- P1：摄取管道 ----------

const ingest = require('../core/biof3-server/helpers/knowledge-ingest.js');

test('摄取管道: uploaded→parsing→chunking→embedding→ready，分块+FTS+向量落库', async () => {
  const content = [
    '# BRCA2 背景笔记',
    'BRCA2 参与同源重组修复，胚系突变显著提高胰腺癌风险。',
    '',
    '# 队列说明',
    '本笔记整理 TCGA 与 ICGC 队列的 BRCA2 携带者临床特征。',
  ].join('\n');
  const doc = await ingest.createDocument({
    name: 'brca2-notes.md',
    buffer: Buffer.from(content, 'utf8'),
    mime: 'text/markdown',
    autoIngest: false,
  });
  assert.equal(doc.status, 'uploaded');
  assert.ok(fs.existsSync(doc.raw_path), 'raw file persisted under knowledge root');

  const fakeEmbed = async (texts) => texts.map((t) => blendVec(makeVec(9), makeVec(t.length), 0.98));
  const done = await ingest.ingestDocument(doc.id, { embed: fakeEmbed });
  assert.equal(done.status, 'ready');
  assert.equal(done.chunk_count, 2, 'two heading sections → two chunks');
  assert.equal(done.error, null);

  // 双通道可达：FTS 命中 + 向量命中（查询向量接近 chunk0）
  const queryVec = fakeEmbed(['BRCA2 参与同源重组修复'])[0];
  const r = await ks.searchKnowledge({ query: 'BRCA2 胰腺癌', embed: async () => [queryVec] });
  const hit = r.hits.find((h) => h.docId === doc.id);
  assert.ok(hit, 'ingested doc searchable');
  assert.ok(hit.channels.vector != null || hit.channels.fts != null, 'at least one channel hit');
  assert.equal(ks.getDocument(doc.id).status, 'ready');
});

test('摄取管道: 不支持的扩展名 fail-closed（不建行），解析失败转 failed', async () => {
  await assert.rejects(
    ingest.createDocument({ name: 'archive.exe', buffer: Buffer.from('x'), autoIngest: false }),
    /knowledge_parser_unsupported/
  );
  await assert.rejects(
    ingest.createDocument({ name: 'photo.png', buffer: Buffer.from('x'), autoIngest: false }),
    /knowledge_parser_planned_not_implemented/
  );

  // 空文件：解析成功但无有效文本 → failed（不落空块）
  const doc = await ingest.createDocument({
    name: 'empty.txt',
    buffer: Buffer.from('   ', 'utf8'),
    autoIngest: false,
  });
  const failed = await ingest.ingestDocument(doc.id, { embed: async (t) => t.map(() => makeVec(3)) });
  assert.equal(failed.status, 'failed');
  assert.ok(/empty/.test(failed.error), `error message recorded, got: ${failed.error}`);
  assert.equal(failed.chunk_count, 0, 'no half-indexed chunks');
});

test('摄取管道: 嵌入不可用时 failed 不静默（D7）', async () => {
  const doc = await ingest.createDocument({
    name: 'embed-fail.txt',
    buffer: Buffer.from('一些需要嵌入的文本内容，长度足够分块。', 'utf8'),
    autoIngest: false,
  });
  const failed = await ingest.ingestDocument(doc.id, { embed: async () => null });
  assert.equal(failed.status, 'failed');
  assert.ok(/embed/.test(failed.error), `honest embed error, got: ${failed.error}`);
});

test('reindexDocument: 清旧块重跑管道', async () => {
  const doc = await ingest.createDocument({
    name: 'reindex-me.txt',
    buffer: Buffer.from('第一版内容，只有一段。\n\n第二段讨论 TP3 与 BRCA1 互作。', 'utf8'),
    autoIngest: false,
  });
  await ingest.ingestDocument(doc.id, { embed: async (t) => t.map(() => makeVec(11)) });
  const before = sqlite.prepare('SELECT COUNT(*) c FROM knowledge_chunks WHERE doc_id=?').get(doc.id).c;
  assert.ok(before >= 1);

  await ingest.ingestDocument(doc.id, { embed: async (t) => t.map(() => makeVec(12)) });
  const after = sqlite.prepare('SELECT COUNT(*) c FROM knowledge_chunks WHERE doc_id=?').get(doc.id).c;
  assert.equal(after, before, 'reindex replaces chunks 1:1 (no duplication)');
  const fts = sqlite
    .prepare('SELECT COUNT(*) c FROM knowledge_chunks_fts WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE doc_id = ?)')
    .get(doc.id).c;
  assert.equal(fts, after, 'FTS rows match chunks after reindex');
});

// ---------- P2a：agent turn 注入（buildAgentTurnBlock 轻按需语义）----------

test('buildAgentTurnBlock: 空间关闭不注入；开启且有 ready 命中才注入', async () => {
  // 前置：上一测试留下 reindex-me.txt（ready）。开关当前为 false。
  ks.setSpaceEnabled(false);
  const off = await ks.buildAgentTurnBlock('TP3 与 BRCA1 互作');
  assert.equal(off.block, '', 'space disabled → no injection');
  assert.equal(off.hitCount, 0);

  ks.setSpaceEnabled(true);
  const on = await ks.buildAgentTurnBlock('TP3 与 BRCA1 互作');
  assert.ok(on.block.includes('知识空间检索结果'), 'enabled + hit → injection block');
  assert.ok(on.hitCount >= 1);
  assert.ok(on.usedChars > 0);

  // 无命中：启用也不注入任何内容（轻按需）
  const miss = await ks.buildAgentTurnBlock('完全不相关的查询词组组合');
  assert.equal(miss.block, '', 'enabled + no hit → no injection');
  ks.setSpaceEnabled(false);
});

// ---------- BLOCK-94 P1 可靠底盘：启动恢复 / 模型一致性 / 分页 / 挂点收敛 ----------

test('F1 启动恢复: 中间态文档重启后重排入队，最终全部落到终态（无永久卡死）', async () => {
  // 两份中间态夹具：一份原始文件在位（管道可走通），一份原始文件缺失（诚实 failed）
  const okDir = ks.docDir('doc_recover_ok');
  fs.mkdirSync(okDir, { recursive: true });
  fs.writeFileSync(path.join(okDir, 'recover.txt'), '重启恢复夹具：包含 TP53 与细胞凋亡关键词的长文本内容，确保能分出块。');
  const insertIntermediate = (docId, name, status, rawPath) => {
    sqlite
      .prepare(
        `INSERT INTO knowledge_documents (id, space_id, name, kind, size, status, raw_path, created_at, updated_at)
         VALUES (?, ?, ?, 'text', 100, ?, ?, datetime('now'), datetime('now'))`
      )
      .run(docId, ks.SPACE_ID, name, status, rawPath);
  };
  insertIntermediate('doc_recover_ok', 'recover.txt', 'parsing', path.join(okDir, 'recover.txt'));
  insertIntermediate('doc_recover_lost', 'lost.txt', 'embedding', path.join(okDir, 'gone.txt'));

  // embed 注入：契约测试不依赖网络（生产路径不传 → 真实嵌入）
  const fakeEmbed = async (texts) => texts.map((t) => blendVec(makeVec(9), makeVec(t.length), 0.98));
  const recovery = ingest.recoverInterruptedIngest({ embed: fakeEmbed });
  assert.equal(recovery.requeued, 2, 'both intermediate docs requeued');
  await recovery.settled;

  const afterOk = ks.getDocument('doc_recover_ok');
  const afterLost = ks.getDocument('doc_recover_lost');
  assert.equal(afterOk.status, 'ready', 'with-raw doc re-ingests to ready');
  assert.equal(afterLost.status, 'failed', 'missing-raw doc fails honestly');
  assert.equal(
    sqlite
      .prepare(
        `SELECT COUNT(*) c FROM knowledge_documents
         WHERE space_id = ? AND status IN ('uploaded','parsing','chunking','embedding')`
      )
      .get(ks.SPACE_ID).c,
    0,
    'no document left in intermediate state after boot recovery'
  );
  ks.deleteDocument('doc_recover_ok');
  ks.deleteDocument('doc_recover_lost');
});

test('F1 失败批量重试: failed 文档重排入队，原始文件缺失逐项诚实跳过', async () => {
  const doc = await ingest.createDocument({
    name: 'retry-me.txt',
    buffer: Buffer.from('需要批量重试的失败文档内容，讨论 BRCA1 与 TP53 互作机制。', 'utf8'),
    autoIngest: false,
  });
  await ingest.ingestDocument(doc.id, { embed: async () => null });
  assert.equal(ks.getDocument(doc.id).status, 'failed');

  const missingDir = ks.docDir('doc_retry_lost');
  fs.mkdirSync(missingDir, { recursive: true });
  sqlite
    .prepare(
      `INSERT INTO knowledge_documents (id, space_id, name, kind, size, status, raw_path, created_at, updated_at)
       VALUES (?, ?, ?, 'text', 100, 'failed', ?, datetime('now'), datetime('now'))`
    )
    .run('doc_retry_lost', ks.SPACE_ID, 'lost.txt', path.join(missingDir, 'gone.txt'));

  const fakeEmbed = async (texts) => texts.map(() => makeVec(13));
  const result = ingest.retryFailedDocuments({ embed: fakeEmbed });
  assert.ok(result.requeued >= 1, 'failed doc with raw file requeued');
  assert.ok(result.skipped.some((s) => s.id === 'doc_retry_lost'), 'missing-raw skip is honest and itemized');
  await result.settled;
  assert.equal(ks.getDocument(doc.id).status, 'ready', 'retried doc reaches ready with injected embed');
  ks.deleteDocument(doc.id);
  ks.deleteDocument('doc_retry_lost');
});

test('F1 嵌入模型一致性: 旧模型向量隔离出向量通道（FTS 仍可达），失配计数暴露', async () => {
  const qVec = makeVec(21);
  insertReadyDoc('doc_stale_model', '旧模型笔记', [
    [0, '免疫组化染色流程中 TP53 抗体孵育条件需要严格控制。', toBuf(qVec)],
  ]);
  // 夹具写入的是当前模型（insertReadyDoc 已对齐产线）——手动改成旧模型制造失配
  sqlite.prepare('UPDATE knowledge_chunks SET model = ? WHERE doc_id = ?').run('text-embedding-v1', 'doc_stale_model');

  const stats = ks.staleEmbeddingStats();
  assert.ok(stats.staleChunks >= 1, `stale chunks counted, got ${stats.staleChunks}`);
  assert.ok(stats.staleDocs >= 1, 'stale docs counted');

  // 同一查询向量、模型失配 → 向量通道必须放行该 chunk 为零命中；FTS 关键词通道仍可达
  const r = await ks.searchKnowledge({ query: '免疫组化 TP53 孵育', embed: async () => [qVec] });
  const staleHit = r.hits.find((h) => h.docId === 'doc_stale_model');
  if (staleHit) {
    assert.equal(staleHit.channels.vector, undefined, 'stale-model chunk must not enter vector channel');
    assert.ok(staleHit.channels.fts != null, 'FTS channel still reaches stale doc');
  }
  assert.ok(r.staleEmbedding && r.staleEmbedding.staleChunks >= 1, 'searchKnowledge base exposes stale stats');
  ks.deleteDocument('doc_stale_model');
});

test('F1 模型匹配: 当前模型向量照常进入向量通道（隔离不误伤）', async () => {
  const qVec = makeVec(31);
  insertReadyDoc('doc_fresh_model', '新模型笔记', [
    [0, '单细胞转录组聚类分析使用 Leiden 算法分辨细胞亚群。', toBuf(qVec)],
  ]);
  const r = await ks.searchKnowledge({ query: '单细胞 聚类', embed: async () => [qVec] });
  const hit = r.hits.find((h) => h.docId === 'doc_fresh_model');
  assert.ok(hit, 'fresh-model doc searchable');
  assert.ok(hit.channels.vector != null, 'current-model chunk enters vector channel');
  ks.deleteDocument('doc_fresh_model');
});

test('F1 分页: listDocumentsPage 返回 total/hasMore，参数钳制与越界诚实', async () => {
  const total = sqlite.prepare('SELECT COUNT(*) c FROM knowledge_documents WHERE space_id = ?').get(ks.SPACE_ID).c;
  assert.ok(total >= 1, 'docs exist from earlier tests');

  const page1 = ks.listDocumentsPage({ limit: 2, offset: 0 });
  assert.equal(page1.documents.length, 2);
  assert.equal(page1.total, total);
  assert.equal(page1.hasMore, total > 2, 'hasMore reflects remainder');

  const last = ks.listDocumentsPage({ limit: 2, offset: Math.floor(total / 2) * 2 });
  assert.ok(last.documents.length >= 0);
  assert.equal(last.hasMore, false, 'no remainder beyond last page');

  const over = ks.listDocumentsPage({ limit: 2, offset: total + 10 });
  assert.equal(over.documents.length, 0, 'offset beyond total → honest empty');
  assert.equal(over.hasMore, false);

  const clamped = ks.listDocumentsPage({ limit: 99999 });
  assert.ok(clamped.limit <= 200, 'limit clamped to 200');
  assert.equal(clamped.documents.length, total, 'full page within clamp');
});

test('F1 挂点收敛: buildTurnInjection 单源注入（关/开/附件前缀/无命中）', async () => {
  ks.setSpaceEnabled(false);
  const noEmbed = async () => [];
  const off = await ks.buildTurnInjection('BASE', [{ role: 'user', content: 'TP53 细胞凋亡机制' }], { embed: noEmbed });  assert.equal(off.systemPrompt, 'BASE', 'space disabled → prompt unchanged');
  assert.equal(off.knowledgeTokens, 0);

  // reindex-me.txt（前面测试留下的 ready 文档）FTS 可命中；embed 注入空数组 → 只走 FTS 通道（不依赖网络）
  ks.setSpaceEnabled(true);
  const on = await ks.buildTurnInjection(
    'BASE',
    [
      { role: 'assistant', content: '先前回复' },
      { role: 'user', content: '[附件: notes.txt]\nTP3 与 BRCA1 互作' },
    ],
    { embed: noEmbed }
  );
  assert.ok(on.systemPrompt.startsWith('BASE'), 'original prompt preserved as prefix');
  assert.ok(on.systemPrompt.includes('知识空间检索结果'), 'attachment prefix stripped and injection appended');
  assert.ok(on.knowledgeTokens > 0, 'token accounting flows through single source');

  const miss = await ks.buildTurnInjection('BASE', [{ role: 'user', content: '毫不相关的查询词语组合' }]);
  assert.equal(miss.systemPrompt, 'BASE', 'no hit → unchanged');
  assert.equal(miss.knowledgeTokens, 0);

  const noUser = await ks.buildTurnInjection('BASE', [{ role: 'assistant', content: '只有助手消息' }]);
  assert.equal(noUser.systemPrompt, 'BASE', 'no user message → unchanged');
  ks.setSpaceEnabled(false);
});

// ---------- BLOCK-94 P2：F2 PDF 解析 + F3 粘贴入库 ----------

// 构造最小合法 PDF（xref 偏移精确；lines 每行一个 Tj 文本对象）
function buildMinimalPdf(lines) {
  const escape = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const contentStream = `BT /F1 14 Tf 72 720 Td ${lines.map((l, i) => `${i > 0 ? '0 -20 Td ' : ''}(${escape(l)}) Tj`).join(' ')} ET`;
  const objs = [];
  objs[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objs[2] = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  objs[3] = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n';
  objs[4] = `4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`;
  objs[5] = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += objs[i];
  }
  const xrefStart = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

test('F2 PDF: 文本层 PDF 摄取 ready（kind=pdf，文本可检索），.pdf 移出 fail-closed 清单', async () => {
  const { checkSupported } = require('../core/biof3-server/helpers/knowledge-parsers.js');
  checkSupported('paper.pdf');

  const pdf = buildMinimalPdf(['TP53 regulates cell cycle arrest.', 'BRCA1 mediates homologous recombination repair.']);
  const doc = await ingest.createDocument({ name: 'tp53-paper.pdf', buffer: pdf, mime: 'application/pdf', autoIngest: false });
  const done = await ingest.ingestDocument(doc.id, { embed: async (t) => t.map(() => makeVec(17)) });
  assert.equal(done.status, 'ready');
  assert.equal(done.kind, 'pdf', 'doc kind corrected to pdf after parse');
  assert.ok(done.chunk_count >= 1, 'extracted text produced chunks');

  const ftsHit = ks.ftsSearch('homologous recombination', 5);
  assert.ok(ftsHit.some((h) => h.chunkId.startsWith(doc.id)), 'PDF text reachable via FTS channel');
  ks.deleteDocument(doc.id);
});

test('F2 PDF: 扫描件（无文本层）诚实 failed，不静默入库', async () => {
  const pdf = buildMinimalPdf([]);
  const contentStreamOnly = pdf;
  const doc = await ingest.createDocument({ name: 'scanned.pdf', buffer: contentStreamOnly, mime: 'application/pdf', autoIngest: false });
  const done = await ingest.ingestDocument(doc.id, { embed: async (t) => t.map(() => makeVec(18)) });
  assert.equal(done.status, 'failed', 'no text layer → failed');
  assert.ok(/empty/.test(done.error || ''), `honest empty error, got: ${done.error}`);
  ks.deleteDocument(doc.id);
});

test('F3 粘贴文本: createDocument 走同一条摄取管道（txt 路由）', async () => {
  const doc = await ingest.createDocument({
    name: '粘贴文本-测试.txt',
    buffer: Buffer.from('粘贴入库的内容，讨论细胞凋亡与 TP53 通路。', 'utf8'),
    mime: 'text/plain',
    autoIngest: false,
  });
  const done = await ingest.ingestDocument(doc.id, { embed: async (t) => t.map(() => makeVec(19)) });
  assert.equal(done.status, 'ready');
  ks.deleteDocument(doc.id);
});

// ---------- BLOCK-94 P4：F5 检索过滤 / 降级诚实化 / citations / knowledge_read ----------

test('F5 检索过滤: docId 限定命中范围（他文档命中不可达）', async () => {
  const target = await ingest.createDocument({
    name: 'filter-target.txt',
    buffer: Buffer.from('过滤目标文档：TP53 与细胞凋亡的核心机制笔记。', 'utf8'),
    autoIngest: false,
  });
  await ingest.ingestDocument(target.id, { embed: async (t) => t.map(() => makeVec(23)) });

  const filtered = await ks.searchKnowledge({
    query: 'TP53 细胞凋亡',
    embed: async () => [makeVec(24)],
    docId: target.id,
  });
  assert.equal(filtered.docId, target.id, 'echoes the filter');
  assert.ok(filtered.hits.every((h) => h.docId === target.id), 'all hits within the filtered doc');
  assert.ok(filtered.hits.length >= 1, 'filtered doc reachable');

  const others = await ks.searchKnowledge({
    query: 'TP53 细胞凋亡',
    embed: async () => [makeVec(24)],
    docId: 'doc_absent',
  });
  assert.equal(others.hits.length, 0, 'unknown/other doc filter → honest empty');
  assert.equal(others.readyChunks, 0, 'readyChunks scoped to the filter');
  ks.deleteDocument(target.id);
});

test('F5 降级诚实化: 纯符号查询 ftsDegraded 标注（不再静默）', async () => {
  const r = await ks.searchKnowledge({ query: '!!!###', embed: NO_VEC });
  assert.equal(r.ftsDegraded, true, 'MATCH syntax failure is surfaced honestly');
});

test('F5 citations: buildTurnInjection 返回注入块清单（溯源数据源）', async () => {
  ks.setSpaceEnabled(true);
  const on = await ks.buildTurnInjection('BASE', [{ role: 'user', content: 'TP3 与 BRCA1 互作' }], {
    embed: async () => [],
  });
  assert.ok(Array.isArray(on.citations), 'citations array returned');
  assert.ok(on.citations.length >= 1, 'injected hits exposed for tracing');
  assert.ok(on.citations.every((c) => typeof c.docName === 'string' && typeof c.seq === 'number'), 'citation shape');

  const miss = await ks.buildTurnInjection('BASE', [{ role: 'user', content: '毫不相关的查询词语组合' }], {
    embed: async () => [],
  });
  assert.equal(miss.citations.length, 0, 'no hit → no citations');
  ks.setSpaceEnabled(false);
});

test('F5 knowledge_read: 按 docId 深读分块原文（未就绪/未知 fail-closed）', async () => {
  const { tool_knowledge_read } = require('../core/biof3-server/agent-tools/knowledge-tools.js');
  const doc = await ingest.createDocument({
    name: 'read-me.txt',
    buffer: Buffer.from('整篇深读目标：TP53 通路要点，含多个分块。', 'utf8'),
    autoIngest: false,
  });
  await ingest.ingestDocument(doc.id, { embed: async (t) => t.map(() => makeVec(25)) });
  ks.setSpaceEnabled(true);

  const out = await tool_knowledge_read({ docId: doc.id });
  assert.equal(out.spaceEnabled, true);
  assert.equal(out.document.id, doc.id);
  assert.ok(out.chunks.length >= 1 && out.chunks[0].text.length > 0, 'chunk text returned');

  const missing = await tool_knowledge_read({ docId: 'doc_none' });
  assert.equal(missing.error, 'knowledge_document_not_found');
  const noId = await tool_knowledge_read({});
  assert.equal(noId.error, 'doc_id_required');
  ks.setSpaceEnabled(false);
  ks.deleteDocument(doc.id);
});

// ---------- BLOCK-94 P5：F6 规模化观测 ----------

test('F6 规模观测: scaleStats 返回 readyChunks 与扫描警戒判定', () => {
  const stats = ks.scaleStats();
  assert.equal(typeof stats.readyChunks, 'number');
  assert.equal(stats.scanWarnThreshold, ks.SCAN_WARN_THRESHOLD);
  assert.equal(stats.scanWarning, stats.readyChunks > ks.SCAN_WARN_THRESHOLD, 'warn only beyond threshold');
  assert.ok(stats.readyChunks >= 0);
});

// ---------- BLOCK-99 G1：多空间 CRUD / 隔离 / 参数化 ----------

test('G1 CRUD: 建空间→列表→重命名→启停→级联删除（含影响面诚实返回）', () => {
  const space = ks.createSpace('G1 测试空间');
  assert.ok(space.id.startsWith('ks_'), 'generated ks_ id');
  assert.equal(space.enabled, 0, 'new space starts disabled');
  assert.equal(space.name, 'G1 测试空间');

  const listed = ks.listSpaces();
  assert.ok(listed.some((s) => s.id === space.id && s.documents === 0 && s.chunks === 0));

  // 重名 → space_name_exists
  assert.throws(() => ks.createSpace('G1 测试空间'), (e) => e.code === 'space_name_exists');
  // 改成重名（与他空间）→ space_name_exists
  assert.throws(() => ks.renameSpace(space.id, '默认知识空间'), (e) => e.code === 'space_name_exists');
  // 空名/超长 → space_name_invalid
  assert.throws(() => ks.createSpace('   '), (e) => e.code === 'space_name_invalid');
  assert.throws(() => ks.createSpace('x'.repeat(61)), (e) => e.code === 'space_name_invalid');
  // 未知空间 rename → space_not_found
  assert.throws(() => ks.renameSpace('ks_absent', 'x'), (e) => e.code === 'space_not_found');

  const renamed = ks.renameSpace(space.id, 'G1 改名空间');
  assert.equal(renamed.name, 'G1 改名空间');

  const enabled = ks.setSpaceEnabled(true, space.id);
  assert.equal(enabled.enabled, 1);

  const impact = ks.spaceImpact(space.id);
  assert.deepEqual(impact, { documents: 0, chunks: 0 });

  const result = ks.deleteSpaceCascade(space.id);
  assert.equal(result.deleted, space.id);
  assert.equal(ks.listSpaces().some((s) => s.id === space.id), false, 'space row gone');
});

test('G1 禁删默认空间 ks_default（400 语义 ks_default_undeletable）', () => {
  assert.throws(() => ks.deleteSpaceCascade('ks_default'), (e) => e.code === 'ks_default_undeletable');
});

test('G1 resolveSpaceId: 缺省回退 ks_default，未知 fail-closed', () => {
  assert.equal(ks.resolveSpaceId(undefined), 'ks_default');
  assert.equal(ks.resolveSpaceId(''), 'ks_default');
  assert.throws(() => ks.resolveSpaceId('ks_absent'), (e) => e.code === 'space_not_found');
});

test('G1 隔离: B 空间文档对默认空间列表不可见；clearSpace(B) 不伤默认空间', async () => {
  const spaceB = ks.createSpace('G1 隔离空间 B');
  // 传未知 spaceId → fail-closed
  await assert.rejects(
    () => ingest.createDocument({ name: 'x.txt', buffer: Buffer.from('孤儿文档'), autoIngest: false, spaceId: 'ks_absent' }),
    (e) => e.code === 'space_not_found'
  );
  const docB = await ingest.createDocument({
    name: '隔离B.txt',
    buffer: Buffer.from('B 空间专属内容，讨论 BRCA1 修复通路。', 'utf8'),
    autoIngest: false,
    spaceId: spaceB.id,
  });
  const docDefault = await ingest.createDocument({
    name: '默认空间守护文档.txt',
    buffer: Buffer.from('默认空间的守护内容，讨论 TP53 通路。', 'utf8'),
    autoIngest: false,
  });

  assert.equal(ks.listDocuments().some((d) => d.id === docB.id), false, 'B 文档不在默认列表');
  assert.equal(ks.listDocuments(spaceB.id).some((d) => d.id === docB.id), true, 'B 文档在 B 列表');
  assert.equal(ks.listDocumentsPage({ spaceId: spaceB.id }).total, 1, '分页参数化按空间计数');

  // 清空 B：默认空间文档毫发无损
  const cleared = ks.clearSpace(spaceB.id);
  assert.equal(cleared.cleared, 1);
  assert.equal(ks.listDocuments(spaceB.id).length, 0);
  assert.equal(ks.listDocuments().some((d) => d.id === docDefault.id), true, '默认空间文档健在');

  ks.deleteDocument(docDefault.id);
  ks.deleteSpaceCascade(spaceB.id);
});

test('G1 检索按空间过滤: spaceId 限定命中（他空间命中不可达，D2 无命中诚实空）', async () => {
  const spaceB = ks.createSpace('G1 检索空间 B');
  const docA = await ingest.createDocument({
    name: '检索A.txt',
    buffer: Buffer.from('A 空间笔记：TP53 细胞凋亡机制综述。', 'utf8'),
    autoIngest: false,
  });
  await ingest.ingestDocument(docA.id, { embed: async (t) => t.map(() => makeVec(31)) });
  const docB = await ingest.createDocument({
    name: '检索B.txt',
    buffer: Buffer.from('B 空间笔记：TP53 细胞凋亡机制补遗。', 'utf8'),
    autoIngest: false,
    spaceId: spaceB.id,
  });
  await ingest.ingestDocument(docB.id, { embed: async (t) => t.map(() => makeVec(32)) });

  const inB = await ks.searchKnowledge({
    query: 'TP53 细胞凋亡',
    embed: async () => [makeVec(33)],
    spaceId: spaceB.id,
  });
  assert.ok(inB.hits.length >= 1, 'B 空间命中');
  assert.ok(inB.hits.every((h) => h.docId === docB.id), '仅 B 空间文档可达');

  const inDefault = await ks.searchKnowledge({
    query: 'TP53 细胞凋亡',
    embed: async () => [makeVec(33)],
  });
  assert.ok(inDefault.hits.every((h) => h.docId === docA.id), '默认空间检索不含 B 文档');

  // 空检索空间诚实空（D2：无命中不回退）
  const empty = await ks.searchKnowledge({
    query: 'TP53 细胞凋亡',
    embed: async () => [makeVec(33)],
    spaceId: ks.createSpace('G1 空检索空间').id,
  });
  assert.equal(empty.hits.length, 0, '所选空间无命中 → 诚实空');

  ks.deleteDocument(docA.id);
  ks.deleteDocument(docB.id);
  ks.deleteSpaceCascade(spaceB.id);
});

// ---------- BLOCK-99 G3：会话级空间绑定与注入 ----------

test('G3 绑定: set/get 往返；绑默认=解绑；未知空间 fail-closed；缺会话 id 拒绝', () => {
  const spaceB = ks.createSpace('G3 绑定空间');
  assert.equal(ks.getSpaceBinding('conv_g3'), 'ks_default', '未绑定回落默认');
  ks.setSpaceBinding('conv_g3', spaceB.id);
  assert.equal(ks.getSpaceBinding('conv_g3'), spaceB.id);
  ks.setSpaceBinding('conv_g3', 'ks_default');
  assert.equal(ks.getSpaceBinding('conv_g3'), 'ks_default', '绑默认=解绑不落行');
  assert.throws(() => ks.setSpaceBinding('conv_g3', 'ks_absent'), (e) => e.code === 'space_not_found');
  assert.throws(() => ks.setSpaceBinding('', 'ks_default'), (e) => e.code === 'binding_conversation_required');
  ks.deleteSpaceCascade(spaceB.id);
});

test('G3 注入: 绑定空间后按绑定范围召回（他空间文档不可达；删空间回落默认）', async () => {
  // buildAgentTurnBlock 有启用门（D4：未启用零注入）——测试期启用默认空间
  ks.setSpaceEnabled(true, 'ks_default');
  const spaceB = ks.createSpace('G3 注入空间 B');
  const docDefault = await ingest.createDocument({
    name: '注入默认.txt',
    buffer: Buffer.from('默认空间注入文档：apoptosis 速查手册。', 'utf8'),
    autoIngest: false,
  });
  await ingest.ingestDocument(docDefault.id, { embed: async (t) => t.map(() => makeVec(41)) });
  const docB = await ingest.createDocument({
    name: '注入B.txt',
    buffer: Buffer.from('B 空间注入文档：singlecell 降维聚类实战指南。', 'utf8'),
    autoIngest: false,
    spaceId: spaceB.id,
  });
  await ingest.ingestDocument(docB.id, { embed: async (t) => t.map(() => makeVec(42)) });

  const embed = async () => [makeVec(43)];

  // 未绑定：默认空间范围（B 文档不注入）
  const before = await ks.buildTurnInjection('SYS', [{ role: 'user', content: 'apoptosis 速查' }], { embed, conversationId: 'conv_inj' });
  assert.ok(before.systemPrompt.includes('速查手册'), '未绑定→默认空间命中');
  assert.ok(!before.systemPrompt.includes('降维聚类'), '未绑定→B 文档不泄漏');

  // 绑定 B：只召回 B（新建空间默认停用——启用门语义：停用即零注入）
  ks.setSpaceEnabled(true, spaceB.id);
  ks.setSpaceBinding('conv_inj', spaceB.id);
  const after = await ks.buildTurnInjection('SYS', [{ role: 'user', content: 'singlecell 降维聚类实战' }], { embed, conversationId: 'conv_inj' });
  assert.ok(after.systemPrompt.includes('降维聚类'), '绑定 B→B 文档注入');
  assert.ok(!after.systemPrompt.includes('速查手册'), '绑定 B→默认文档不可达');
  assert.ok(after.citations.every((c) => c.docId === docB.id), 'citations 仅 B 文档');

  // 删除 B 空间：绑定 FK CASCADE 掉绑 → 回落默认
  ks.deleteSpaceCascade(spaceB.id);
  assert.equal(ks.getSpaceBinding('conv_inj'), 'ks_default', '删空间→FK CASCADE 掉绑回落默认');
  const fallback = await ks.buildTurnInjection('SYS', [{ role: 'user', content: 'apoptosis 速查' }], { embed, conversationId: 'conv_inj' });
  assert.ok(fallback.systemPrompt.includes('速查手册'), '回落默认空间召回');
  ks.setSpaceEnabled(false, 'ks_default'); // 还原启用态（文件后续无消费方，卫生收尾）
  ks.deleteDocument(docDefault.id);
});

// ---------- BLOCK-99 G4：空间管理会话台（工具族 + 归类移动 + D4 确认门）----------

const { dispatchTool } = require('../core/biof3-server/agent-tools/index.js');
const confirmStore = require('../core/biof3-server/helpers/knowledge-confirm.js');

test('G4 moveDocumentsToSpace: 归属迁移非破坏（块/检索跟随，原空间即刻不可达）', async () => {
  const spaceB = ks.createSpace('G4 归类空间 B');
  const doc1 = await ingest.createDocument({
    name: '移动甲.txt',
    buffer: Buffer.from('待移动文档甲：ribosome 别聚糖合成通路笔记。', 'utf8'),
    autoIngest: false,
  });
  const doc2 = await ingest.createDocument({
    name: '移动乙.txt',
    buffer: Buffer.from('待移动文档乙：ribosome 补遗。', 'utf8'),
    autoIngest: false,
  });
  await ingest.ingestDocument(doc1.id, { embed: async (t) => t.map(() => makeVec(51)) });
  await ingest.ingestDocument(doc2.id, { embed: async (t) => t.map(() => makeVec(52)) });

  // 嵌入列查询：迁移后块必须跟随文档行归属
  const beforeChunks = sqlite
    .prepare('SELECT DISTINCT space_id AS s FROM knowledge_chunks WHERE doc_id = ?')
    .get(doc1.id);
  assert.equal(beforeChunks.s, 'ks_default');

  const moved = ks.moveDocumentsToSpace([doc1.id, doc2.id, 'ks_absent_doc'], spaceB.id);
  assert.deepEqual(moved.moved.sort(), [doc1.id, doc2.id].sort(), '存在文档全数迁移');
  assert.deepEqual(moved.missing, ['ks_absent_doc'], '缺失 id 诚实上报');
  assert.equal(moved.targetSpaceId, spaceB.id);

  assert.equal(ks.listDocuments().some((d) => d.id === doc1.id), false, '默认列表即刻不可见');
  assert.equal(ks.listDocuments(spaceB.id).length, 2, 'B 列表接收');
  const afterChunks = sqlite
    .prepare('SELECT DISTINCT space_id AS s FROM knowledge_chunks WHERE doc_id = ?')
    .get(doc1.id);
  assert.equal(afterChunks.s, spaceB.id, '块归属同事务跟随（G1 家法）');

  // 检索按新归属可达、原归属不可达
  const inB = await ks.searchKnowledge({ query: 'ribosome', embed: async () => [makeVec(53)], spaceId: spaceB.id });
  assert.ok(inB.hits.every((h) => h.docId === doc1.id || h.docId === doc2.id), '迁移后 B 空间可检索');
  const inDefault = await ks.searchKnowledge({ query: 'ribosome', embed: async () => [makeVec(53)] });
  assert.ok(!inDefault.hits.some((h) => h.docId === doc1.id || h.docId === doc2.id), '默认空间不再可达');

  // 非法目标 fail-closed（同步抛）；空 docIds 拒绝
  assert.throws(() => ks.moveDocumentsToSpace([doc1.id], 'ks_absent'), (e) => e.code === 'space_not_found');
  assert.throws(() => ks.moveDocumentsToSpace([], spaceB.id), (e) => e.code === 'doc_ids_required');

  ks.deleteSpaceCascade(spaceB.id); // 连带清理已迁入文档
});

test('G4 确认令牌: 签发→匹配消费一次性；错主体/错操作/复用/未知全拒', () => {
  const { confirmToken } = confirmStore.issueConfirmToken('op_x', 'subj_1', { documents: 1 });
  assert.equal(confirmStore.consumeConfirmToken('nope', 'op_x', 'subj_1').ok, false, '未知 token 拒');
  assert.equal(confirmStore.consumeConfirmToken(confirmToken, 'op_y', 'subj_1').ok, false, '操作错配拒');
  assert.equal(confirmStore.consumeConfirmToken(confirmToken, 'op_x', 'subj_2').ok, false, '主体错配拒');
  assert.equal(confirmStore.consumeConfirmToken(confirmToken, 'op_x', 'subj_1').ok, true, '全匹配放行');
  assert.equal(confirmStore.consumeConfirmToken(confirmToken, 'op_x', 'subj_1').ok, false, '一次性：复用拒');
  assert.equal(confirmStore.consumeConfirmToken('', 'op_x', 'subj_1').reason, 'confirm_token_required', '缺 token 拒');
});

test('G4 工具族: 建空间/启停/清单/绑定 工具链（dispatch 走拦截器 schema+policy）', async () => {
  const created = await dispatchTool('knowledge_space_create', { name: 'G4 工具链空间' }, {});
  assert.equal(created.error, undefined, JSON.stringify(created));
  assert.equal(created.space.enabled, false, '新建默认停用');

  const dup = await dispatchTool('knowledge_space_create', { name: 'G4 工具链空间' }, {});
  assert.equal(dup.error, 'space_name_exists', '重名诚实错误形状');

  const enabled = await dispatchTool('knowledge_space_enable', { spaceId: created.space.id, enabled: true }, {});
  assert.equal(enabled.enabled, true);
  const badEnable = await dispatchTool('knowledge_space_enable', { spaceId: created.space.id }, {});
  assert.equal(badEnable.error, 'invalid_arguments', '缺 enabled 被拦截器 schema 先拦（分层：schema → policy → handler）');

  const listed = await dispatchTool('knowledge_space_list', {}, {});
  assert.ok(listed.spaces.some((s) => s.id === created.space.id && s.enabled === true), '列表含启用态');

  const bound = await dispatchTool('knowledge_space_bind', { spaceId: created.space.id }, { conversationId: 'conv_g4' });
  assert.equal(bound.spaceId, created.space.id, '绑定当前会话');
  assert.equal(ks.getSpaceBinding('conv_g4'), created.space.id);
  const unbound = await dispatchTool('knowledge_space_bind', {}, { conversationId: 'conv_g4' });
  assert.equal(unbound.spaceId, 'ks_default', '缺省=解绑回落默认');
  const noCtx = await dispatchTool('knowledge_space_bind', { spaceId: created.space.id }, {});
  assert.equal(noCtx.error, 'binding_conversation_required', '无会话上下文 fail-closed');

  await dispatchTool('knowledge_space_delete', { spaceId: created.space.id, confirmToken: 'kc_bypass' }, {});
  // 上面带错 token：应被拒（空间仍存在），再走正常门清理
  const stillThere = ks.getSpace(created.space.id);
  assert.ok(stillThere, '错 token 不执行');
  const gate = await dispatchTool('knowledge_space_delete', { spaceId: created.space.id }, {});
  assert.equal(gate.confirmationRequired, true);
  await dispatchTool('knowledge_space_delete', { spaceId: created.space.id, confirmToken: gate.confirmToken }, {});
  assert.equal(ks.getSpace(created.space.id), null, '凭 token 删除成功');
});

test('G4 D4 门: 删空间首调出影响面+token，凭用户确认后执行；默认空间任何情况不可删', async () => {
  const spaceB = ks.createSpace('G4 删除门空间');
  const doc = await ingest.createDocument({
    name: '删除门文档.txt',
    buffer: Buffer.from('删除门占位内容 transcriptomics 笔记。', 'utf8'),
    autoIngest: false,
    spaceId: spaceB.id,
  });
  await ingest.ingestDocument(doc.id, { embed: async (t) => t.map(() => makeVec(61)) });

  // 默认空间：确认门前先拦（ks_default_undeletable），带假 token 同样到不了执行
  const defAttempt = await dispatchTool('knowledge_space_delete', { spaceId: 'ks_default' }, {});
  assert.equal(defAttempt.error, 'ks_default_undeletable');

  // 首调（无 token）：不执行 + 影响面诚实 + token 签发
  const first = await dispatchTool('knowledge_space_delete', { spaceId: spaceB.id }, {});
  assert.equal(first.confirmationRequired, true);
  assert.equal(first.impact.documents, 1);
  assert.equal(first.impact.chunks >= 1, true, '块数进影响面');
  assert.match(first.confirmToken, /^kc_/);
  assert.ok(ks.getSpace(spaceB.id), '未确认不执行');

  // 错 token 不执行
  const wrong = await dispatchTool('knowledge_space_delete', { spaceId: spaceB.id, confirmToken: 'kc_wrong' }, {});
  assert.equal(wrong.error, 'confirm_token_invalid_or_expired');
  assert.ok(ks.getSpace(spaceB.id), '错 token 仍不执行');

  // 凭 token 执行 + 一次性（复用拒，空间已不在）
  const done = await dispatchTool('knowledge_space_delete', { spaceId: spaceB.id, confirmToken: first.confirmToken }, {});
  assert.equal(done.deleted, spaceB.id);
  assert.equal(done.documents, 1);
  assert.equal(ks.getSpace(spaceB.id), null);
  const reuse = await dispatchTool('knowledge_space_delete', { spaceId: spaceB.id, confirmToken: first.confirmToken }, {});
  assert.equal(reuse.error, 'space_not_found', '空间已删，不存在可再删的目标');
});

test('G4 D4 门: 批量删文档走门、单篇直删（与手动 UI/REST 同界）；清空空间走门', async () => {
  const spaceB = ks.createSpace('G4 批删空间');
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const d = await ingest.createDocument({
      name: `批删${i}.txt`,
      buffer: Buffer.from(`批删占位 proteomics 内容 ${i}。`, 'utf8'),
      autoIngest: false,
      spaceId: spaceB.id,
    });
    ids.push(d.id);
  }
  // 批量（>1）：无 token → 门；token 主体绑定排序 docIds
  const gate = await dispatchTool('knowledge_doc_delete', { docIds: ids }, {});
  assert.equal(gate.confirmationRequired, true);
  assert.equal(gate.impact.documents, 2);
  assert.deepEqual(gate.impact.docNames.sort(), ['批删0.txt', '批删1.txt']);
  assert.equal(ks.listDocuments(spaceB.id).length, 2, '未确认不删');

  const mismatch = await dispatchTool('knowledge_doc_delete', { docIds: [ids[1], ids[0]], confirmToken: gate.confirmToken }, {});
  assert.equal(mismatch.error, undefined, 'token 主体按排序 docIds 绑定，乱序不炸');
  assert.equal(mismatch.deleted.length, 2, '确认后批量删除');

  // 单篇直删（无门，与 REST 对齐）
  const single = await ingest.createDocument({
    name: '单删.txt',
    buffer: Buffer.from('单删占位 metabolomics 内容。', 'utf8'),
    autoIngest: false,
    spaceId: spaceB.id,
  });
  const del1 = await dispatchTool('knowledge_doc_delete', { docIds: [single.id] }, {});
  assert.equal(del1.error, undefined, '单篇无 confirmationRequired');
  assert.equal(del1.confirmationRequired, undefined);
  assert.equal(del1.deleted.length, 1);

  // 清空空间走门
  await ingest.createDocument({
    name: '清空门.txt',
    buffer: Buffer.from('清空门占位内容。', 'utf8'),
    autoIngest: false,
    spaceId: spaceB.id,
  });
  const clearGate = await dispatchTool('knowledge_space_clear', { spaceId: spaceB.id }, {});
  assert.equal(clearGate.confirmationRequired, true);
  assert.equal(ks.listDocuments(spaceB.id).length, 1, '未确认不清');
  const cleared = await dispatchTool('knowledge_space_clear', { spaceId: spaceB.id, confirmToken: clearGate.confirmToken }, {});
  assert.equal(cleared.cleared, 1);
  assert.equal(ks.listDocuments(spaceB.id).length, 0, '确认后清空');
  assert.ok(ks.getSpace(spaceB.id), '清空保留空间本身');
  ks.deleteSpaceCascade(spaceB.id);
});

test('G4 工具: doc_move/doc_reindex/doc_list + knowledge_search spaceId 透传', async () => {
  ks.setSpaceEnabled(true, 'ks_default');
  const spaceB = ks.createSpace('G4 移动工具空间');
  const doc = await ingest.createDocument({
    name: '工具移动.txt',
    buffer: Buffer.from('工具链移动占位 genomics variant calling 笔记。', 'utf8'),
    autoIngest: false,
  });
  await ingest.ingestDocument(doc.id, { embed: async (t) => t.map(() => makeVec(71)) });

  const moved = await dispatchTool('knowledge_doc_move', { docIds: [doc.id], targetSpaceId: spaceB.id }, {});
  assert.equal(moved.error, undefined, JSON.stringify(moved));
  assert.equal(moved.moved, 1);
  assert.equal(ks.listDocuments(spaceB.id).some((d) => d.id === doc.id), true);

  const docList = await dispatchTool('knowledge_doc_list', { spaceId: spaceB.id }, {});
  assert.equal(docList.total, 1);
  assert.equal(docList.documents[0].id, doc.id);

  // knowledge_search 带 spaceId：命中目标空间（doc 仍 ready，未动 reindex）
  ks.setSpaceEnabled(true, spaceB.id);
  const hit = await dispatchTool('knowledge_search', { query: 'variant calling', spaceId: spaceB.id }, {});
  assert.equal(hit.error, undefined, JSON.stringify(hit));
  assert.ok(hit.hits.length >= 1, '目标空间命中');

  // 重建索引：入队返回诚实状态；无嵌入 key 时管道诚实转 failed（旧块在失败路径下保留）
  const re = await dispatchTool('knowledge_doc_reindex', { docId: doc.id }, {});
  assert.equal(re.error, undefined, JSON.stringify(re));
  let terminal = ks.getDocument(doc.id);
  for (let i = 0; i < 100 && !['ready', 'failed'].includes(terminal.status); i++) {
    await new Promise((r) => setTimeout(r, 10));
    terminal = ks.getDocument(doc.id);
  }
  assert.ok(['ready', 'failed'].includes(terminal.status), `重建进入终态：${terminal.status}`);
  const chunkSpace = sqlite.prepare('SELECT DISTINCT space_id AS s FROM knowledge_chunks WHERE doc_id = ?').get(doc.id);
  assert.equal(chunkSpace ? chunkSpace.s : spaceB.id, spaceB.id, '重建后块归属仍在 B');

  ks.setSpaceEnabled(false, spaceB.id);
  const disabled = await dispatchTool('knowledge_search', { query: 'variant calling', spaceId: spaceB.id }, {});
  assert.equal(disabled.spaceEnabled, false, '停用空间诚实拒检');
  assert.equal(disabled.hits.length, 0);

  const absent = await dispatchTool('knowledge_search', { query: 'x', spaceId: 'ks_absent' }, {});
  assert.equal(absent.error, 'space_not_found', '未知空间 fail-closed');

  ks.deleteSpaceCascade(spaceB.id);
  ks.setSpaceEnabled(false, 'ks_default');
});

// ---------- BLOCK-99 P5：G5 嵌入一致性按空间 + G6 启动恢复按空间 ----------

test('G5 失配统计与隔离按空间：B 空间旧模型向量不污染默认空间统计，向量通道分空间各自隔离', async () => {
  ks.setSpaceEnabled(true, 'ks_default');
  const spaceB = ks.createSpace('G5 失配空间 B');
  ks.setSpaceEnabled(true, spaceB.id);
  const docDefault = await ingest.createDocument({
    name: 'G5 默认.txt',
    buffer: Buffer.from('默认空间 G5 文档：chromatin remodeling 综述。', 'utf8'),
    autoIngest: false,
  });
  // 块向量以查询向量（seed 83）为主导混合，保证当前模型向量可进向量通道
  await ingest.ingestDocument(docDefault.id, { embed: async (t) => t.map(() => blendVec(makeVec(83), makeVec(81), 0.98)) });
  const docB = await ingest.createDocument({
    name: 'G5 B.txt',
    buffer: Buffer.from('B 空间 G5 文档：chromatin 补遗。', 'utf8'),
    autoIngest: false,
    spaceId: spaceB.id,
  });
  await ingest.ingestDocument(docB.id, { embed: async (t) => t.map(() => makeVec(82)) });
  // B 空间块伪造为旧模型产出（换嵌入模型后未重建的形态）
  sqlite.prepare('UPDATE knowledge_chunks SET model = ? WHERE doc_id = ?').run('text-embedding-old', docB.id);

  const statsDefault = ks.staleEmbeddingStats('ks_default');
  const statsB = ks.staleEmbeddingStats(spaceB.id);
  assert.equal(statsDefault.staleChunks, 0, '默认空间无失配');
  assert.ok(statsB.staleChunks >= 1 && statsB.staleDocs >= 1, 'B 空间失配诚实计数');

  // B 空间检索：旧模型块隔离出向量通道（FTS 仍可达），且 staleEmbedding 投影跟随 B
  const searchB = await ks.searchKnowledge({
    query: 'chromatin',
    embed: async () => [makeVec(83)],
    spaceId: spaceB.id,
  });
  assert.ok(searchB.hits.length >= 1, 'B 空间 FTS 通道仍命中');
  assert.ok(searchB.hits.every((h) => !(h.channels && h.channels.vector)), 'B 旧模型向量被隔离');
  assert.ok(searchB.staleEmbedding && searchB.staleEmbedding.staleChunks >= 1, '检索投影跟随目标空间 B');

  // 默认空间检索：失配统计不串空间（曾恒算默认之外还可能互相污染）
  const searchDefault = await ks.searchKnowledge({
    query: 'chromatin',
    embed: async () => [makeVec(83)],
  });
  assert.ok(searchDefault.hits.some((h) => h.channels && h.channels.vector), '默认空间当前模型向量照常进向量通道');
  assert.equal(searchDefault.staleEmbedding.staleChunks, 0, '默认空间检索不背 B 空间的失配');

  ks.deleteDocument(docDefault.id);
  ks.deleteSpaceCascade(spaceB.id);
  ks.setSpaceEnabled(false, 'ks_default');
});

test('G6 启动恢复跨空间：B 空间中间态文档重启后重排入队并落到终态（曾只扫默认空间即永久卡死）', async () => {
  const spaceB = ks.createSpace('G6 恢复空间 B');
  const okDir = ks.docDir('doc_g6_recover_b');
  fs.mkdirSync(okDir, { recursive: true });
  fs.writeFileSync(path.join(okDir, 'g6.txt'), 'B 空间重启恢复夹具：chromatin remodeling 与 TP53 关键词长文本，保证可分块。');
  sqlite
    .prepare(
      `INSERT INTO knowledge_documents (id, space_id, name, kind, size, status, raw_path, created_at, updated_at)
       VALUES ('doc_g6_b', ?, 'g6.txt', 'text', 100, 'embedding', ?, datetime('now'), datetime('now'))`
    )
    .run(spaceB.id, path.join(okDir, 'g6.txt'));

  const fakeEmbed = async (texts) => texts.map((t) => blendVec(makeVec(91), makeVec(t.length), 0.98));
  const recovery = ingest.recoverInterruptedIngest({ embed: fakeEmbed });
  assert.ok(recovery.docIds.includes('doc_g6_b'), 'B 空间中间态文档被恢复扫描覆盖');
  await recovery.settled;
  assert.equal(ks.getDocument('doc_g6_b').status, 'ready', 'B 空间文档恢复到 ready');
  const chunkSpace = sqlite.prepare('SELECT DISTINCT space_id AS s FROM knowledge_chunks WHERE doc_id = ?').get('doc_g6_b');
  assert.equal(chunkSpace.s, spaceB.id, '恢复摄取的块归属仍在 B 空间');

  ks.deleteDocument('doc_g6_b');
  ks.deleteSpaceCascade(spaceB.id);
});

test('G6 批量重试跨空间：B 空间 failed 文档可重试（曾只扫默认空间）', async () => {
  const spaceB = ks.createSpace('G6 重试空间 B');
  const doc = await ingest.createDocument({
    name: 'g6-retry.txt',
    buffer: Buffer.from('B 空间批量重试夹具：ribosome 内容。', 'utf8'),
    autoIngest: false,
    spaceId: spaceB.id,
  });
  await ingest.ingestDocument(doc.id, { embed: async () => null });
  assert.equal(ks.getDocument(doc.id).status, 'failed');

  const result = ingest.retryFailedDocuments({ embed: async (t) => t.map(() => makeVec(93)) });
  assert.ok(
    (result.requeued >= 1),
    `B 空间 failed 文档被重试扫描覆盖（requeued=${result.requeued}）`
  );
  await result.settled;
  assert.equal(ks.getDocument(doc.id).status, 'ready', '重试后到 ready');
  ks.deleteDocument(doc.id);
  ks.deleteSpaceCascade(spaceB.id);
});
