/**
 * helpers/user-facts.js — USER_FACTS_v1 (Layer 3a structured long-term memory)
 *
 * Extracted from server.js (Phase 8.6 helper modularization).
 * Pure module: depends on ../db, uuid, and process.env.DEEPSEEK_API_KEY.
 *
 * Public API:
 *   listUserFactsAsync, getUserFactAsync, upsertUserFactAsync,
 *   deleteUserFactAsync, clearUserFactsAsync
 *   buildFactsBlockAsync(userId, maxChars)
 *   extractFactsFromMessages(messages, existingFacts) → Promise<Array>
 *   backgroundExtractFacts(userId, messages)         → Promise<void>
 *   FACT_CATEGORIES, FACT_CAT_LABEL
 *
 * Async helpers use the Promise facade over desktop SQLite.
 */

const dbMod = require('../db');
const { v4: uuidv4 } = require('uuid');

// One-time table create (idempotent)
let _tableChecked = false;
async function _ensureTable() {
  if (_tableChecked) return;
  _tableChecked = true;
  const adb = dbMod.getAsyncDatabase();  try {
    await adb.exec(`
      CREATE TABLE IF NOT EXISTS user_facts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'auto',
        project_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_facts_user ON user_facts(user_id, pinned DESC, updated_at DESC);
    `);
  } catch {
    /* ignore */
  }
  try { await adb.prepare('ALTER TABLE user_facts ADD COLUMN project_id TEXT').run(); } catch {}
  try { await adb.prepare('CREATE INDEX IF NOT EXISTS idx_user_facts_project ON user_facts(user_id, project_id, pinned DESC, updated_at DESC)').run(); } catch {}
  // BLOCK-182 — 生命周期三列幂等升级（status/superseded_by/last_confirmed_at，try/catch 已存在静默）。
  try { lifecycleEnsure()(dbMod.getDatabase()); } catch { /* 升级失败不阻塞建表 */ }
}

// 惰性 require 防初始化环（memory-lifecycle 不反向依赖本模块，但保持装配顺序自由）。
function lifecycleEnsure() {
  return require('./memory-lifecycle').ensureLifecycleColumns;
}

const FACT_CATEGORIES = [
  'research_focus',
  'preference',
  'entity',
  'task_state',
  'note',
  'learning_state',
];
const FACT_CAT_LABEL = {
  research_focus: '研究方向',
  preference: '偏好',
  entity: '关键实体',
  task_state: '任务状态',
  note: '笔记',
  learning_state: '学习状态',
};

async function listUserFactsAsync(userId, limit, projectId = null) {
  if (!userId) return [];
  await _ensureTable();
  const adb = dbMod.getAsyncDatabase();
  const scopeSql = projectId ? 'project_id = ?' : "COALESCE(project_id, '') = ''";
  const args = projectId ? [userId, String(projectId)] : [userId];
  const sql = `SELECT * FROM user_facts WHERE user_id = ? AND ${scopeSql} ORDER BY pinned DESC, updated_at DESC${limit ? ' LIMIT ?' : ''}`;
  if (limit) args.push(limit);
  const rows = await adb.prepare(sql).all(...args);
  return rows || [];
}

async function getUserFactAsync(id, userId) {
  await _ensureTable();
  const adb = dbMod.getAsyncDatabase();
  return await adb
    .prepare('SELECT * FROM user_facts WHERE id = ? AND user_id = ?')
    .get(id, userId);
}

