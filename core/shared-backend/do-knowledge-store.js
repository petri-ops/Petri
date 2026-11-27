'use strict';

/**
 * shared-backend/do-knowledge-store.js
 *
 * item 87 第一阶段 —— 知识卡片/引用记录的单一读写入口。
 *
 * 钉（HK-01，方案 §5.2/§6）：
 * - 钉①卡片 schema：缺来源（sourceId/sourceName/sourceUrl）、来源日期（sourceDate）、
 *   有效期（validUntil）、结论、领域、未知证据等级/时效分级 → 一律拒绝入库。
 * - 钉②引用验真：verify.status !== 'verified' 的引用记录拒绝入库——
 *   「验不过拒绝入库」，绝不「先留着」。
 * - append-only：表层触发器兜底（schema.js），本 store 不提供任何 update/delete；
 *   修订走 supersedeKnowledgeCard 追加新卡（revision_of 指向旧卡）。
 *
 * 契约：insert/supersede 返回 { ok, cardId?, error? }；list 返回驼峰投影数组。
 */

const crypto = require('crypto');
const { DO_CONTRACT_VERSION } = require('./do-knowledge-schema');

const EVIDENCE_LEVELS = Object.freeze(['official', 'peer-reviewed', 'preprint', 'community']);
const FRESHNESS_CLASSES = Object.freeze(['stable', 'fast']);
const MAX_CONCLUSION_CHARS = 4000;
const MAX_TEXT_FIELD_CHARS = 300;

function fail(error) {
  return { ok: false, error };
}

function newId(prefix) {
  const random = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
  return `${prefix}_${random}`;
}

function nowIso() {
  return new Date().toISOString();
}

function isoDateOrNull(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return value.trim().slice(0, 10);
}

function cleanText(value, maxChars) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxChars) return null;
  return trimmed;
}

/**
 * 钉①语义校验。返回 { ok, error? }。日期字段必须是可解析 ISO 日期，
 * validUntil 必须晚于 sourceDate（有效期早于来源日期=写反了）。
 */
function validateKnowledgeCard(card) {
  if (!card || typeof card !== 'object') return fail('卡片输入缺失');
  if (!cleanText(card.domain, MAX_TEXT_FIELD_CHARS)) return fail('领域（domain）缺失');
  if (!cleanText(card.topic, MAX_TEXT_FIELD_CHARS)) return fail('主题（topic）缺失');
  if (!cleanText(card.conclusion, MAX_CONCLUSION_CHARS)) return fail('结论（conclusion）缺失或超限');
  if (!EVIDENCE_LEVELS.includes(card.evidenceLevel)) {
    return fail(`证据等级未知：${card.evidenceLevel}（允许 ${EVIDENCE_LEVELS.join('/')}）`);
  }
  if (!FRESHNESS_CLASSES.includes(card.freshnessClass)) {
    return fail(`时效分级未知：${card.freshnessClass}（允许 ${FRESHNESS_CLASSES.join('/')}）`);
  }
  if (!cleanText(card.sourceId, MAX_TEXT_FIELD_CHARS)) return fail('来源 ID（sourceId）缺失——领域断言无来源=红');
  if (!cleanText(card.sourceName, MAX_TEXT_FIELD_CHARS)) return fail('来源名称（sourceName）缺失');
  if (!cleanText(card.sourceUrl, MAX_TEXT_FIELD_CHARS)) return fail('来源 URL（sourceUrl）缺失');
  const sourceDate = isoDateOrNull(card.sourceDate);
  if (!sourceDate) return fail('来源日期（sourceDate）缺失或不可解析');
  const validUntil = isoDateOrNull(card.validUntil);
  if (!validUntil) return fail('有效期（validUntil）缺失或不可解析——无有效期的知识卡不允许入库');
  if (validUntil < sourceDate) return fail('有效期早于来源日期（字段写反？）');
  return { ok: true };
}

