/**
 * item 87 第一阶段 HK-01 — 领域知识层骨架。
 * ①卡片 schema 钉：缺来源/日期/有效期的卡片一律拒绝入库（红）。
 * ②引用验真钉：验真不通过的引用记录拒绝入库（红）。
 * ③append-only：do_knowledge_cards / do_citation_records 禁 UPDATE/DELETE（触发器）。
 * 迁移文件与 schema 模块逐字节一致（scratchpad 同款防第二真相）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const requireFrom = (rel) => require(path.join(ROOT, rel));
const {
  DO_CONTRACT_VERSION,
  ensureDoKnowledgeSchema,
  buildDoKnowledgeMigrationSql,
  DO_KNOWLEDGE_TABLES,
} = requireFrom('core/shared-backend/do-knowledge-schema.js');
const {
  insertKnowledgeCard,
  insertCitationRecord,
  listKnowledgeCards,
  supersedeKnowledgeCard,
} = requireFrom('core/shared-backend/do-knowledge-store.js');

function freshDb() {
  const db = new Database(':memory:');
  ensureDoKnowledgeSchema(db);
  return db;
}

function validCard(overrides = {}) {
  return {
    domain: 'bioinformatics',
    topic: '差异分析',
    conclusion: 'DESeq2 以负二项分布建模 counts，用 Wald 检验给出 padj。',
    evidenceLevel: 'official',
    sourceId: 'bioconductor-deseq2',
    sourceName: 'DESeq2 官方 vignette',
    sourceUrl: 'https://bioconductor.org/packages/release/bioc/vignettes/DESeq2/inst/doc/DESeq2.html',
    sourceDate: '2025-10-15',
    validUntil: '2027-10-15',
    freshnessClass: 'stable',
    ...overrides,
  };
}

test('HK-87-1：两表迁移可建、契约版本在场、字节一致', () => {
  const db = freshDb();
  for (const table of DO_KNOWLEDGE_TABLES) {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    assert.ok(row, `表应存在：${table}`);
  }
  assert.equal(DO_CONTRACT_VERSION, 1);
  // 迁移文件唯一真相：generated 与 src/migrations/025_domain_knowledge.sql 逐字节一致
  const sqlPath = path.join(ROOT, 'src', 'migrations', '025_domain_knowledge.sql');
  assert.ok(fs.existsSync(sqlPath), '迁移文件应存在');
  assert.equal(buildDoKnowledgeMigrationSql(), fs.readFileSync(sqlPath, 'utf8'));
});

test('HK-87-2：append-only 触发器拒绝 UPDATE/DELETE', () => {
  const db = freshDb();
  db.prepare('SELECT 1').get();
  
  const inserted = insertKnowledgeCard(db, validCard());
  assert.ok(inserted.ok, `合法卡片应可入库：${JSON.stringify(inserted)}`);
  const citation = insertCitationRecord(db, {
    doi: '10.1186/s13059-014-0550-8',
    title: 'Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2',
    registry: 'crossref',
    verify: { status: 'verified', checkedAt: '2026-11-27T00:00:00Z', via: 'crossref' },
  });
  assert.ok(citation.ok, `引用应可入库：${JSON.stringify(citation)}`);
  // 触发器是行级的：空表 UPDATE 0 行不触发，故两表都先有行再验
  assert.throws(() => db.prepare('UPDATE do_knowledge_cards SET conclusion = ?').run('改写'), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM do_knowledge_cards').run(), /append-only/);
  assert.throws(() => db.prepare('UPDATE do_citation_records SET title = ?').run('改写'), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM do_citation_records').run(), /append-only/);
});

test('HK-87-3（钉①）：缺来源/日期/有效期的卡片=红，一律拒绝', () => {
  const db = freshDb();
  for (const [field, overrides] of [
    ['source_id', { sourceId: undefined }],
    ['source_url', { sourceUrl: '' }],
    ['source_date', { sourceDate: undefined }],
    ['valid_until', { validUntil: '' }],
    ['conclusion', { conclusion: '  ' }],
    ['domain', { domain: undefined }],
    ['evidence_level', { evidenceLevel: 'hearsay' }],
    ['freshness_class', { freshnessClass: 'unknown' }],
  ]) {
    const result = insertKnowledgeCard(db, validCard(overrides));
    assert.equal(result.ok, false, `缺 ${field} 的卡片必须拒绝`);
    assert.ok(result.error && result.error.length > 0, `${field} 缺失要给可读原因`);
  }
});

test('HK-87-4：修订链 append-only——supersede 只追加新卡（revision_of 指向旧卡）', () => {
  const db = freshDb();
  const first = insertKnowledgeCard(db, validCard());
  assert.ok(first.ok);
  const second = supersedeKnowledgeCard(db, first.cardId, validCard({
    conclusion: 'DESeq2 v1.44 起 lfcShrink 默认 apeglm。',
    sourceDate: '2026-05-02',
    validUntil: '2028-05-02',
  }));
  assert.ok(second.ok, `修订应可追加：${JSON.stringify(second)}`);
  const cards = listKnowledgeCards(db, { domain: 'bioinformatics' });
  assert.equal(cards.length, 2);
  const child = cards.find((card) => card.cardId === second.cardId);
  assert.equal(child.revisionOf, first.cardId);
});

test('HK-87-5（钉②）：验真不通过的引用记录拒绝入库，验真通过才收', () => {
  const db = freshDb();
  const rejected = insertCitationRecord(db, {
    doi: '10.1186/s13059-014-0550-8',
    title: 'Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2',
    registry: 'crossref',
    verify: { status: 'title_mismatch', checkedAt: '2026-11-27T00:00:00Z' },
  });
  assert.equal(rejected.ok, false, '验真失败的引用必须拒绝入库');
  assert.match(rejected.error, /验真|verified|unverified/i);

  const missingVerify = insertCitationRecord(db, {
    doi: '10.1186/s13059-014-0550-9',
    title: '另一篇没有验真记录的论文',
    registry: 'crossref',
  });
  assert.equal(missingVerify.ok, false, '没有验真结果的引用必须拒绝入库');

  const accepted = insertCitationRecord(db, {
    doi: '10.1186/s13059-014-0550-8',
    title: 'Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2',
    authors: ['Michael I Love', 'Wolfgang Huber', 'Simon Anders'],
    year: 2014,
    container: 'Genome Biology',
    registry: 'crossref',
    verify: { status: 'verified', checkedAt: '2026-11-27T00:00:00Z', via: 'crossref' },
  });
  assert.ok(accepted.ok, `验真通过的引用应可入库：${JSON.stringify(accepted)}`);

  const dup = insertCitationRecord(db, {
    doi: '10.1186/s13059-014-0550-8',
    title: '同一 DOI 二次入库',
    registry: 'crossref',
    verify: { status: 'verified', checkedAt: '2026-11-27T00:00:00Z' },
  });
  assert.equal(dup.ok, false, '同 DOI 不得二次入库（append-only + 唯一约束）');
});
