/**
 * panel-usage.js — 右栏面板使用埋点（owner msg_44b2179358ea 裁决④）。
 *
 * 取舍：不混入 funnel_events——那是转化漏斗白名单（6 事件、无 payload 列），
 * 面板开关塞进去会污染 TTFS/首成功口径；新轻量表结构化落 panel_id/action/项目/会话，
 * 支持后续按面板聚合。best-effort：写失败静默、永不影响业务；零外发（本机台账）。
 */
'use strict';

let _cachedDb = null;
let _ready = false;

function getDb() {
  if (!_cachedDb) _cachedDb = require('../db').getAsyncDatabase();
  return _cachedDb;
}

async function ensureTable() {
  if (_ready) return getDb();
  const db = getDb();
  await db.exec(`CREATE TABLE IF NOT EXISTS panel_usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    panel_id TEXT NOT NULL,
    action TEXT NOT NULL,
    project_id TEXT,
    conversation_id TEXT
  )`);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_panel_usage_panel ON panel_usage_events(panel_id, at DESC)');
  _ready = true;
  return db;
}

/** 测试注入（与 funnel-log 同款缝隙）。 */
function _setPanelUsageDb(db) {
  _cachedDb = db;
  _ready = false;
}

async function recordPanelUsage({ panelId, action, projectId = null, conversationId = null }) {
  if (typeof panelId !== 'string' || !panelId.trim()) return;
  if (!['open', 'close', 'switch'].includes(action)) return;
  try {
    const db = await ensureTable();
    await db.prepare(`INSERT INTO panel_usage_events (at, panel_id, action, project_id, conversation_id)
      VALUES (?, ?, ?, ?, ?)`).run(
      new Date().toISOString(),
      panelId.slice(0, 120),
      action,
      projectId == null ? null : String(projectId).slice(0, 120),
      conversationId == null ? null : String(conversationId).slice(0, 120),
    );
  } catch {
    // best-effort：埋点失败不影响面板行为
  }
}

module.exports = { recordPanelUsage, _setPanelUsageDb };