async function upsertUserFactAsync({ id, userId, projectId = null, category, content, pinned = 0, source = 'auto' }) {
  if (!userId || !content || !category) return null;
  await _ensureTable();
  const adb = dbMod.getAsyncDatabase();
  const lifecycle = require('./memory-lifecycle');
  const sqlite = dbMod.getDatabase();
  const now = new Date().toISOString();
  const pinnedVal = pinned ? 1 : 0;
  if (id) {
    const existing = await adb
      .prepare('SELECT * FROM user_facts WHERE id = ? AND user_id = ?')
      .get(id, userId);
    if (existing) {
      // BLOCK-182 纠错流（免费直生效）：内容变化=旧事实 superseded 替代链+新行插入，
      // 不原地覆盖丢历史；同内容（pin 切换等）维持原行原地更新。
      if (String(existing.content || '').trim() !== String(content).trim()) {
        const newId = lifecycle.supersedeWithCorrection(sqlite, {
          userId, oldFactId: id, category, content: String(content), projectId: existing.project_id || projectId,
        });
        if (pinnedVal) {
          await adb.prepare('UPDATE user_facts SET pinned=? WHERE id=? AND user_id=?').run(pinnedVal, newId, userId);
        }
        return getUserFactAsync(newId, userId);
      }
      await adb
        .prepare(
          `UPDATE user_facts SET category=?, content=?, pinned=?, source=?, updated_at=? WHERE id=? AND user_id=?`
        )
        .run(category, content, pinnedVal, source, now, id, userId);
      return getUserFactAsync(id, userId);
    }
  }
  const newId = id || 'fact_' + uuidv4().slice(0, 12);
  await adb
    .prepare(
      `INSERT INTO user_facts(id, user_id, category, content, pinned, source, project_id, status, last_confirmed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'active',?,?,?)`
    )
    .run(newId, userId, category, content, pinnedVal, source, projectId ? String(projectId) : null, now, now, now);
  lifecycle.appendAudit(sqlite, {
    userId, actor: source === 'auto' ? 'system' : 'user', action: 'extract_write',
    factId: newId, detail: { category, source },
  });
  return getUserFactAsync(newId, userId);
}

async function deleteUserFactAsync(id, userId) {
  await _ensureTable();
  const adb = dbMod.getAsyncDatabase();
  await adb.prepare('DELETE FROM user_facts WHERE id = ? AND user_id = ?').run(id, userId);
}

async function clearUserFactsAsync(userId, projectId = null) {
  await _ensureTable();
  const adb = dbMod.getAsyncDatabase();
  if (projectId) {
    await adb.prepare('DELETE FROM user_facts WHERE user_id = ? AND project_id = ?').run(userId, String(projectId));
  } else {
    await adb.prepare("DELETE FROM user_facts WHERE user_id = ? AND COALESCE(project_id, '') = ''").run(userId);
  }
  // BLOCK-182 — 全链审计：清空动作留痕（删的是哪些类别随行记 note，行级历史在 llm-transcripts）。
  try {
    require('./memory-lifecycle').appendAudit(dbMod.getDatabase(), {
      userId, actor: 'user', action: 'clear', detail: { projectId: projectId || null },
    });
  } catch { /* 审计失败不阻塞 */ }
}

