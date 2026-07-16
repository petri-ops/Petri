/**
 * agent-tools/act-tools.js — Action execution system (page check, ack, dispatch)
 */
const dbMod = require('../db');
const sqlite = dbMod.getSqliteForLegacyModules();
const {
  actUpdateFigcodeEditor,
  actSwitchResultTab,
  actFocusCluster,
  actHighlightGene,
  actSelectCells,
  actFilterTable,
  actLabelCells,
  actMergeDatasets,
  actOpenReplot,
  actUploadDataHint,
  actOpenTool,
  actOpenFigcodePlot,
} = require('./plan-ui-tools');
const { v4: uuidv4 } = require('uuid');

// --------------------------------------------------------------
// ACT_TOOL_v1 — write operations (with audit + undo)
// --------------------------------------------------------------

function _log(line) {
  try {
    console.log('[act-tool]', line);
  } catch {}
}

// ADMIN_AI_GOV_v1: also honor the global pause flag
function isAgentPaused(userId) {
  const db = sqlite;
  try {
    // Global kill-switch
    const g = db
      .prepare("SELECT value FROM copilot_global_settings WHERE key='agent_paused'")
      .get();
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

// FILTER_AND_OR_v1 — single-cell filter expression evaluator (mirrors CsvTable)
function testFilterOne(cellRaw, expr) {
  const trimmed = String(expr).trim();
  if (!trimmed) return true;
  const cmp = trimmed.match(/^(>=|<=|>|<|=|!=)\s*(-?\d+(?:\.\d+)?)\s*$/);
  const between = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*$/);
  const num = parseFloat(cellRaw);
  if (cmp && !isNaN(num)) {
    const op = cmp[1];
    const v = parseFloat(cmp[2]);
    if (op === '>') return num > v;
    if (op === '>=') return num >= v;
    if (op === '<') return num < v;
    if (op === '<=') return num <= v;
    if (op === '=') return num === v;
    if (op === '!=') return num !== v;
  } else if (between && !isNaN(num)) {
    return num >= parseFloat(between[1]) && num <= parseFloat(between[2]);
  }
  return String(cellRaw).toLowerCase().includes(trimmed.toLowerCase());
}

function testFilterExpr(cellRaw, searchStr) {
  if (!searchStr) return true;
  if (/\s+AND\s+/i.test(searchStr)) {
    const parts = searchStr
      .split(/\s+AND\s+/i)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.every((p) => testFilterOne(cellRaw, p));
  }
  if (/\s+OR\s+/i.test(searchStr)) {
    const parts = searchStr
      .split(/\s+OR\s+/i)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.some((p) => testFilterOne(cellRaw, p));
  }
  if (/[,;:/|]/.test(searchStr) && !/^[><=!]/.test(searchStr)) {
    const terms = searchStr
      .split(/[,;:/|]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (terms.length > 0) return terms.some((t) => testFilterOne(cellRaw, t));
  }
  return testFilterOne(cellRaw, searchStr);
}

// ACT_ACK_v1 — ACK + page-requirement checks for frontend-side acts
const ACT_PAGE_REQUIREMENTS = {
  switch_result_tab: ['single-cell-result'],
  focus_cluster: ['single-cell-result'],
  highlight_gene: ['single-cell-result'],
  filter_table: ['single-cell-dataset', 'single-cell-result'],
  select_cells: ['single-cell-dataset'],
  label_cells: ['single-cell-dataset'],
  open_replot: ['single-cell-result'],
  merge_datasets: ['single-cell-project', 'single-cell-projects'],
  upload_data_hint: ['single-cell-project', 'single-cell-projects'],
  open_figcode_plot: '*',
  open_tool: '*', // any page (will navigate to /tools if needed)         // any page (will navigate if needed)
  update_figcode_editor: ['figcode'],
};

const ACT_PAGE_LABELS = {
  'single-cell-projects': '单细胞项目列表页',
  'single-cell-project': '单细胞项目页',
  'single-cell-dataset': '单细胞数据集页',
  'single-cell-result': '单细胞分析结果页',
  figcode: 'FigCode 工具页',
  docs: '教程页',
  blog: '博客页',
  home: '主页',
};

// FIGCODE_PAGE_RACE_FIX_v1
// Track implied page transitions within a single agent loop.
// Key: ctx requestId or visitorId+timestamp combo; Value: implied page string.
const _impliedPageByRequest = new Map();

function _setImpliedPage(ctx, page) {
  const key = _getRequestKey(ctx);
  if (key) _impliedPageByRequest.set(key, page);
  // Auto-cleanup after 30s (one agent loop never lasts that long)
  setTimeout(() => _impliedPageByRequest.delete(key), 30000);
}

function _getImpliedPage(ctx) {
  const key = _getRequestKey(ctx);
  return key ? _impliedPageByRequest.get(key) || null : null;
}

function _getRequestKey(ctx) {
  // Use conversationId + the message timestamp as a unique key per agent turn
  if (ctx && ctx.conversationId) return ctx.conversationId + ':' + (ctx._turnTs || '0');
  if (ctx && ctx.userId) return ctx.userId + ':' + (ctx._turnTs || '0');
  return null;
}

function _checkActPage(actType, currentPage, ctx) {
  const req = ACT_PAGE_REQUIREMENTS[actType];
  if (!req || req === '*') return { ok: true };
  if (Array.isArray(req)) {
    if (req.includes(currentPage)) return { ok: true };
    // FIGCODE_PAGE_RACE_FIX_v1: check implied page from earlier navigation in same turn
    const implied = ctx ? _getImpliedPage(ctx) : null;
    if (implied && req.includes(implied)) return { ok: true };
    const expectedHuman = req.map((p) => ACT_PAGE_LABELS[p] || p).join(' 或 ');
    return {
      ok: false,
      error: 'wrong_page',
      expected: req,
      actual: currentPage || '(unknown)',
      message:
        '此操作只能在【' +
        expectedHuman +
        '】使用，当前在【' +
        (ACT_PAGE_LABELS[currentPage] || currentPage || '未知') +
        '】。请先 emit navigate action 跳过去再调用此 act。',
    };
  }
  return { ok: true };
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
  const { v4: uuidv4 } = require('uuid');
  return 'ack_' + uuidv4().slice(0, 12);
}

async function tool_act(args, ctx) {
  // FIGCODE_PAGE_RACE_FIX_v1: stamp turn timestamp for implied-page tracking
  if (!ctx._turnTs) ctx._turnTs = String(Date.now());
  const userId = ctx.userId;
  if (!userId) throw new Error('未授权');
  if (isAgentPaused(userId)) {
    return {
      error: 'agent_paused',
      message: '用户已暂停 agent 自主操作。请用户先在 Copilot 设置里恢复。',
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
  const dispatchers = {
    start_analysis: actStartAnalysis,
    recluster: actRecluster,
    rename_project: actRenameProject,
    rename_dataset: actRenameDataset,
    rename_analysis: actRenameAnalysis,
    update_analysis_params: actUpdateAnalysisParams,
    update_figcode_editor: actUpdateFigcodeEditor,
    switch_result_tab: actSwitchResultTab,
    focus_cluster: actFocusCluster,
    highlight_gene: actHighlightGene,
    select_cells: actSelectCells,
    filter_table: actFilterTable,
    label_cells: actLabelCells,
    merge_datasets: actMergeDatasets,
    open_replot: actOpenReplot,
    upload_data_hint: actUploadDataHint,
    open_figcode_plot: actOpenFigcodePlot,
    open_tool: actOpenTool,
  };
  const fn = dispatchers[type];
  if (!fn) return { error: 'unknown_act', message: 'act type not allowed: ' + type };
  // ACT_ACK_v1: page-requirement check (only for frontend-side acts)
  const currentPage = (ctx.context && ctx.context.page) || null;
  const pageCheck = _checkActPage(type, currentPage, ctx);
  if (!pageCheck.ok) {
    return pageCheck;
  }

  try {
    const result = await fn(args, ctx);
    if (result && !result.error) {
      const undoToken = recordAudit(userId, type, args, result);
      result.undoToken = undoToken;
      result.undoableUntil = Date.now() + 5000;
      // ACT_ACK_v1: for frontend-side acts, register ACK and wait briefly
      const isFrontendSide = Object.prototype.hasOwnProperty.call(ACT_PAGE_REQUIREMENTS, type);
      if (isFrontendSide) {
        const ackToken = _generateAckToken();
        result.ackToken = ackToken;
        // Caller (chat handler) is responsible for actually waiting on this token after sending the SSE.
        // We pre-register so the token is reserved.
        const ackPromise = _registerActAck(ackToken, 800);
        // Stash the promise on the result; the handler will await it before
        // adding the final tool_message that the LLM sees.
        result._ackPromise = ackPromise;
      }
    }
    return result;
  } catch (e) {
    return { error: 'exec_failed', message: e.message || String(e) };
  }
}

// ----- act implementations -----

async function actStartAnalysis(args, ctx) {
  const db = sqlite;
  const userId = ctx.userId;
  if (!args.datasetId) return { error: 'missing_datasetId' };
  if (!args.analysisType) return { error: 'missing_analysisType' };

  // Ownership check
  const ds = db
    .prepare(
      `SELECT d.* FROM datasets d JOIN projects p ON d.project_id=p.id WHERE d.id=? AND p.user_id=?`
    )
    .get(args.datasetId, userId);
  if (!ds) return { error: 'dataset_not_found' };

  // ACT_QUOTA_GUARD_v1: monthly analysis count cap (mirror /api/task logic)
  try {
    const user = db.prepare('SELECT role, max_analyses_month FROM users WHERE id=?').get(userId);
    if (user && user.role !== 'admin') {
      const maxMonth = user.max_analyses_month || 50;
      const monthStart = new Date().toISOString().slice(0, 7) + '-01';
      const cnt = db
        .prepare(
          `SELECT COUNT(*) AS n FROM analyses WHERE dataset_id IN (SELECT id FROM datasets WHERE project_id IN (SELECT id FROM projects WHERE user_id=?)) AND created_at >= ?`
        )
        .get(userId, monthStart);
      if (cnt && cnt.n >= maxMonth) {
        return {
          error: 'quota_exceeded',
          message:
            '本月分析次数已达上限（' + maxMonth + ' 次/月）。请联系管理员提升额度，或下月再试。',
        };
      }
    }
  } catch {
    /* fail-open if user table missing fields */
  }

  // ACT_QUOTA_GUARD_v1: per-dataset concurrency cap — block if too many same-type analyses already running
  try {
    const concurrentMax = 3; // hard cap per dataset+type
    const inflight = db
      .prepare(
        `SELECT COUNT(*) AS n FROM analyses WHERE dataset_id=? AND type=? AND status IN ('running','pending','queued')`
      )
      .get(args.datasetId, args.analysisType);
    if (inflight && inflight.n >= concurrentMax) {
      return {
        error: 'too_many_inflight',
        message:
          '该数据集上已有 ' +
          inflight.n +
          ' 个 ' +
          args.analysisType +
          ' 类型分析正在运行。请等其中一个完成后再发起。',
      };
    }
  } catch {
    /* ignore */
  }

  // Resolve parent analysis (if recluster/cell_annotation/trajectory etc require it)
  let parentTaskId = null;
  if (args.parentAnalysisId) {
    const a = db
      .prepare(
        `SELECT a.* FROM analyses a JOIN datasets d ON a.dataset_id=d.id JOIN projects p ON d.project_id=p.id WHERE a.id=? AND p.user_id=?`
      )
      .get(args.parentAnalysisId, userId);
    if (!a) return { error: 'parent_not_found' };
    // PARENT_WAIT_v1: refuse if parent isn't done yet — AI must wait instead of cascading failures
    if (a.status !== 'done') {
      return {
        error: 'parent_not_ready',
        parentStatus: a.status,
        parentName: a.name,
        message:
          '父分析「' +
          a.name +
          '」当前状态是 ' +
          a.status +
          '，还没完成。请等它跑完再发起这一步——你可以稍后再问"继续"，我会自动接着推进。',
      };
    }
    if (a.error) {
      return {
        error: 'parent_failed',
        parentName: a.name,
        message:
          '父分析「' +
          a.name +
          '」失败了，无法基于它继续。错误信息：' +
          String(a.error).slice(0, 200),
      };
    }
    parentTaskId = a.task_id;
  }

  // Build sane default params if missing
  const params = Object.assign({}, args.params || {});
  if (args.analysisType === 'scrna_standard') {
    if (!params.species) params.species = 'human';
    if (!params.minCells) params.minCells = 3;
    if (!params.minFeatures) params.minFeatures = 200;
    if (!params.maxFeatures) params.maxFeatures = 5000;
    if (!params.maxMtPercent) params.maxMtPercent = 15;
    if (!params.nPCs) params.nPCs = 20;
    if (!params.resolution) params.resolution = 0.5;
    if (!params.normMethod) params.normMethod = 'LogNormalize';
  } else if (args.analysisType === 'recluster') {
    params.skipQC = true;
    if (!params.nPCs) params.nPCs = 20;
    if (!params.resolution) params.resolution = 0.5;
    if (!params.normMethod) params.normMethod = 'LogNormalize';
  }

  // Submit the task via the same path /api/task uses. createTask is in server.js scope;
  // we expose it via ctx.createTask injected by chat handler.
  if (!ctx.createTask) return { error: 'createTask not wired' };
  const result = ctx.createTask({
    type: args.analysisType,
    ossInputUrl: ds.oss_url,
    params,
    parentTaskId,
  });
  if (!result || !result.taskId) return { error: 'task_submit_failed' };

  // Determine analysis name
  let name = args.name;
  if (!name) {
    const existing = db
      .prepare(`SELECT COUNT(*) AS n FROM analyses WHERE dataset_id=? AND type=?`)
      .get(args.datasetId, args.analysisType);
    name =
      (args.analysisType === 'scrna_standard' ? '标准分析' : args.analysisType) +
      ' v' +
      ((existing.n || 0) + 1);
  }

  // Create analysis row
  const aId = 'a_' + uuidv4().slice(0, 12);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO analyses(id, dataset_id, task_id, type, name, parent_analysis_id, params, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    aId,
    args.datasetId,
    result.taskId,
    args.analysisType,
    name,
    args.parentAnalysisId || null,
    JSON.stringify(params),
    'running',
    now
  );

  return {
    ok: true,
    analysisId: aId,
    name,
    taskId: result.taskId,
    type: args.analysisType,
    datasetId: args.datasetId,
    params,
    status: 'running',
    message: `已发起 ${args.analysisType} 分析（${name}），后台运行中。可在结果页查看进度。`,
  };
}

async function actRecluster(args, ctx) {
  const db = sqlite;
  const userId = ctx.userId;
  if (!args.analysisId) return { error: 'missing_analysisId' };
  if (args.cluster == null) return { error: 'missing_cluster' };

  // Look up parent analysis
  const a = db
    .prepare(
      `SELECT a.* FROM analyses a JOIN datasets d ON a.dataset_id=d.id JOIN projects p ON d.project_id=p.id WHERE a.id=? AND p.user_id=?`
    )
    .get(args.analysisId, userId);
  if (!a) return { error: 'analysis_not_found' };

  return await actStartAnalysis(
    {
      type: 'start_analysis',
      datasetId: a.dataset_id,
      analysisType: 'recluster',
      parentAnalysisId: args.analysisId,
      params: {
        cluster: args.cluster,
        resolution: (args.params && args.params.resolution) || 0.3,
        nPCs: (args.params && args.params.nPCs) || 20,
      },
      name: 'cluster ' + args.cluster + ' recluster',
    },
    ctx
  );
}

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

module.exports = {
  tool_act,
  actStartAnalysis,
  actRecluster,
  actRenameProject,
  actRenameDataset,
  actRenameAnalysis,
  actUpdateAnalysisParams,
  _ackActToken,
  _pendingActAcks,
  _registerActAck,
  isAgentPaused,
  recordAudit,
  _setImpliedPage,
  testFilterExpr,
};
