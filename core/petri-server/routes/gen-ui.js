/**
 * BLOCK-166 P2 — Gen UI widgetState 持久化 REST 面（D4）。
 *
 * dev 主进程不进程内开 better-sqlite3（Electron ABI≠系统 Node，P0 prepare 的
 * REST 先例同款），桌面侧经本面读写 gen_ui_widget_state 表（schema.js 建表）。
 * 纯逻辑（校验/往返）导出供 Node 直测（test/block166-gen-ui-p2.test.mjs），
 * 路由注册走 routes/index.js 的 (app) 范式，鉴权走全局 auth（desktop-local Bearer）。
 */

const WIDGET_STATE_MAX_BYTES = 16 * 1024;

/** scope_key 形状：sha256 十六进制 64 位。 */
function isValidScopeKey(scopeKey) {
  return typeof scopeKey === 'string' && /^[a-f0-9]{64}$/.test(scopeKey);
}

/** state 形状：JSON 对象（非数组/null）且序列化 ≤16KiB。返回归一化 JSON 字符串或 null。 */
function normalizeStateJson(state) {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return null;
  let serialized;
  try {
    serialized = JSON.stringify(state);
  } catch {
    return null;
  }
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > WIDGET_STATE_MAX_BYTES) return null;
  return serialized;
}

function getWidgetState(db, scopeKey, filePath) {
  if (!isValidScopeKey(scopeKey)) return { ok: false, code: 'invalid-scope', message: 'scopeKey must be sha256 hex' };
  if (typeof filePath !== 'string' || !filePath.trim()) return { ok: false, code: 'invalid-path', message: 'filePath required' };
  const row = db.prepare('SELECT state_json FROM gen_ui_widget_state WHERE scope_key = ? AND file_path = ?')
    .get(scopeKey, filePath);
  if (!row) return { ok: true, state: null };
  try {
    return { ok: true, state: JSON.parse(row.state_json) };
  } catch {
    return { ok: true, state: null };
  }
}

function putWidgetState(db, scopeKey, filePath, state) {
  if (!isValidScopeKey(scopeKey)) return { ok: false, code: 'invalid-scope', message: 'scopeKey must be sha256 hex' };
  if (typeof filePath !== 'string' || !filePath.trim()) return { ok: false, code: 'invalid-path', message: 'filePath required' };
  const stateJson = normalizeStateJson(state);
  if (!stateJson) return { ok: false, code: 'invalid-state', message: `widget state must be a JSON object of at most ${WIDGET_STATE_MAX_BYTES} bytes` };
  db.prepare(
    `INSERT INTO gen_ui_widget_state (scope_key, file_path, state_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(scope_key, file_path) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
  ).run(scopeKey, filePath, stateJson, new Date().toISOString());
  return { ok: true };
}

/** 路由注册（routes/index.js 范式：require('./gen-ui')(app)）。 */
function registerGenUiRoutes(app) {
  const db = require('../db').getDatabase();

  app.get('/api/gen-ui/widget-state', (req, res) => {
    const result = getWidgetState(db, String(req.query.scopeKey || ''), String(req.query.filePath || ''));
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.put('/api/gen-ui/widget-state', (req, res) => {
    const body = req.body || {};
    const result = putWidgetState(db, String(body.scopeKey || ''), String(body.filePath || ''), body.state ?? null);
    res.status(result.ok ? 200 : 400).json(result);
  });
}

module.exports = registerGenUiRoutes;
module.exports.getWidgetState = getWidgetState;
module.exports.putWidgetState = putWidgetState;
module.exports.isValidScopeKey = isValidScopeKey;
module.exports.normalizeStateJson = normalizeStateJson;
module.exports.WIDGET_STATE_MAX_BYTES = WIDGET_STATE_MAX_BYTES;
