'use strict';

/**
 * helpers/incident-log.js — EVO-1 Harness 自观测 incident 写入咽喉（incidents 表，best-effort）。
 *
 * 定性：用户机器上运行的 harness 自己观测自身失败的本地台账入口，零外发、用户可查可删。
 * 与 funnel-log.js / decision-log.js 同构（懒取 DB + 白名单门 + 全吞 fail-soft + DEBUG 门）。
 *
 * 契约：
 *  - recordIncident({source, errorCode, tool, phase, message, context})：同步 fire-and-forget，
 *    调用方不 await、不改签名；任何失败（DB 不可用/语句错）静默跳过，永不阻断 agent 主链。
 *  - 白名单 source=INCIDENT_SOURCES（fatal/tool_failure/sse_reason/stall/reject），非白名单静默跳过。
 *  - 脱敏：message 先经 normalizeIncidentFingerprint()（共享纯函数），raw 不落盘。
 *  - 可观测：写入失败计入内存计数 incidentWriteStats()；DEBUG 门下同时落 shared-backend/error-log
 *    （append-only JSONL，零外发），避免「证据链静默缺失」。
 *  - 测试经 _setIncidentDb 注入句柄、_resetIncidentStats 清零计数。
 */

const { normalizeIncidentFingerprint } = require('../../shared-backend/incident-fingerprint.js');

/** 允许的观测来源白名单（与 migration 023 注释 + plan §2.2 五类一致）。 */
const INCIDENT_SOURCES = Object.freeze([
  'fatal', 'tool_failure', 'sse_reason', 'stall', 'reject'
]);

let _cachedDb = null;
let _writeFailures = 0;

function getDb() {
  if (_cachedDb) return _cachedDb;
  _cachedDb = require('../db').getDatabase(); // better-sqlite3 同步句柄，单源（与 funnel-log 同库）
  return _cachedDb;
}

/** 测试注入：替换懒取句柄。 */
function _setIncidentDb(db) { _cachedDb = db; }

/** 测试注入：清零失败计数。 */
function _resetIncidentStats() { _writeFailures = 0; }

/**
 * 记一条 incident（best-effort；永不 throw；白名单门 + 脱敏）。
 * @param {object} e
 * @param {string} e.source - 来源（须在 INCIDENT_SOURCES 白名单）
 * @param {string} [e.errorCode] - 错误码/reasonCode
 * @param {string} [e.tool] - 关联工具名
 * @param {string} [e.phase] - 阶段
 * @param {string} [e.message] - 原始错误消息（会被脱敏归一化，raw 不落库）
 * @param {{conversationId?: string, taskId?: string}} [e.context] - 上下文
 */
function recordIncident(e = {}) {
  try {
    const source = e.source;
    if (typeof source !== 'string' || !INCIDENT_SOURCES.includes(source)) return;
    const { fingerprint, normalized } = normalizeIncidentFingerprint({
      source,
      errorCode: e.errorCode,
      tool: e.tool,
      message: typeof e.message === 'string' ? e.message : ''
    });
    const ctx = e.context && typeof e.context === 'object' ? e.context : {};
    const conv = ctx.conversationId == null ? null : String(ctx.conversationId);
    getDb()
      .prepare(
        `INSERT INTO incidents (fingerprint, source, error_code, tool, phase, normalized, conversation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        fingerprint,
        source,
        e.errorCode == null ? null : String(e.errorCode),
        e.tool == null ? null : String(e.tool),
        e.phase == null ? null : String(e.phase),
        normalized,
        conv,
        new Date().toISOString()
      );
  } catch (err) {
    _writeFailures += 1;
    if (process.env.EVO_DEBUG) {
      try {
        require('../../shared-backend/error-log.js').logError('incident_log_write_failed', err, {
          source: e && e.source
        });
      } catch { /* 二次抛错豁免（decision-log BLOCK-394 B-08 先例） */ }
    }
  }
}

/** 观测出口：写入失败计数（含总数）。 */
function incidentWriteStats() {
  return { failures: _writeFailures };
}

module.exports = {
  INCIDENT_SOURCES,
  recordIncident,
  incidentWriteStats,
  _setIncidentDb,
  _resetIncidentStats
};
