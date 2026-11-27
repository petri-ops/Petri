#!/usr/bin/env node
'use strict';
/**
 * item 87 第一阶段 — 真源实测采集管线留证脚本（一次性证据工具，非门禁）。
 *
 * 对 2 个 bio 权威源做端到端真调用：抓取（真 fetch）→ 摘录式总结 → 卡片入库带溯源；
 * 另对 Love 2014 (DESeq2 方法论文) 做真调用 Crossref DOI 反查。
 * 输出写 acceptance/item87-phase1/live-evidence.json（含 HTTP 状态/耗时/卡片溯源，
 * 零正文外发：DOI 反查只发 DOI 字段）。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { ensureDoKnowledgeSchema } = require(path.join(ROOT, 'core/shared-backend/do-knowledge-schema.js'));
const { ingestKnowledgeSource, extractiveSummarizer } = require(path.join(ROOT, 'core/shared-backend/do-ingest.js'));
const { verifyCitation, normalizeDoi } = require(path.join(ROOT, 'core/shared-backend/citation-verify.js'));
const { listKnowledgeCards, listCitationRecords } = require(path.join(ROOT, 'core/shared-backend/do-knowledge-store.js'));
const { parseSourcesYaml, validateSourcesFile, buildSourceIndex } = require(path.join(ROOT, 'core/shared-backend/do-sources.js'));

const db = new Database(':memory:');
ensureDoKnowledgeSchema(db);

const sourcesText = fs.readFileSync(path.join(ROOT, 'resources/domain-onboarding/petri-pack-bio/sources.yaml'), 'utf8');
const parsed = validateSourcesFile(sourcesText);
if (!parsed.ok) throw new Error(`真理源清单非法：${JSON.stringify(parsed)}`);
const index = buildSourceIndex(parsed.sources);
const pick = (id) => { const s = index.get(id); if (!s) throw new Error(`缺真理源 ${id}`); return { ...s, domain: parsed.meta.domain }; };

const evidence = { startedAt: new Date().toISOString(), sources: [], citation: null };
const timing = async (label, fn) => {
  const started = Date.now();
  try {
    const result = await fn();
    return { label, ms: Date.now() - started, result };
  } catch (error) {
    return { label, ms: Date.now() - started, error: error.message };
  }
};

// 真源 1：DESeq2 官方 vignette（stable）
{
  const leg = await timing('bioconductor-deseq2', () => ingestKnowledgeSource({
    db,
    source: pick('bioconductor-deseq2'),
    domain: parsed.meta.domain,
    summarize: (content, source) => extractiveSummarizer(content, source, {
      topic: '差异分析（DESeq2 vignette）',
      // vignette 页脚有 Bioconductor 版本日期；抓不到就用抓取日并如实标注
      sourceDate: new Date().toISOString().slice(0, 10),
    }),
  }));
  evidence.sources.push(leg);
}

// 真源 2：STAR 官方手册 README（fast → 有效期 90 天）
{
  const starSource = pick('star-manual');
  const leg = await timing('star-manual', () => ingestKnowledgeSource({
    db,
    source: { ...starSource, url: 'https://raw.githubusercontent.com/alexdobin/STAR/master/README.md', freshness: 'fast' },
    domain: parsed.meta.domain,
    summarize: (content, source) => extractiveSummarizer(content, source, {
      topic: '剪接读段比对（STAR README）',
      sourceDate: new Date().toISOString().slice(0, 10),
    }),
  }));
  evidence.sources.push(leg);
}

// DOI 反查真调用：Love 2014（Crossref）
{
  const leg = await timing('crossref-love-2014', () => verifyCitation({
    doi: '10.1186/s13059-014-0550-8',
    expectedTitle: 'Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2',
  }));
  evidence.citation = leg;
  if (leg.result && leg.result.status === 'verified') {
    const inserted = require(path.join(ROOT, 'core/shared-backend/do-knowledge-store.js'))
      .insertCitationRecord(db, {
        doi: normalizeDoi('10.1186/s13059-014-0550-8'),
        title: leg.result.record.title,
        authors: leg.result.record.authors,
        year: leg.result.record.year,
        container: leg.result.record.container,
        registry: leg.result.via,
        verify: leg.result,
      });
    evidence.citation.inserted = inserted;
  }
}

evidence.cards = listKnowledgeCards(db).map((card) => ({
  ...card, conclusion: `${card.conclusion.slice(0, 120)}…`,
}));
evidence.citations = listCitationRecords(db);
evidence.finishedAt = new Date().toISOString();

const outPath = path.join(ROOT, 'acceptance/item87-phase1/live-evidence.json');
fs.writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`written ${outPath}`);
for (const source of evidence.sources) {
  console.log(`${source.label}: ${source.result && source.result.ok ? `ok cardId=${source.result.cardId} (${source.ms}ms)` : `FAILED ${(source.result && source.result.reason) || source.error}`}`);
}
console.log(`citation: ${evidence.citation.result && evidence.citation.result.status} via ${evidence.citation.result && evidence.citation.result.via} (${evidence.citation.ms}ms)`);
