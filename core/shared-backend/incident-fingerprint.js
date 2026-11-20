'use strict';

/**
 * EVO-0 — Harness 自进化 incident 归一化/脱敏纯函数。
 * 职责边界：只做字符串脱敏 + 归一化 + fingerprint 计算，不碰 DB / 网络 / 计时 / 文件。
 * 为什么在此层：Observe 的每个 catch 点都要用同一套归一化把「同类错误」聚到同一个键，
 * 且落库前必须先脱敏——这是自进化全链的第一道隐私与聚类关口，必须是无副作用纯函数。
 */

const { createHash } = require('node:crypto');

/** 有界策略（冻结常量）。 */
const INCIDENT_LIMITS = Object.freeze({
  maxRawLength: 4096,
  hashAlgorithm: 'sha256'
});

/**
 * 脱敏规则：顺序敏感——先密钥/令牌，再邮箱/会话 id，再时间戳/临时路径。
 * 每条 [RegExp, replacement]，全局匹配。
 */
const REDACTIONS = Object.freeze([
  [/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED_KEY]'],
  [/(?:api[_-]?key|token|secret|password)[\s:=]+[A-Za-z0-9._-]{6,}/gi, '[REDACTED_SECRET]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]'],
  [/conv_[A-Za-z0-9_-]{4,}/g, '[REDACTED_CONV]'],
  [/task_[A-Za-z0-9_-]{4,}/g, '[REDACTED_TASK]']
].map(([re, rep]) => Object.freeze([re, rep])));

/** 归一化规则：把易变的上下文（时间戳/路径/数字/hex）折叠成占位符，便于聚类。 */
const NORMALIZATIONS = Object.freeze([
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<time>'],
  [/(?:\/var\/folders\/[^\s]+|\/tmp\/[^\s]+|\/[^\s]*\/(?:node_modules|petri-agent-tmp)\/[^\s]+)/g, '<path>'],
  [/[A-Za-z]:\\\\[^\s]+/g, '<path>'],
  [/\b[0-9a-f]{8,}\b/gi, '<hex>'],
  [/\b\d+\b/g, '<n>']
].map(([re, rep]) => Object.freeze([re, rep])));

/**
 * 对一段文本做脱敏（纯字符串操作，不修改入参）。
 * @param {string} text
 * @returns {string}
 */
function redactText(text) {
  if (typeof text !== 'string') return '';
  let out = text;
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  return out;
}

/**
 * 对一个对象做脱敏：只处理字符串字段（含嵌套一层），其余原样浅拷贝。
 * @param {object} payload
 * @returns {object}
 */
function redactIncidentPayload(payload = {}) {
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') out[key] = redactText(value);
    else if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = redactIncidentPayload(value);
    else out[key] = value;
  }
  return out;
}

/**
 * 归一化文本：先脱敏，再折叠易变上下文，最后有界截断。
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  const bounded = (typeof text === 'string' ? text : '').slice(0, INCIDENT_LIMITS.maxRawLength);
  let out = redactText(bounded);
  for (const [re, rep] of NORMALIZATIONS) out = out.replace(re, rep);
  return out.slice(0, INCIDENT_LIMITS.maxRawLength);
}

/**
 * 计算稳定 fingerprint（纯函数）：由 source / errorCode / tool / 归一化 message 组合哈希。
 * 同义输入（不同会话 id / 时间戳 / 临时路径）→ 同一 fingerprint。
 * @param {object} e
 * @param {string} [e.source] - 观测来源
 * @param {string} [e.errorCode] - 错误码
 * @param {string} [e.tool] - 关联工具
 * @param {string} [e.message] - 原始错误消息（会被脱敏归一化）
 * @returns {{fingerprint: string, normalized: string}}
 */
function normalizeIncidentFingerprint(e = {}) {
  const source = typeof e.source === 'string' ? e.source : '';
  const errorCode = typeof e.errorCode === 'string' ? e.errorCode : '';
  const tool = typeof e.tool === 'string' ? e.tool : '';
  const normalized = normalizeText(e.message);
  const basis = `${source}|${errorCode}|${tool}|${normalized}`;
  const fingerprint = createHash(INCIDENT_LIMITS.hashAlgorithm).update(basis).digest('hex');
  return Object.freeze({ fingerprint, normalized });
}

module.exports = {
  INCIDENT_LIMITS,
  redactText,
  redactIncidentPayload,
  normalizeIncidentFingerprint
};