/** 入库一张知识卡。返回 { ok, cardId } 或 { ok:false, error }。 */
function insertKnowledgeCard(db, card, options = {}) {
  const check = validateKnowledgeCard(card);
  if (!check.ok) return check;
  const cardId = newId('docard');
  const createdAt = options.now || nowIso();
  db.prepare(`INSERT INTO do_knowledge_cards (
    card_id, contract_version, domain, topic, conclusion, evidence_level,
    source_id, source_name, source_url, source_date, valid_until,
    freshness_class, provenance, revision_of, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    cardId,
    DO_CONTRACT_VERSION,
    card.domain.trim(),
    card.topic.trim(),
    card.conclusion.trim(),
    card.evidenceLevel,
    card.sourceId.trim(),
    card.sourceName.trim(),
    card.sourceUrl.trim(),
    card.sourceDate.trim().slice(0, 10),
    card.validUntil.trim().slice(0, 10),
    card.freshnessClass,
    options.provenance ? JSON.stringify(options.provenance) : null,
    card.revisionOf || null,
    createdAt,
  );
  return { ok: true, cardId };
}

/**
 * 追加式修订：旧卡原样保留（append-only），新卡 revision_of 指向旧卡。
 * 旧卡必须存在，防止悬空版本链。
 */
function supersedeKnowledgeCard(db, previousCardId, newCard, options = {}) {
  const previous = db.prepare('SELECT card_id FROM do_knowledge_cards WHERE card_id = ?').get(previousCardId);
  if (!previous) return fail(`被修订卡片不存在：${previousCardId}`);
  return insertKnowledgeCard(db, { ...newCard, revisionOf: previousCardId }, options);
}

function rowToCard(row) {
  let provenance = null;
  if (row.provenance) {
    try { provenance = JSON.parse(row.provenance); } catch { provenance = null; }
  }
  return {
    cardId: row.card_id,
    contractVersion: row.contract_version,
    domain: row.domain,
    topic: row.topic,
    conclusion: row.conclusion,
    evidenceLevel: row.evidence_level,
    sourceId: row.source_id,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    sourceDate: row.source_date,
    validUntil: row.valid_until,
    freshnessClass: row.freshness_class,
    provenanceJson: provenance,
    revisionOf: row.revision_of,
    createdAt: row.created_at,
  };
}

function listKnowledgeCards(db, options = {}) {
  const where = [];
  const params = [];
  if (options.domain) { where.push('domain = ?'); params.push(options.domain); }
  if (options.topic) { where.push('topic = ?'); params.push(options.topic); }
  const sql = `SELECT * FROM do_knowledge_cards ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`;
  return db.prepare(sql).all(...params).map(rowToCard);
}

/**
 * 钉②入库：只有 verify.status === 'verified' 的引用记录才允许落库。
 * 题录（title/authors/year/container）优先用验真回填的官方记录，缺官方记录时才信调用方。
 */
function insertCitationRecord(db, record, options = {}) {
  if (!record || typeof record !== 'object') return fail('引用输入缺失');
  const doi = typeof record.doi === 'string' ? record.doi.trim().toLowerCase() : '';
  if (!/^10\.\d{4,9}\/\S+$/.test(doi)) return fail(`DOI 形态非法：${record.doi}`);
  const verify = record.verify;
  if (!verify || verify.status !== 'verified') {
    return fail(`引用验真未通过（status=${verify && verify.status || 'missing'}）——验不过拒绝入库，绝不「先留着」`);
  }
  const title = cleanText(record.title, 1000);
  if (!title) return fail('题录标题缺失');
  const registry = typeof record.registry === 'string' ? record.registry : (verify.via || 'crossref');
  const citationId = newId('docite');
  const createdAt = options.now || nowIso();
  try {
    db.prepare(`INSERT INTO do_citation_records (
      citation_id, contract_version, doi, title, authors, year, container,
      registry, verify_status, verify_detail, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      citationId,
      DO_CONTRACT_VERSION,
      doi,
      title,
      Array.isArray(record.authors) ? JSON.stringify(record.authors) : null,
      typeof record.year === 'number' ? record.year : null,
      typeof record.container === 'string' ? record.container : null,
      registry,
      'verified',
      JSON.stringify({ via: verify.via || registry, checkedAt: verify.checkedAt || createdAt }),
      createdAt,
    );
  } catch (error) {
    if (/UNIQUE constraint failed: do_citation_records\.doi/.test(String(error.message))) {
      return fail('同 DOI 已入库（append-only 唯一约束）');
    }
    throw error;
  }
  return { ok: true, citationId };
}

function listCitationRecords(db, options = {}) {
  if (options.doi) {
    return db.prepare('SELECT * FROM do_citation_records WHERE doi = ?').all(String(options.doi).toLowerCase())
      .map(rowToCitation);
  }
  return db.prepare('SELECT * FROM do_citation_records ORDER BY created_at DESC').all().map(rowToCitation);
}

function rowToCitation(row) {
  const parse = (value) => {
    if (!value) return null;
    try { return JSON.parse(value); } catch { return null; }
  };
  return {
    citationId: row.citation_id,
    contractVersion: row.contract_version,
    doi: row.doi,
    title: row.title,
    authors: parse(row.authors),
    year: row.year,
    container: row.container,
    registry: row.registry,
    verifyStatus: row.verify_status,
    verifyDetail: parse(row.verify_detail),
    createdAt: row.created_at,
  };
}

module.exports = {
  insertKnowledgeCard,
  supersedeKnowledgeCard,
  listKnowledgeCards,
  insertCitationRecord,
  listCitationRecords,
};
