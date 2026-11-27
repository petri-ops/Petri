'use strict';

/**
 * shared-backend/do-ingest.js
 *
 * item 87 第一阶段 —— 采集管线 MVP（方案 §5.2 第 2 步）。
 * 真理源 URL → 抓取 → 结构化总结卡片（结论/证据等级/来源/日期/有效期）→ 入库带溯源。
 *
 * fail-closed：抓取失败 / 总结失败 / DOI 验真失败 → 不出卡，如实返回 reason。
 * summarize 可注入：MVP 采集器用摘录式总结（do-ingest.extractiveSummarizer——
 * 只引原文关键句，不生成原文没有的结论；LLM 总结面等 88/教练层接入后再升级）。
 * L2 外发纪律：fetch 只打真理源 URL；DOI 反查只发 DOI（citation-verify 隐私红线）。
 */

const { insertKnowledgeCard, insertCitationRecord } = require('./do-knowledge-store');
const { verifyCitation, normalizeDoi } = require('./citation-verify');

/** 时效分级 → 有效期策略（天）。快变知识短有效期（到期即需 L2 重采）。 */
const VALIDITY_POLICY_DAYS = Object.freeze({ stable: 730, fast: 90 });

function addDaysIso(dateIso, days) {
  const date = new Date(dateIso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * 摘录式总结器：从 HTML/文本里抽取关键句（去标签、按句切分、带预算截取）。
 * 只摘录原文，不生成原文没有的结论——MVP 的诚实边界（写进卡片 conclusion 的都是引文）。
 */
function extractiveSummarizer(content, source, options = {}) {
  const text = String(content || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { ok: false, reason: '抓取内容清洗后为空（结构与预期不符）' };
  const sentences = text.split(/(?<=[.!?。！？])\s+/).filter((sentence) => sentence.length >= 24);
  const budget = options.maxChars || 600;
  const picks = [];
  let length = 0;
  for (const sentence of sentences) {
    if (length + sentence.length > budget) break;
    picks.push(sentence);
    length += sentence.length;
  }
  if (picks.length === 0 && sentences.length === 0) {
    return { ok: false, reason: '未能从抓取内容中摘出有效句子（结构与预期不符）' };
  }
  const conclusion = picks.length > 0
    ? `【摘录·${source.name}】${picks.join(' ')}`
    : `【摘录·${source.name}】${text.slice(0, budget)}`;
  return {
    ok: true,
    topic: options.topic || source.name,
    conclusion,
    sourceDate: options.sourceDate || (options.now || new Date().toISOString()).slice(0, 10),
    doi: options.doi || null,
  };
}

/**
 * 采集单个真理源。
 * 参数：{ db, source, domain?, fetchContent?, summarize?, verifyCitation?, now? }
 * 返回 { ok, cardId?, citationId?, reason? } —— 失败路径零副作用（不出卡）。
 */
async function ingestKnowledgeSource(options = {}) {
  const { db, source } = options;
  if (!db) return { ok: false, reason: 'db 缺失' };
  if (!source || typeof source.id !== 'string' || typeof source.url !== 'string') {
    return { ok: false, reason: '真理源配置不完整（需 id/url）' };
  }
  const now = options.now || new Date().toISOString();
  const fetchedAt = now;

  // 1. 抓取（默认真调用 fetch；测试注入 fixture）
  const fetchContent = options.fetchContent || (async ({ url }) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    return { ok: true, content: await response.text(), fetchedAt };
  });
  const fetched = await fetchContent({ url: source.url, fetchedAt });
  if (!fetched || fetched.ok !== true) {
    return { ok: false, reason: `抓取失败：${fetched && fetched.reason || '未知原因'}` };
  }

  // 2. 结构化总结（默认摘录式）
  const summarize = options.summarize || ((content, src, opts) => extractiveSummarizer(content, src, opts));
  const summary = await summarize(fetched.content, source, { now: fetchedAt });
  if (!summary || summary.ok !== true) {
    return { ok: false, reason: `总结失败：${summary && summary.reason || '未知原因'}` };
  }

  // 3. DOI 在场则先过引用验真（钉②同源 fail-closed）；验真通过落引用记录
  let citationId = null;
  if (summary.doi) {
    const verify = options.verifyCitation
      ? await options.verifyCitation({ doi: summary.doi, expectedTitle: summary.expectedTitle })
      : await verifyCitation({ doi: summary.doi, expectedTitle: summary.expectedTitle });
    if (verify.status !== 'verified') {
      return { ok: false, reason: `引用验真未通过（${verify.status}）：${verify.error || ''}——不出卡` };
    }
    const inserted = insertCitationRecord(db, {
      doi: normalizeDoi(summary.doi) || summary.doi,
      title: verify.record && verify.record.title ? verify.record.title : summary.topic,
      authors: verify.record && verify.record.authors,
      year: verify.record && verify.record.year,
      container: verify.record && verify.record.container,
      registry: verify.via,
      verify,
    }, { now });
    if (inserted.ok) citationId = inserted.citationId; // 同 DOI 已入库不算失败（append-only 去重）
  }

  // 4. 卡片入库（钉①由 store 强制）；有效期按时效分级策略
  const freshnessClass = source.freshness === 'fast' ? 'fast' : 'stable';
  const sourceDate = summary.sourceDate || fetchedAt.slice(0, 10);
  const insertedCard = insertKnowledgeCard(db, {
    domain: options.domain || source.domain || 'general',
    topic: summary.topic,
    conclusion: summary.conclusion,
    evidenceLevel: source.authority_level || 'community',
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: source.url,
    sourceDate,
    validUntil: summary.validUntil || addDaysIso(sourceDate, VALIDITY_POLICY_DAYS[freshnessClass]),
    freshnessClass,
  }, {
    now,
    provenance: {
      pipeline: 'do-ingest-mvp',
      fetchedAt,
      summarizeMode: options.summarize ? 'injected' : 'extractive-mvp',
      citationId,
      notes: 'MVP 摘录式总结：conclusion 均为原文摘录，非生成',
    },
  });
  if (!insertedCard.ok) return { ok: false, reason: `卡片入库被拒（钉①）：${insertedCard.error}` };
  return { ok: true, cardId: insertedCard.cardId, citationId };
}

module.exports = { ingestKnowledgeSource, extractiveSummarizer };
