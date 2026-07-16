/**
 * helpers/conversations.js — CONVERSATIONS_v1 + AUTO_TITLE_v1 + TOPIC_SHIFT_v1
 *
 * Extracted from server.js. Pure module: depends on ../db, uuid, and
 * process.env.DEEPSEEK_API_KEY (for auto-title and topic-shift).
 *
 * Public API:
 *   getOrCreateActiveConversation(userId, hint)
 *   appendMessageToConversation(conversationId, role, content, meta)
 *   _maybeAutoTitleConversation(conversationId, userId)  (async fire-and-forget)
 *   _maybeDetectTopicShift(conversationId, userId)       (async, returns null|{shifted, reason})
 */

const dbMod = require('../db');
const sqlite = dbMod.getSqliteForLegacyModules();
const {v4: uuidv4} = require('uuid');

// One-time table create + migrations (idempotent)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS copilot_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '新对话',
    status TEXT NOT NULL DEFAULT 'active',
    last_page TEXT,
    project_id TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conv_user ON copilot_conversations(user_id, status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_conv_project ON copilot_conversations(user_id, project_id, status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS copilot_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    meta_json TEXT,
    ts TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_msg_conv_ts ON copilot_messages(conversation_id, ts ASC);
`);
try { sqlite.exec('ALTER TABLE memory_vectors ADD COLUMN conversation_id TEXT'); } catch {}
try { sqlite.exec('ALTER TABLE copilot_conversations ADD COLUMN project_id TEXT'); } catch {}
try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_conv_project ON copilot_conversations(user_id, project_id, status, updated_at DESC)'); } catch {}
try { sqlite.exec('ALTER TABLE copilot_conversations ADD COLUMN last_topic_shift_at TEXT'); } catch {}
try { sqlite.exec('ALTER TABLE copilot_conversations ADD COLUMN last_topic_shift_reason TEXT'); } catch {}

function _newConvId() { return 'conv_' + uuidv4().slice(0, 12); }
function _newMsgId() { return 'msg_' + uuidv4().slice(0, 12); }

function getOrCreateActiveConversation(userId, hint) {
  const projectId = hint && hint.projectId ? String(hint.projectId) : null;
  if (hint && hint.conversationId) {
    const row = projectId
      ? sqlite.prepare("SELECT * FROM copilot_conversations WHERE id=? AND user_id=? AND status='active' AND project_id=?").get(hint.conversationId, userId, projectId)
      : sqlite.prepare("SELECT * FROM copilot_conversations WHERE id=? AND user_id=? AND status='active' AND COALESCE(project_id, '')=''").get(hint.conversationId, userId);
    if (row) return row;
  }
  const recent = projectId
    ? sqlite.prepare("SELECT * FROM copilot_conversations WHERE user_id=? AND status='active' AND project_id=? ORDER BY updated_at DESC LIMIT 1").get(userId, projectId)
    : sqlite.prepare("SELECT * FROM copilot_conversations WHERE user_id=? AND status='active' AND COALESCE(project_id, '')='' ORDER BY updated_at DESC LIMIT 1").get(userId);
  if (recent) return recent;

  const id = _newConvId();
  const now = new Date().toISOString();
  const title = (hint && hint.titleHint) || '新对话';
  sqlite.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, last_page, project_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, userId, title, 'active', (hint && hint.page) || null, projectId, now, now);
  return sqlite.prepare('SELECT * FROM copilot_conversations WHERE id=?').get(id);
}

function appendMessageToConversation(conversationId, role, content, meta) {
  if (!conversationId || !content) return null;
  const id = _newMsgId();
  const ts = new Date().toISOString();
  sqlite.prepare('INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?,?)')
    .run(id, conversationId, role, String(content).slice(0, 30000), JSON.stringify(meta || {}), ts);
  sqlite.prepare('UPDATE copilot_conversations SET message_count = message_count + 1, updated_at=?, last_page=COALESCE(?, last_page) WHERE id=?')
    .run(ts, (meta && meta.page) || null, conversationId);
  return id;
}

// ============================================================
// AUTO_TITLE_v1
// ============================================================
async function _maybeAutoTitleConversation(conversationId, userId) {
  if (!conversationId || !userId) return;
  try {
    const conv = sqlite.prepare('SELECT id, title, message_count FROM copilot_conversations WHERE id=? AND user_id=?').get(conversationId, userId);
    if (!conv) return;
    const isDefaultTitle = !conv.title
      || conv.title === '新对话'
      || /^\[[^\]]+\]/.test(conv.title)
      || conv.title.length > 24;
    if (!isDefaultTitle) return;
    if ((conv.message_count || 0) < 2) return;
    const msgs = sqlite.prepare('SELECT role, content FROM copilot_messages WHERE conversation_id=? ORDER BY ts ASC LIMIT 4').all(conversationId);
    if (!msgs || msgs.length < 2) return;
    const userBits = msgs.filter(m => m.role === 'user').map(m => String(m.content || '').slice(0, 200)).join(' / ');
    const assistantBits = msgs.filter(m => m.role === 'assistant').map(m => String(m.content || '').replace(/```[\s\S]*?```/g, '').slice(0, 300)).join(' / ');
    if (!userBits) return;

    const prompt = '基于以下用户提问和助手回答，生成一个 6 到 12 个字的中文短标题，概括对话核心。不要标点，不要引号，直接输出标题文本。\n\n用户：' + userBits + '\n助手：' + assistantBits;
    const { getApiKey } = require('./ai-settings');
    const apiKey = getApiKey('deepseek');
    if (!apiKey) return;
    const fetchFn = (typeof fetch === 'function') ? fetch : require('node-fetch');
    const resp = await fetchFn('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {'Content-Type':'application/json', 'Authorization':'Bearer ' + apiKey},
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {role:'system', content:'你只输出标题文本，不超过 12 个汉字，不带任何标点。'},
          {role:'user', content: prompt},
        ],
        temperature: 0.3,
        max_tokens: 32,
        stream: false,
      }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    let title = (((data || {}).choices || [])[0] || {}).message;
    title = String((title && title.content) || '').trim();
    title = title.replace(/^[\s"\u201c\u201d''\u300c\u300d]+|[\s"\u201c\u201d''\u300c\u300d]+$/g, '');
    title = title.replace(/[\r\n]/g, ' ').slice(0, 18);
    if (!title) return;

    const conv2 = sqlite.prepare('SELECT title FROM copilot_conversations WHERE id=?').get(conversationId);
    if (!conv2) return;
    const stillDefault = !conv2.title
      || conv2.title === '新对话'
      || /^\[[^\]]+\]/.test(conv2.title)
      || conv2.title.length > 24;
    if (!stillDefault) return;
    sqlite.prepare('UPDATE copilot_conversations SET title=?, updated_at=? WHERE id=?').run(title, new Date().toISOString(), conversationId);
    console.log('[auto-title] conv=' + conversationId + ' → ' + title);
  } catch (e) {
    console.warn('[auto-title] failed:', e && e.message || e);
  }
}

// ============================================================
// TOPIC_SHIFT_v1
// ============================================================
const _TOPIC_CHECK_EVERY = 5;
const _TOPIC_COOLDOWN_MS = 60 * 60 * 1000;

async function _maybeDetectTopicShift(conversationId, userId) {
  if (!conversationId || !userId) return null;
  try {
    const conv = sqlite.prepare('SELECT id, message_count, last_topic_shift_at FROM copilot_conversations WHERE id=? AND user_id=?').get(conversationId, userId);
    if (!conv) return null;
    if ((conv.message_count || 0) < _TOPIC_CHECK_EVERY * 2) return null;
    if ((conv.message_count || 0) % _TOPIC_CHECK_EVERY !== 0) return null;
    if (conv.last_topic_shift_at) {
      const ts = Date.parse(conv.last_topic_shift_at);
      if (Date.now() - ts < _TOPIC_COOLDOWN_MS) return null;
    }

    const recent = sqlite.prepare('SELECT role, content FROM copilot_messages WHERE conversation_id=? ORDER BY ts DESC LIMIT 12').all(conversationId);
    if (!recent || recent.length < 6) return null;
    recent.reverse();
    const earlier = recent.slice(0, recent.length - 4).map(m => m.role + ': ' + String(m.content || '').slice(0, 200)).join('\n');
    const latest = recent.slice(-4).map(m => m.role + ': ' + String(m.content || '').slice(0, 200)).join('\n');
    if (!earlier || !latest) return null;

    const { getApiKey } = require('./ai-settings');
    const apiKey = getApiKey('deepseek');
    if (!apiKey) return null;
    const fetchFn = (typeof fetch === 'function') ? fetch : require('node-fetch');
    const resp = await fetchFn('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {'Content-Type':'application/json', 'Authorization':'Bearer ' + apiKey},
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {role:'system', content:'你判断对话是否换了主题。只回答 JSON：{"shifted":true|false,"reason":"≤30字"}。如果近期对话明显在讨论一个**与之前完全不同**的新话题（不是同主题的延伸），shifted=true；否则 false。模糊不清就 false。'},
          {role:'user', content:'之前的对话：\n' + earlier + '\n\n刚刚的对话：\n' + latest},
        ],
        temperature: 0.1,
        max_tokens: 100,
        response_format: {type: 'json_object'},
        stream: false,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const raw = (((data || {}).choices || [])[0] || {}).message;
    const txt = String((raw && raw.content) || '').trim();
    let parsed;
    try { parsed = JSON.parse(txt); } catch { return null; }
    if (!parsed || !parsed.shifted) return null;
    const reason = String(parsed.reason || '话题已切换').slice(0, 60);
    sqlite.prepare('UPDATE copilot_conversations SET last_topic_shift_at=?, last_topic_shift_reason=? WHERE id=?')
      .run(new Date().toISOString(), reason, conversationId);
    console.log('[topic-shift] conv=' + conversationId + ' → ' + reason);
    return {shifted: true, reason};
  } catch (e) {
    console.warn('[topic-shift] failed:', e && e.message || e);
    return null;
  }
}

module.exports = {
  getOrCreateActiveConversation,
  appendMessageToConversation,
  _maybeAutoTitleConversation,
  _maybeDetectTopicShift,
};
