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
