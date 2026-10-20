/**
 * agent-tools/act-tools.js — Domain-neutral action execution + pack UI action dispatch.
 *
 * 核心只保留领域中性动作（rename_* / update_analysis_params / open_tool / ui_action）。
 * 单细胞/FigCode 动作已随旧页面退役移除；领域动作由已安装 pack 的
 * `provides.uiActions` 提供，执行时校验 action → pack view surface，再经 ack
 * 交给前端 host 分发到 pack iframe。pack 缺失/停用 → unknown_ui_action（fail-closed）。
 */
const dbMod = require('../db');
const sqlite = dbMod.getDatabase();
const { v4: uuidv4 } = require('uuid');
const { listPackUiActions } = require('../helpers/pack-contributions');

const CORE_ACT_TYPES = Object.freeze([
  'rename_project',
  'rename_dataset',
  'rename_analysis',
  'update_analysis_params',
  'open_tool',
  'ui_action',
]);
const UI_ACTION_ACK_TIMEOUT_MS = 5000;
const UI_ACTION_PAYLOAD_MAX_BYTES = 8 * 1024;

function _log(line) {
  try {
    console.log('[act-tool]', line);
  } catch {}
}

// ADMIN_AI_GOV_v1: also honor the global pause flag
function isAgentPaused(userId) {
  const db = sqlite;
  try {
    const g = db.prepare("SELECT value FROM copilot_global_settings WHERE key='agent_paused'").get();
    if (g && g.value === '1') return true;
    const row = db.prepare('SELECT agent_paused FROM copilot_settings WHERE user_id=?').get(userId);
    return !!(row && row.agent_paused);
  } catch {
    return false;
  }
}

function recordAudit(userId, action, args, result) {
  const db = sqlite;
  const undoToken = 'undo_' + uuidv4().slice(0, 12);
  try {
    db.prepare(
      `INSERT INTO agent_audit(undo_token, user_id, action, args, result, ts) VALUES (?,?,?,?,?,?)`
    ).run(
      undoToken,
      userId,
      action,
      JSON.stringify(args || {}),
      JSON.stringify(result || {}),
      new Date().toISOString()
    );
  } catch (e) {
    _log('audit insert err: ' + e.message);
  }
  return undoToken;
}

// Pending ACKs registered by tool calls; cleared on /api/ai/act-ack/:token
const _pendingActAcks = new Map(); // token → {resolve, expiresAt}

function _registerActAck(token, timeoutMs = 800) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      _pendingActAcks.delete(token);
      resolve({ timedOut: true });
    }, timeoutMs);
    _pendingActAcks.set(token, {
      resolve: (info) => {
        clearTimeout(timer);
        resolve({ timedOut: false, info });
      },
      expiresAt: Date.now() + timeoutMs,
    });
  });
}

function _ackActToken(token, info) {
  const p = _pendingActAcks.get(token);
  if (!p) return false;
  _pendingActAcks.delete(token);
  p.resolve(info || { ok: true });
  return true;
}

function _generateAckToken() {
  const { v4 } = require('uuid');
  return 'ack_' + v4().slice(0, 12);
}

async function tool_act(args, ctx) {
  const userId = ctx.userId;
  if (!userId) throw new Error('未授权');
  if (isAgentPaused(userId)) {
    return {
      error: 'agent_paused',
      message: '用户已暂停 agent 自主操作。请先在助手设置里恢复。',
    };
  }
  // Rate limit: 5 acts / minute
  const db = sqlite;
  try {
    const since = new Date(Date.now() - 60_000).toISOString();
    const recent = db
      .prepare('SELECT COUNT(*) AS n FROM agent_audit WHERE user_id=? AND ts >= ?')
      .get(userId, since);
    if (recent && recent.n >= 5) {
      return { error: 'rate_limited', message: '1 分钟内已执行 5 次写操作，请稍候再试。' };
    }
  } catch {}

  const type = args.type;
  if (!CORE_ACT_TYPES.includes(type)) {
    return {
      error: 'unknown_act',
      message: 'act type not allowed: ' + type,
      available: CORE_ACT_TYPES.slice(),
    };
  }

  const dispatchers = {
    rename_project: actRenameProject,
    rename_dataset: actRenameDataset,
    rename_analysis: actRenameAnalysis,
    update_analysis_params: actUpdateAnalysisParams,
    open_tool: actOpenTool,
    ui_action: actUiAction,
  };

  try {
    const result = await dispatchers[type](args, ctx);
    if (result && !result.error) {
      const auditArgs = type === 'ui_action'
        ? { type, actionId: args.actionId, payloadBytes: result._payloadBytes || 0 }
        : args;
      const auditResult = type === 'ui_action'
        ? {
          ok: true,
          uiAction: {
            actionId: result.uiAction && result.uiAction.actionId,
            surfaceId: result.uiAction && result.uiAction.surfaceId,
            packId: result.uiAction && result.uiAction.packId,
          },
        }
        : result;
      result.undoToken = recordAudit(userId, type, auditArgs, auditResult);
      if (type === 'ui_action') {
        delete result._payloadBytes;
        const ackToken = _generateAckToken();
        result.ackToken = ackToken;
        result.ackExpiresAt = Date.now() + UI_ACTION_ACK_TIMEOUT_MS;
        result._ackPromise = _registerActAck(ackToken, UI_ACTION_ACK_TIMEOUT_MS);
      } else {
        result.undoableUntil = Date.now() + 5000;
      }
    }
    return result;
  } catch (e) {
    return { error: 'exec_failed', message: e.message || String(e) };
  }
}

