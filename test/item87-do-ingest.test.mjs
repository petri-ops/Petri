/**
 * item 87 第一阶段 — 采集管线 MVP。
 * 抓取→结构化总结卡片（结论/证据等级/来源/日期/有效期）→入库带溯源。
 * fixture 注入跑端到端；真源实测走 acceptance/item87-phase1/live-ingest.mjs 留证。
 * fail-closed：抓取失败/总结失败/验真失败都不出卡，不出假卡。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const requireFrom = (rel) => require(path.join(ROOT, rel));
const { ensureDoKnowledgeSchema } = requireFrom('core/shared-backend/do-knowledge-schema.js');
const { ingestKnowledgeSource } = requireFrom('core/shared-backend/do-ingest.js');
const { listKnowledgeCards } = requireFrom('core/shared-backend/do-knowledge-store.js');

const SOURCE = {
  id: 'bioconductor-deseq2',
  name: 'DESeq2 官方 vignette',
  url: 'https://bioconductor.org/packages/release/bioc/vignettes/DESeq2/inst/doc/DESeq2.html',
  authority_level: 'official',
  freshness: 'stable',
  verified_date: '2026-11-27',
};

function freshDb() {
  const db = new Database(':memory:');
  ensureDoKnowledgeSchema(db);
  return db;
}

test('HK-87-15：端到端——抓取→总结→卡片入库带溯源', async () => {
  const db = freshDb();
  const result = await ingestKnowledgeSource({
    db,
    source: SOURCE,
    fetchContent: async () => ({
      ok: true,
      content: '<html><title>DESeq2 vignette</title><p>Analyzing RNA-seq data with DESeq2: count matrix, design formula, Wald test.</p></html>',
      fetchedAt: '2026-11-27T04:30:00.000Z',
    }),
    summarize: () => ({
      ok: true,
      topic: '差异分析',
      conclusion: '【摘录】count matrix、design formula 与 Wald test 是 DESeq2 分析主链。',
      sourceDate: '2025-10-15',
      doi: null,
    }),
    now: '2026-11-27T04:30:01.000Z',
  });
  assert.ok(result.ok, `端到端应成功：${JSON.stringify(result)}`);
  const cards = listKnowledgeCards(db, { domain: SOURCE.domain ?? undefined });
  // source 对象不带 domain 时由调用方 domain 参数兜底——这里默认领域写入
  assert.ok(cards.length >= 1, '应至少入库一张卡');
  const card = cards[0];
  assert.equal(card.sourceId, SOURCE.id);
  assert.equal(card.conclusion.includes('Wald test'), true);
  assert.ok(card.provenanceJson, '溯源必须落库');
  assert.ok(card.provenanceJson.fetchedAt, '溯源含抓取时间');
  assert.ok(card.sourceDate && card.validUntil, '来源日期与有效期必须落库');
});

test('HK-87-16（fail-closed）：抓取失败/总结失败→不出卡、如实返回原因', async () => {
  const db = freshDb();
  const netFail = await ingestKnowledgeSource({
    db,
    source: SOURCE,
    fetchContent: async () => ({ ok: false, reason: 'HTTP 503' }),
    summarize: () => ({ ok: true, topic: 't', conclusion: 'c', sourceDate: '2026-01-01' }),
    now: '2026-11-27T04:30:00.000Z',
  });
  assert.equal(netFail.ok, false, '抓取失败不得出卡');
  assert.match(netFail.reason, /503/);

  const sumFail = await ingestKnowledgeSource({
    db,
    source: SOURCE,
    fetchContent: async () => ({ ok: true, content: 'x', fetchedAt: '2026-11-27T04:30:00.000Z' }),
    summarize: () => ({ ok: false, reason: '页面结构与预期不符' }),
    now: '2026-11-27T04:30:00.000Z',
  });
  assert.equal(sumFail.ok, false, '总结失败不得出卡');
  assert.equal(listKnowledgeCards(db).length, 0, '两次失败都不应有卡入库');
});

test('HK-87-17：带 DOI 的来源必须先过引用验真（与钉②同源，fail-closed）', async () => {
  const db = freshDb();
  const refused = await ingestKnowledgeSource({
    db,
    source: { ...SOURCE, id: 'genome-biology', name: 'Genome Biology', url: 'https://genomebiology.biomedcentral.com/articles/10.1186/s13059-014-0550-8' },
    fetchContent: async () => ({ ok: true, content: 'paper', fetchedAt: '2026-11-27T04:30:00.000Z' }),
    summarize: () => ({
      ok: true,
      topic: '方法论文',
      conclusion: 'DESeq2 论文。',
      sourceDate: '2014-12-05',
      doi: '10.1186/s13059-014-0550-8',
      expectedTitle: '一个故意不匹配的标题',
    }),
    verifyCitation: async () => ({ status: 'title_mismatch', via: 'crossref', checkedAt: '2026-11-27T04:30:00.000Z' }),
    now: '2026-11-27T04:30:01.000Z',
  });
  assert.equal(refused.ok, false, 'DOI 验真不通过不得出卡');
  assert.match(refused.reason, /验真|title_mismatch/i);
  assert.equal(listKnowledgeCards(db).length, 0, '验真失败不落卡');
});