function _normFact(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Build a compact text block of top facts for system prompt injection.
 *  FACTS_TTL_v1 — age-aware filter so old auto-extracted facts don't pollute current convo.
 *  BLOCK-182 — 注入仅取 status='active'（superseded/decayed 不进 prompt）+ 惰性衰减顺带触发。 */
async function buildFactsBlockAsync(userId, maxChars = 1200, projectId = null) {
  // BLOCK-182 — 惰性衰减顺带触发（与 sync 版同款，读路径顺手扫）。
  try {
    require('./memory-lifecycle').lazyDecayFacts(dbMod.getDatabase(), userId);
  } catch { /* 衰减失败不阻塞注入 */ }
  const facts = await listUserFactsAsync(userId, 80, projectId);
  if (!facts || facts.length === 0) return '';
  const active = facts.filter((f) => !f.status || f.status === 'active');
  if (active.length === 0) return '';
  const now = Date.now();
  const DAY = 86400_000;
  const fresh = [];
  const aging = [];
  const old = [];
  for (const f of active) {
    if (f.pinned) {
      fresh.push(f);
      continue;
    }
    let age = 999 * DAY;
    try {
      age = now - new Date(f.updated_at).getTime();
    } catch {}
    if (age <= 30 * DAY) fresh.push(f);
    else if (age <= 90 * DAY) aging.push(f);
    else old.push(f);
  }
  const filtered = [...fresh, ...aging];
  const byCat = {};
  for (const f of filtered) {
    if (!byCat[f.category]) byCat[f.category] = [];
    byCat[f.category].push(f);
  }
  let out = '';
  let used = 0;
  for (const cat of FACT_CATEGORIES) {
    const arr = byCat[cat];
    if (!arr || arr.length === 0) continue;
    const header = '\n【' + (FACT_CAT_LABEL[cat] || cat) + '】\n';
    let block = header;
    for (const f of arr) {
      const line = '- ' + (f.pinned ? '📌 ' : '') + f.content + '\n';
      if (used + block.length + line.length > maxChars) break;
      block += line;
    }
    if (block !== header) {
      out += block;
      used += block.length;
    }
  }
  return out;
}

// Sync wrapper for in-process callers.
function buildFactsBlock(userId, maxChars = 1200, projectId = null) {
  const _adb = dbMod.getAsyncDatabase();
  const sqlite = dbMod.getDatabase();
  // BLOCK-182 — 惰性衰减顺带触发（读路径顺手扫，同 BLOCK-180 TTL 模式）。
  try {
    require('./memory-lifecycle').lazyDecayFacts(sqlite, userId);
  } catch { /* 衰减失败不阻塞注入 */ }
  let rows;
  try {
    rows = projectId
      ? sqlite.prepare('SELECT * FROM user_facts WHERE user_id = ? AND project_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT 80').all(userId, String(projectId))
      : sqlite.prepare("SELECT * FROM user_facts WHERE user_id = ? AND COALESCE(project_id, '') = '' ORDER BY pinned DESC, updated_at DESC LIMIT 80").all(userId);
  } catch {
    return '';
  }
  if (!rows || rows.length === 0) return '';
  rows = rows.filter((f) => !f.status || f.status === 'active');
  if (rows.length === 0) return '';
  const now = Date.now();
  const DAY = 86400_000;
  const fresh = [],
    aging = [];
  for (const f of rows) {
    if (f.pinned) {
      fresh.push(f);
      continue;
    }
    let age = 999 * DAY;
    try {
      age = now - new Date(f.updated_at).getTime();
    } catch {}
    if (age <= 30 * DAY) fresh.push(f);
    else if (age <= 90 * DAY) aging.push(f);
  }
  const filtered = [...fresh, ...aging];
  const byCat = {};
  for (const f of filtered) {
    if (!byCat[f.category]) byCat[f.category] = [];
    byCat[f.category].push(f);
  }
  let out = '';
  let used = 0;
  for (const cat of FACT_CATEGORIES) {
    const arr = byCat[cat];
    if (!arr || arr.length === 0) continue;
    const header = '\n【' + (FACT_CAT_LABEL[cat] || cat) + '】\n';
    let block = header;
    for (const f of arr) {
      const line = '- ' + (f.pinned ? '📌 ' : '') + f.content + '\n';
      if (used + block.length + line.length > maxChars) break;
      block += line;
    }
    if (block !== header) {
      out += block;
      used += block.length;
    }
  }
  return out;
}

/** Extract structured facts from recent messages using the summary role.
 *  Returns array of {category, content}. Background, fail-safe. */
async function extractFactsFromMessages(messages, existingFacts) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const lines = messages
    .slice(-12)
    .map((m) => {
      const role = m.role === 'user' ? '用户' : 'AI';
      return role + ': ' + (m.content || '').slice(0, 800);
    })
    .join('\n\n');

  const existingBlock =
    existingFacts && existingFacts.length > 0
      ? '\n\n已有的事实条目（避免重复，只新增有真正新增信息的）：\n' +
        existingFacts
          .slice(0, 30)
          .map((f) => '- [' + f.category + '] ' + f.content)
          .join('\n')
      : '';

  const sysPrompt =
    '你是用户档案抽取助手。从对话里提取关于用户的可复用事实，输出严格 JSON 数组。每条事实分类一个：' +
    'research_focus（研究方向，如"研究 PBMC 数据"）、preference（偏好，如"偏好 SCTransform"）、' +
    'entity（命名实体，如"cluster 5 = NK 细胞"）、task_state（任务进度，如"正在做 DEG 分析"）、' +
    'learning_state（学习状态，如"已学完 single-cell module01-03"、"对 DESeq2 dispersion 还有点模糊"）、note（其他笔记）。\n\n' +
    '严格规则：\n' +
    '- 只抽取关于用户本人的、跨会话仍有用的事实\n' +
    '- 不要抽取临时性问答或一般性常识\n' +
    '- 每条 ≤ 80 字，简洁可复用\n' +
    '- 如果没有值得记的，返回空数组 []\n' +
    '- 只输出 JSON 数组，不要解释，格式：[{"category":"...","content":"..."}, ...]';

  const userPrompt = '从以下对话提取用户档案事实：\n\n' + lines + existingBlock;

  const { callModelTask, parseJsonText } = require('./model-tasks');
  const result = await callModelTask({
    role: 'summary',
    messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
    maxTokens: 800,
    responseFormat: { type: 'json_object' },
    telemetry: { kind: 'user_fact_extraction' },
  });
  const parsed = parseJsonText(result.text);
  let arr = Array.isArray(parsed)
    ? parsed
    : parsed && Array.isArray(parsed.facts)
      ? parsed.facts
      : parsed && Array.isArray(parsed.data)
        ? parsed.data
        : null;
  if (!arr && parsed && typeof parsed === 'object') {
    arr = Object.values(parsed).find(Array.isArray) || [];
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (fact) =>
      fact &&
      typeof fact === 'object' &&
      typeof fact.category === 'string' &&
      FACT_CATEGORIES.includes(fact.category) &&
      typeof fact.content === 'string' &&
      fact.content.trim().length > 0 &&
      fact.content.length <= 200
  );
}

