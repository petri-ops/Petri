'use strict';

/**
 * shared-backend/message-rating-store.js
 *
 * BLOCK-246 C4 —— 消息评价读写（单一入口）。
 *
 * 语义：一条消息一行；再评价 = 覆盖；`set(key, null)` = 撤销（删行）。
 * 校验单源在这里（rating 白名单、reason ≤ 500 字、messageKey 非空），路由只翻译。
 */

const {
  MESSAGE_RATING_CONTRACT_VERSION,
  ensureMessageRatingSchema,
} = require('./message-rating-schema');

const MESSAGE_RATINGS = Object.freeze(['up', 'down']);
const MAX_MESSAGE_RATING_REASON_CHARS = 500;

function nowIso() {
  return new Date().toISOString();
}

function rowToRating(row) {
  if (!row) return null;
  return {
    messageKey: row.message_key,
    contractVersion: Number(row.contract_version) || MESSAGE_RATING_CONTRACT_VERSION,
    conversationId: row.conversation_id || null,
    projectId: row.project_id || null,
    rating: row.rating,
    reason: row.reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createMessageRatingStore(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('[message-rating-store] db instance with prepare() is required');
  }
  if (options.ensureSchema !== false) ensureMessageRatingSchema(db);

  const getStatement = db.prepare('SELECT * FROM message_ratings WHERE message_key = ?');
  const deleteStatement = db.prepare('DELETE FROM message_ratings WHERE message_key = ?');
  const upsertStatement = db.prepare(`
    INSERT INTO message_ratings (
      message_key, contract_version, conversation_id, project_id, rating, reason,
      created_at, updated_at
    ) VALUES (
      @message_key, @contract_version, @conversation_id, @project_id, @rating, @reason,
      @created_at, @updated_at
    )
    ON CONFLICT(message_key) DO UPDATE SET
      rating = @rating,
      reason = @reason,
      conversation_id = @conversation_id,
      project_id = @project_id,
      updated_at = @updated_at
  `);

  /**
   * 设置/覆盖/撤销一条评价。
   * @returns {{ok: true, rating: object|null} | {ok: false, error: string}}
   */
  function set(input) {
    if (!input || typeof input !== 'object') return { ok: false, error: '评价内容缺失' };
    const messageKey = typeof input.messageKey === 'string' ? input.messageKey.trim() : '';
    if (!messageKey) return { ok: false, error: '缺少消息标识，无法评价' };

    if (input.rating === null || input.rating === undefined || input.rating === '') {
      deleteStatement.run(messageKey);
      return { ok: true, rating: null };
    }
    const rating = String(input.rating);
    if (!MESSAGE_RATINGS.includes(rating)) {
      return { ok: false, error: `评价取值不支持：${rating}（只接受 up / down）` };
    }
    const rawReason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (Array.from(rawReason).length > MAX_MESSAGE_RATING_REASON_CHARS) {
      return { ok: false, error: `评价理由过长：上限 ${MAX_MESSAGE_RATING_REASON_CHARS} 字` };
    }
    const existing = getStatement.get(messageKey);
    const timestamp = nowIso();
    upsertStatement.run({
      message_key: messageKey,
      contract_version: MESSAGE_RATING_CONTRACT_VERSION,
      conversation_id: typeof input.conversationId === 'string' && input.conversationId ? input.conversationId : null,
      project_id: typeof input.projectId === 'string' && input.projectId ? input.projectId : null,
      rating,
      reason: rawReason || null,
      created_at: existing ? existing.created_at : timestamp,
      updated_at: timestamp,
    });
    return { ok: true, rating: rowToRating(getStatement.get(messageKey)) };
  }

  function get(messageKey) {
    if (typeof messageKey !== 'string' || !messageKey) return null;
    return rowToRating(getStatement.get(messageKey));
  }

  function clear(messageKey) {
    if (typeof messageKey !== 'string' || !messageKey) return false;
    return deleteStatement.run(messageKey).changes > 0;
  }

  return { set, get, clear };
}

module.exports = {
  MESSAGE_RATINGS,
  MAX_MESSAGE_RATING_REASON_CHARS,
  createMessageRatingStore,
};
