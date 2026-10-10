/**
 * helpers/chat-summary.js — CHAT_SUMMARY_v1
 *
 * Extracted from server.js (Phase 8.6 helper modularization).
 * Persists through ./db and delegates model work to the shared Gateway.
 *
 * Public API:
 *   getChatSummaryAsync(userId, projectId)            → Promise<row|null>
 *   saveChatSummaryAsync(userId, projectId, s, count) → Promise<void>
 *   deleteChatSummaryAsync(userId, projectId)         → Promise<void>
 *   summarizeMessages(userId, projectId, oldMessages, existingSummary) → Promise<void>
 *   SUMMARY_TRIGGER_AT, SUMMARY_KEEP_RECENT
 *
 * Async helpers use the Promise facade over desktop SQLite.
 */

const dbMod = require('../db');

// One-time table create (idempotent — safe to re-run on every server boot)
let _tableChecked = false;
async function _ensureTable() {
  if (_tableChecked) return;
  _tableChecked = true;
  const adb = dbMod.getAsyncDatabase();
  try {
    await adb.exec(`
      CREATE TABLE IF NOT EXISTS project_chat_summaries (
        user_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL,
        msg_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, project_id)
      );
    `);
    // Legacy summaries had one row per user. Preserve them only in the
    // project-less scope; never inject them into a concrete project.
    try {
      await adb.exec(`
        INSERT OR IGNORE INTO project_chat_summaries(user_id, project_id, summary, msg_count, updated_at)
        SELECT user_id, '', summary, msg_count, updated_at FROM chat_summaries
      `);
    } catch {}
  } catch {
    /* ignore */
  }
}

function _scopeKey(projectId) {
  return projectId ? String(projectId) : '';
}

async function getChatSummaryAsync(userId, projectId = null) {
  if (!userId) return null;
  await _ensureTable();
  const adb = dbMod.getAsyncDatabase();
  const row = await adb
    .prepare('SELECT summary, msg_count, updated_at FROM project_chat_summaries WHERE user_id = ? AND project_id = ?')
    .get(userId, _scopeKey(projectId));
  return row || null;
}

async function saveChatSummaryAsync(userId, projectId, summary, msgCount) {
  if (!userId) return;
  await _ensureTable();
  const adb = dbMod.getAsyncDatabase();
  await adb
    .prepare(
      `
    INSERT INTO project_chat_summaries(user_id, project_id, summary, msg_count, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, project_id) DO UPDATE SET summary=excluded.summary, msg_count=excluded.msg_count, updated_at=excluded.updated_at
  `
    )
    .run(userId, _scopeKey(projectId), summary, msgCount, new Date().toISOString());
}

async function deleteChatSummaryAsync(userId, projectId = null) {
  if (!userId) return;
  await _ensureTable();
  const adb = dbMod.getAsyncDatabase();
  await adb.prepare('DELETE FROM project_chat_summaries WHERE user_id = ? AND project_id = ?').run(userId, _scopeKey(projectId));
}

/**
 * Compress older messages into a Chinese summary using the summary role.
 * Fire-and-forget; errors swallowed.
 */
async function summarizeMessages(userId, projectId, oldMessages, existingSummary) {
  if (!userId || !Array.isArray(oldMessages) || oldMessages.length === 0) return;

  const lines = oldMessages
    .map((m) => {
      const role = m.role === 'user' ? '用户' : 'AI';
      return role + ': ' + (m.content || '');
    })
    .join('\n\n');

  const sysPrompt =
    '你是对话归档助手。把下面这段较早的对话压缩成中文要点摘要，保留：用户研究的对象、关心的问题、关键结论、用过的参数、提到过的实体（cluster id、基因名、数据集名等）。\n\n要求：\n- 不超过 500 字\n- 用 "- " 列出，每点一句话\n- 时间顺序保留\n- 如果与已有摘要有重复，合并而非简单拼接\n- 保留专有名词和数字 精确';

  const userPrompt = existingSummary
    ? '已有摘要：\n' + existingSummary + '\n\n新增对话：\n' + lines + '\n\n请输出合并后的新摘要。'
    : '请总结以下对话：\n' + lines;

  const { callModelTask } = require('./model-tasks');
  const result = await callModelTask({
    role: 'summary',
    messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    maxTokens: 800,
    telemetry: { userId, kind: 'chat_summary' },
  });
  if (!result.text) return;
  try {
    await saveChatSummaryAsync(
      userId,
      projectId,
      result.text,
      oldMessages.length + (existingSummary ? -1 : 0)
    );
    console.log('[chat-summary] saved for scope', _scopeKey(projectId) || 'global', 'len=', result.text.length);
  } catch (e) {
    console.log('[chat-summary-err]', e && e.message);
  }
}

const SUMMARY_TRIGGER_AT = 22; // start summarizing once thread has > N msgs
const SUMMARY_KEEP_RECENT = 14; // keep this many recent msgs as raw context

// Sync wrapper for in-process callers using the same SQLite database.
function getChatSummary(userId, projectId = null) {
  if (!userId) return null;
  const sqlite = dbMod.getDatabase();
  try {
    // Guard: ensure table exists (idempotent — ignore errors from re-creating)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS project_chat_summaries (
        user_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL,
        msg_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, project_id)
      );
    `);
    const row = sqlite
      .prepare('SELECT summary, msg_count, updated_at FROM project_chat_summaries WHERE user_id = ? AND project_id = ?')
      .get(userId, _scopeKey(projectId));
    return row || null;
  } catch {
    return null;
  }
}

module.exports = {
  getChatSummaryAsync,
  getChatSummary, // SYNC_BRIDGE_v1
  saveChatSummaryAsync,
  deleteChatSummaryAsync,
  summarizeMessages,
  SUMMARY_TRIGGER_AT,
  SUMMARY_KEEP_RECENT,
};