/** Extract + persist (de-duped). Fire-and-forget. */
async function backgroundExtractFacts(userId, messages, projectId = null) {
  if (!userId) return;
  try {
    const existing = await listUserFactsAsync(userId, 60, projectId);
    const newFacts = await extractFactsFromMessages(messages, existing);
    if (newFacts.length === 0) return;
    const existingByKey = new Map(existing.map((f) => [f.category + '||' + _normFact(f.content), f]));
    let saved = 0;
    let merged = 0;
    for (const f of newFacts) {
      const key = f.category + '||' + _normFact(f.content);
      const hit = existingByKey.get(key);
      if (hit) {
        // BLOCK-182 矛盾消解（合并语义）：等值命中不再是静默 skip——刷新确认时间戳，
        // 用户持续提及的事实不被衰减误伤；审计 merge 留痕。
        const lifecycle = require('./memory-lifecycle');
        lifecycle.markConfirmed(dbMod.getDatabase(), { userId, factId: hit.id, detail: { category: f.category } });
        merged++;
        continue;
      }
      await upsertUserFactAsync({
        userId,
        projectId,
        category: f.category,
        content: f.content.trim(),
        source: 'auto',
      });
      existingByKey.set(key, { id: 'new', category: f.category, content: f.content });
      saved++;
    }
    if (saved > 0 || merged > 0) console.log('[user-facts] saved', saved, 'new /', merged, 'confirmed facts for user', userId);
  } catch (e) {
    console.log('[user-facts] extraction error:', e.message);
  }
}

module.exports = {
  listUserFactsAsync,
  getUserFactAsync,
  upsertUserFactAsync,
  deleteUserFactAsync,
  clearUserFactsAsync,
  buildFactsBlockAsync,
  buildFactsBlock, // SYNC_BRIDGE_v1 — sync wrapper
  extractFactsFromMessages,
  backgroundExtractFacts,
  FACT_CATEGORIES,
  FACT_CAT_LABEL,
};
