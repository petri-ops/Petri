/**
 * Async PostgreSQL paths for Copilot conversations (P0 ECS platform — no deasync).
 */
const {query} = require('../db-pg');
const {v4: uuidv4} = require('uuid');

function _newConvId() {
  return 'conv_' + uuidv4().slice(0, 12);
}
function _newMsgId() {
  return 'msg_' + uuidv4().slice(0, 12);
}

async function getOrCreateActiveConversation(userId, hint) {
  if (!userId) return null;
  const projectId = hint && hint.projectId ? String(hint.projectId) : null;
  if (hint && hint.conversationId) {
    const r = projectId
      ? await query(
        `SELECT * FROM copilot_conversations
         WHERE id = $1 AND user_id = $2 AND status = 'active' AND project_id = $3`,
        [hint.conversationId, userId, projectId],
      )
      : await query(
        `SELECT * FROM copilot_conversations
         WHERE id = $1 AND user_id = $2 AND status = 'active' AND COALESCE(project_id, '') = ''`,
        [hint.conversationId, userId],
      );
    if (r.rows[0]) return r.rows[0];
  }
  const recent = projectId
    ? await query(
      `SELECT * FROM copilot_conversations
       WHERE user_id = $1 AND status = 'active' AND project_id = $2
       ORDER BY updated_at DESC LIMIT 1`,
      [userId, projectId],
    )
    : await query(
      `SELECT * FROM copilot_conversations
       WHERE user_id = $1 AND status = 'active' AND COALESCE(project_id, '') = ''
       ORDER BY updated_at DESC LIMIT 1`,
      [userId],
    );
  if (recent.rows[0]) return recent.rows[0];

  const id = _newConvId();
  const now = new Date().toISOString();
  const title = (hint && hint.titleHint) || '新对话';
  const lastPage = (hint && hint.page) || null;
  await query(
    `INSERT INTO copilot_conversations(id, user_id, title, status, last_page, project_id, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', $4, $5, $6, $6)`,
    [id, userId, title, lastPage, projectId, now],
  );
  const row = await query('SELECT * FROM copilot_conversations WHERE id = $1', [id]);
  return row.rows[0];
}

async function appendMessageToConversation(conversationId, role, content, meta) {
  if (!conversationId || !content) return null;
  const id = _newMsgId();
  const ts = new Date().toISOString();
  await query(
    `INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, conversationId, role, String(content).slice(0, 30000), JSON.stringify(meta || {}), ts],
  );
  await query(
    `UPDATE copilot_conversations SET message_count = message_count + 1, updated_at = $1,
     last_page = COALESCE($2, last_page) WHERE id = $3`,
    [ts, (meta && meta.page) || null, conversationId],
  );
  return id;
}

module.exports = {
  getOrCreateActiveConversation,
  appendMessageToConversation,
};
