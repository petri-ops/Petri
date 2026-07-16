/**
 * helpers/act-tool.js — ACT_TOOL_v1_SERVER (agent_audit table + undo)
 *
 * Extracted from server.js. Pure module: depends only on ../db.
 *
 * Public API:
 *   undoAgentAct(userId, undoToken) → Promise<{ok, message, action}>
 */

const dbMod = require('../db');
const sqlite = dbMod.getSqliteForLegacyModules();

// One-time table create (idempotent)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS agent_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    undo_token TEXT UNIQUE,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    args TEXT,
    result TEXT,
    ts TEXT NOT NULL,
    undone INTEGER NOT NULL DEFAULT 0,
    undone_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_agent_audit_user_ts ON agent_audit(user_id, ts DESC);

  CREATE TABLE IF NOT EXISTS copilot_settings (
    user_id TEXT PRIMARY KEY,
    agent_paused INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
`);

/** Undo a recent act. Best-effort. */
async function undoAgentAct(userId, undoToken) {
  const row = sqlite
    .prepare('SELECT * FROM agent_audit WHERE undo_token=? AND user_id=?')
    .get(undoToken, userId);
  if (!row) return { ok: false, error: 'token_not_found' };
  if (row.undone) return { ok: false, error: 'already_undone' };
  const ageMs = Date.now() - new Date(row.ts).getTime();
  if (ageMs > 30_000) return { ok: false, error: 'undo_window_expired' };

  let _args = {};
  let result = {};
  try {
    _args = JSON.parse(row.args || '{}');
  } catch {}
  try {
    result = JSON.parse(row.result || '{}');
  } catch {}

  let undoOk = false;
  let undoMsg = '';
  try {
    if (row.action === 'rename_project' && result.projectId && result.oldName) {
      dbMod.updateProject(result.projectId, { name: result.oldName });
      undoOk = true;
      undoMsg = '已恢复原项目名';
    } else if (row.action === 'rename_dataset' && result.datasetId && result.oldName) {
      dbMod.updateDataset(result.datasetId, { name: result.oldName });
      undoOk = true;
      undoMsg = '已恢复原数据集名';
    } else if (row.action === 'rename_analysis' && result.analysisId && result.oldName) {
      dbMod.updateAnalysis(result.analysisId, { name: result.oldName });
      undoOk = true;
      undoMsg = '已恢复原分析名';
    } else if (row.action === 'update_analysis_params' && result.analysisId && result.oldParams) {
      dbMod.updateAnalysis(result.analysisId, { params: result.oldParams });
      undoOk = true;
      undoMsg = '已恢复原参数';
    } else if (
      (row.action === 'start_analysis' || row.action === 'recluster') &&
      result.analysisId
    ) {
      dbMod.deleteAnalysis(result.analysisId);
      undoOk = true;
      undoMsg = '分析已撤销（任务可能已开始执行，结果不会保留）';
    } else {
      undoMsg = 'this action is not undoable';
    }
  } catch (e) {
    undoMsg = e.message;
  }

  if (undoOk) {
    sqlite
      .prepare('UPDATE agent_audit SET undone=TRUE, undone_at=? WHERE id=?')
      .run(new Date().toISOString(), row.id);
  }
  return { ok: undoOk, message: undoMsg, action: row.action };
}

module.exports = {
  undoAgentAct,
};