// ----- core action implementations -----

async function actRenameProject(args, ctx) {
  const db = sqlite;
  const userId = ctx.userId;
  if (!args.projectId || !args.newName) return { error: 'missing_args' };
  const p = db
    .prepare('SELECT * FROM projects WHERE id=? AND user_id=?')
    .get(args.projectId, userId);
  if (!p) return { error: 'project_not_found' };
  const oldName = p.name;
  db.prepare('UPDATE projects SET name=?, updated_at=? WHERE id=? AND user_id=?').run(
    args.newName,
    new Date().toISOString(),
    args.projectId,
    userId
  );
  return {
    ok: true,
    projectId: args.projectId,
    oldName,
    newName: args.newName,
    message: `项目已重命名: ${oldName} → ${args.newName}`,
  };
}

async function actRenameDataset(args, ctx) {
  const db = sqlite;
  const userId = ctx.userId;
  if (!args.datasetId || !args.newName) return { error: 'missing_args' };
  const ds = db
    .prepare(
      `SELECT d.* FROM datasets d JOIN projects p ON d.project_id=p.id WHERE d.id=? AND p.user_id=?`
    )
    .get(args.datasetId, userId);
  if (!ds) return { error: 'dataset_not_found' };
  const oldName = ds.name;
  db.prepare('UPDATE datasets SET name=? WHERE id=?').run(args.newName, args.datasetId);
  return {
    ok: true,
    datasetId: args.datasetId,
    oldName,
    newName: args.newName,
    message: `数据集已重命名: ${oldName} → ${args.newName}`,
  };
}

async function actRenameAnalysis(args, ctx) {
  const db = sqlite;
  const userId = ctx.userId;
  if (!args.analysisId || !args.newName) return { error: 'missing_args' };
  const a = db
    .prepare(
      `SELECT a.* FROM analyses a JOIN datasets d ON a.dataset_id=d.id JOIN projects p ON d.project_id=p.id WHERE a.id=? AND p.user_id=?`
    )
    .get(args.analysisId, userId);
  if (!a) return { error: 'analysis_not_found' };
  const oldName = a.name;
  db.prepare('UPDATE analyses SET name=? WHERE id=?').run(args.newName, args.analysisId);
  return {
    ok: true,
    analysisId: args.analysisId,
    oldName,
    newName: args.newName,
    message: `分析已重命名: ${oldName} → ${args.newName}`,
  };
}

async function actUpdateAnalysisParams(args, ctx) {
  const db = sqlite;
  const userId = ctx.userId;
  if (!args.analysisId || !args.params) return { error: 'missing_args' };
  const a = db
    .prepare(
      `SELECT a.* FROM analyses a JOIN datasets d ON a.dataset_id=d.id JOIN projects p ON d.project_id=p.id WHERE a.id=? AND p.user_id=?`
    )
    .get(args.analysisId, userId);
  if (!a) return { error: 'analysis_not_found' };
  const oldParams = JSON.parse(a.params || '{}');
  const newParams = Object.assign({}, oldParams, args.params);
  db.prepare('UPDATE analyses SET params=? WHERE id=?').run(
    JSON.stringify(newParams),
    args.analysisId
  );
  return {
    ok: true,
    analysisId: args.analysisId,
    oldParams,
    newParams,
    message: '参数已更新（不会自动重跑分析；如需重跑请发起新分析）',
  };
}

async function actOpenTool(args, _ctx) {
  const toolId = typeof args.toolId === 'string' ? args.toolId.trim() : '';
  if (!toolId) return { error: 'missing_toolId' };
  return {
    ok: true,
    type: 'open_tool',
    toolId,
    message: '已请求打开工具 ' + toolId + '。',
  };
}

async function actUiAction(args, _ctx) {
  const actionId = typeof args.actionId === 'string' ? args.actionId.trim() : '';
  if (!actionId) return { error: 'missing_actionId' };
  const { actions, viewIds } = listPackUiActions();
  const action = actions.find((item) => item.id === actionId);
  if (!action) {
    return {
      error: 'unknown_ui_action',
      message: '没有已安装领域包提供该 UI action：' + actionId,
      available: actions
        .filter((item) => item.surfaceId && viewIds.has(item.surfaceId))
        .map((item) => item.id)
        .slice(0, 50),
    };
  }
  if (!action.surfaceId || !viewIds.has(action.surfaceId)) {
    return {
      error: 'ui_action_surface_unavailable',
      message: '该 UI action 的目标视图不在当前已安装领域包中：' + actionId,
    };
  }
  const payload = args.payload && typeof args.payload === 'object' && !Array.isArray(args.payload)
    ? args.payload
    : {};
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (payloadBytes > UI_ACTION_PAYLOAD_MAX_BYTES) {
    return { error: 'ui_action_payload_too_large', message: 'UI action payload 超过 8KB 上限' };
  }
  return {
    ok: true,
    type: 'ui_action',
    uiAction: {
      actionId: action.id,
      label: action.label,
      surfaceId: action.surfaceId,
      packId: action.packId,
      payload,
    },
    _payloadBytes: payloadBytes,
    message: '已派发 UI 动作「' + action.label + '」，等待前端确认。',
  };
}

module.exports = {
  CORE_ACT_TYPES,
  UI_ACTION_ACK_TIMEOUT_MS,
  tool_act,
  actRenameProject,
  actRenameDataset,
  actRenameAnalysis,
  actUpdateAnalysisParams,
  actOpenTool,
  actUiAction,
  _ackActToken,
  _pendingActAcks,
  _registerActAck,
  isAgentPaused,
  recordAudit,
};
