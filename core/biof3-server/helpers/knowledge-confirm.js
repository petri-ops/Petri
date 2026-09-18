'use strict';

/**
 * helpers/knowledge-confirm.js — BLOCK-99 G4 破坏性操作确认令牌（D4 会话驱动同门）
 *
 * 手动 UI 的删空间/清空/批量删除走两步确认弹层；会话驱动触发时同门由本存储 +
 * 工具层协议共同承载：第一次调用（无 token）→ 服务端签发一次性 confirmToken 并
 * 如实返回影响面，模型须向用户复述影响面、等待用户下一条消息明确确认后才能凭
 * token 重调执行。无 token / 错 token / 过期 / 复用 / 主体错配一律拒绝执行。
 *
 * 内存态即可：单进程后端；重启即清空 = fail-closed（须重新取影响面重新确认）。
 */

const TTL_MS = 10 * 60 * 1000; // 10 分钟内有效，过期须重新走确认链
const MAX_PENDING = 64; // 防滥用上限；超限拒绝签发（极不可能触达）

const _pending = new Map(); // token -> { action, subject, impact, issuedAt }

function _pruneExpired() {
  const now = Date.now();
  for (const [token, entry] of _pending) {
    if (now - entry.issuedAt > TTL_MS) _pending.delete(token);
  }
}

/**
 * 为一次破坏性操作签发确认令牌。
 * @param {string} action  操作名（如 'knowledge_space_delete'）
 * @param {string} subject 操作主体键（如 spaceId 或 docIds 排序串接 hash 键）
 * @param {object} impact  影响面快照（诚实列出的将级联删除量）
 * @returns {{ confirmToken: string, expiresInSeconds: number }}
 */
function issueConfirmToken(action, subject, impact) {
  _pruneExpired();
  if (_pending.size >= MAX_PENDING) {
    const err = new Error('too many pending confirmations');
    err.code = 'confirm_pending_overflow';
    throw err;
  }
  const token = `kc_${require('crypto').randomBytes(12).toString('hex')}`;
  _pending.set(token, { action, subject, impact, issuedAt: Date.now() });
  return { confirmToken: token, expiresInSeconds: Math.floor(TTL_MS / 1000) };
}

/**
 * 校验并消费令牌（一次性）。任何不匹配都拒绝且不销毁令牌
 * （错手输入不该烧掉用户已确认的令牌；只有匹配执行才消费）。
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function consumeConfirmToken(token, action, subject) {
  const cleaned = String(token || '').trim();
  if (!cleaned) return { ok: false, reason: 'confirm_token_required' };
  const entry = _pending.get(cleaned);
  if (!entry) return { ok: false, reason: 'confirm_token_invalid_or_expired' };
  if (Date.now() - entry.issuedAt > TTL_MS) {
    _pending.delete(cleaned);
    return { ok: false, reason: 'confirm_token_invalid_or_expired' };
  }
  if (entry.action !== action || entry.subject !== subject) {
    return { ok: false, reason: 'confirm_token_subject_mismatch' };
  }
  _pending.delete(cleaned);
  return { ok: true };
}

/** 测试/运维探针：当前待确认数 */
function pendingConfirmCount() {
  _pruneExpired();
  return _pending.size;
}

module.exports = { issueConfirmToken, consumeConfirmToken, pendingConfirmCount, TTL_MS };
