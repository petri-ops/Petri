/**
 * approval-persistence.js — harness M4（owner msg_8640320d302e）：审批态持久化。
 *
 * 背景：guard-ack-store / approval-request-store 原为进程内 Map——重启即丢审批，
 * 用户需重新批准（真实生产问题）。本模块提供同步写穿原语（better-sqlite3 同步句柄），
 * 两 store 保留原有同步 API（调用方零改动）：启动时 loadAll 恢复、变更时 saveState 写穿。
 *
 * 边界：不扩权——本模块只存"已发生的审批态"，不替用户规则面（ORC-1）做跨会话授权决策；
 * TTL 过期仍由 store 自身 sweep（本模块只搬运状态）。零外发、本机台账。
 */
'use strict';

const { db } = require('../db');

let _ready = false;

function ensureTable() {
  if (_ready) return;
  db.exec(`CREATE TABLE IF NOT EXISTS approval_persistence (
    task_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    state_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (task_id, kind, state_key)
  )`);
  _ready = true;
}

/** 加载某类审批态：Map<taskId, Map<key, unknown>>。启动恢复用，失败返回空 Map（不阻塞）。 */
function loadAll(kind) {
  const out = new Map();
  try {
    ensureTable();
    const rows = db.prepare('SELECT task_id, state_key, value_json FROM approval_persistence WHERE kind=?').all(kind);
    for (const row of rows) {
      let value;
      try { value = JSON.parse(row.value_json); } catch { continue; }
      if (!out.has(row.task_id)) out.set(row.task_id, new Map());
      out.get(row.task_id).set(row.state_key, value);
    }
  } catch { /* 读失败不阻塞启动 */ }
  return out;
}

function saveState(taskId, kind, stateKey, value) {
  try {
    ensureTable();
    db.prepare(`INSERT INTO approval_persistence (task_id, kind, state_key, value_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(task_id, kind, state_key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`)
      .run(String(taskId), kind, String(stateKey), JSON.stringify(value), new Date().toISOString());
  } catch { /* 写穿失败不阻塞业务 */ }
}

function deleteState(taskId, kind, stateKey) {
  try {
    ensureTable();
    db.prepare('DELETE FROM approval_persistence WHERE task_id=? AND kind=? AND state_key=?')
      .run(String(taskId), kind, String(stateKey));
  } catch { /* 清理失败不阻塞业务 */ }
}

function clearTask(taskId) {
  try {
    ensureTable();
    db.prepare('DELETE FROM approval_persistence WHERE task_id=?').run(String(taskId));
  } catch { /* 清理失败不阻塞业务 */ }
}

module.exports = { loadAll, saveState, deleteState, clearTask };
