/**
 * helpers/chat-summary.js — CHAT_SUMMARY_v1
 *
 * Extracted from server.js (Phase 8.6 helper modularization).
 * Pure module: depends only on ./db and process.env.DEEPSEEK_API_KEY.
 *
 * Public API:
 *   getChatSummaryAsync(userId)            → Promise<row|null>
 *   saveChatSummaryAsync(userId, s, count) → Promise<void>
 *   deleteChatSummaryAsync(userId)         → Promise<void>
 *   summarizeMessages(userId, oldMessages, existingSummary) → Promise<void>
 *   SUMMARY_TRIGGER_AT, SUMMARY_KEEP_RECENT
 *
 * 2026-06-09: async DB (getAsyncDbForLegacyModules) — no deasync on ECS platform.
 */

const dbMod = require('../db');

// One-time table create (idempotent — safe to re-run on every server boot)
let _tableChecked = false;
async function _ensureTable() {
  if (_tableChecked) return;
  _tableChecked = true;
  const adb = dbMod.getAsyncDbForLegacyModules();
  try {
    await adb.exec(`
      CREATE TABLE IF NOT EXISTS chat_summaries (
        user_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        msg_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);
  } catch {
    /* ignore */
  }
}

async function getChatSummaryAsync(userId) {
  if (!userId) return null;
  await _ensureTable();
  const adb = dbMod.getAsyncDbForLegacyModules();
  const row = await adb
    .prepare('SELECT summary, msg_count, updated_at FROM chat_summaries WHERE user_id = $1')
    .get(userId);
  return row || null;
}

async function saveChatSummaryAsync(userId, summary, msgCount) {
  if (!userId) return;
  await _ensureTable();
  const adb = dbMod.getAsyncDbForLegacyModules();
  await adb
    .prepare(
      `
    INSERT INTO chat_summaries(user_id, summary, msg_count, updated_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT(user_id) DO UPDATE SET summary=excluded.summary, msg_count=excluded.msg_count, updated_at=excluded.updated_at
  `
    )
    .run(userId, summary, msgCount, new Date().toISOString());
}

async function deleteChatSummaryAsync(userId) {
  if (!userId) return;
  await _ensureTable();
  const adb = dbMod.getAsyncDbForLegacyModules();
  await adb.prepare('DELETE FROM chat_summaries WHERE user_id = $1').run(userId);
}

/**
 * Compress older messages into a Chinese summary using DeepSeek.
 * Fire-and-forget; errors swallowed.
 */
async function summarizeMessages(userId, oldMessages, existingSummary) {
  const { getApiKey } = require('./ai-settings');
  const apiKey = getApiKey('deepseek');
  if (!apiKey || !userId || !Array.isArray(oldMessages) || oldMessages.length === 0) return;

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

  const body = JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt },
    ],
    stream: false,
    temperature: 0.3,
    max_tokens: 800,
  });

  return new Promise((resolve) => {
    const https = require('https');
    let buf = '';
    const r = https.request(
      {
        hostname: 'api.deepseek.com',
        port: 443,
        path: '/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
          'Content-Length': Buffer.byteLength(body),
        },
        agent: false,
        timeout: 90000,
      },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (c) => {
          buf += c;
        });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              resolve();
              return;
            }
            const j = JSON.parse(buf);
            const text = j?.choices?.[0]?.message?.content;
            if (text && text.trim()) {
              saveChatSummaryAsync(
                userId,
                text.trim(),
                oldMessages.length + (existingSummary ? -1 : 0)
              )
                .then(() => {
                  console.log('[chat-summary] saved for user', userId, 'len=', text.length);
                })
                .catch((e) => console.log('[chat-summary-err]', e && e.message));
            }
          } catch (e) {
            console.log('[chat-summary-err]', e && e.message);
          }
          resolve();
        });
        res.on('error', () => resolve());
      }
    );
    r.on('error', () => resolve());
    r.on('timeout', () => {
      try {
        r.destroy();
      } catch {}
      resolve();
    });
    r.write(body);
    r.end();
  });
}

const SUMMARY_TRIGGER_AT = 22; // start summarizing once thread has > N msgs
const SUMMARY_KEEP_RECENT = 14; // keep this many recent msgs as raw context

// SYNC_BRIDGE_v1: sync wrapper for Dell (non-PG) path.
// The async version always goes through getAsyncDbForLegacyModules.
// The sync version uses the same underlying SQLite directly — no deasync.
function getChatSummary(userId) {
  if (!userId) return null;
  const sqlite = dbMod.getSqliteForLegacyModules();
  try {
    // Guard: ensure table exists (idempotent — ignore errors from re-creating)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS chat_summaries (
        user_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        msg_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);
    const row = sqlite
      .prepare('SELECT summary, msg_count, updated_at FROM chat_summaries WHERE user_id = ?')
      .get(userId);
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
