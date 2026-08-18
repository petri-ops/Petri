/**
 * agent-tools/plan-ui-tools.js — Plan management + UI control acts
 */
const dbMod = require('../db');
const sqlite = dbMod.getDatabase();

// A-008: static require breaks act-tools ↔ plan-ui-tools cycle
const { testFilterExpr, _setImpliedPage } = require('./act-tool-core');

// --------------------------------------------------------------
// PLAN_TOOL_v1 — persistent plan management
// --------------------------------------------------------------

async function tool_plan(args, ctx) {
  const userId = ctx.userId;
  if (!userId) throw new Error('未授权');
  const db = sqlite;
  const { v4: uuidv4 } = require('uuid');
  const op = args.op;

  if (op === 'create') {
    if (!args.title || !Array.isArray(args.steps) || args.steps.length === 0) {
      return { error: 'missing_args', message: '需要 title 和 steps[]' };
    }
    const planId = 'plan_' + uuidv4().slice(0, 12);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO copilot_plans(id, user_id, title, goal, status, chat_context_excerpt, conversation_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      planId,
      userId,
      args.title.slice(0, 200),
      (args.goal || '').slice(0, 1000),
      'active',
      (args.chatExcerpt || '').slice(0, 600),
      (ctx && ctx.conversationId) || null,
      now,
      now
    );
    const stepInsert = db.prepare(
      `INSERT INTO copilot_plan_steps(plan_id, n, title, hint, status, ts) VALUES (?,?,?,?,?,?)`
    );
    args.steps.forEach((s, i) => {
      const n = typeof s.n === 'number' ? s.n : i + 1;
      stepInsert.run(
        planId,
        n,
        String(s.title || '').slice(0, 200),
        String(s.hint || '').slice(0, 500),
        'pending',
        now
      );
    });
    return {
      ok: true,
      planId,
      title: args.title,
      stepCount: args.steps.length,
      message: '已创建 plan，将按步骤推进',
    };
  }

  if (op === 'list') {
    const plans = db
      .prepare(
        `SELECT id, title, goal, status, created_at, updated_at,
        (SELECT COUNT(*) FROM copilot_plan_steps WHERE plan_id = copilot_plans.id) AS total_steps,
        (SELECT COUNT(*) FROM copilot_plan_steps WHERE plan_id = copilot_plans.id AND status='done') AS done_steps
      FROM copilot_plans WHERE user_id=? ORDER BY updated_at DESC LIMIT 20`
      )
      .all(userId);
    return plans;
  }

  if (op === 'get') {
    if (!args.planId) return { error: 'missing_planId' };
    const plan = db
      .prepare('SELECT * FROM copilot_plans WHERE id=? AND user_id=?')
      .get(args.planId, userId);
    if (!plan) return { error: 'plan_not_found' };
    const steps = db
      .prepare('SELECT * FROM copilot_plan_steps WHERE plan_id=? ORDER BY n ASC')
      .all(args.planId);
    return { ...plan, steps };
  }

  if (op === 'update_step') {
    if (!args.planId || typeof args.stepN !== 'number') return { error: 'missing_args' };
    const plan = db
      .prepare('SELECT id FROM copilot_plans WHERE id=? AND user_id=?')
      .get(args.planId, userId);
    if (!plan) return { error: 'plan_not_found' };
    const allowed = ['pending', 'running', 'done', 'failed', 'skipped'];
    const status = allowed.includes(args.stepStatus) ? args.stepStatus : null;
    const sets = [];
    const values = [];
    if (status) {
      sets.push('status=?');
      values.push(status);
    }
    if (args.stepResult) {
      sets.push('result=?');
      values.push(String(args.stepResult).slice(0, 1000));
    }
    if (args.analysisId) {
      sets.push('analysis_id=?');
      values.push(String(args.analysisId));
    } // PLAN_STEP_LINK_v1_TOOL
    if (args.toolJobId) {
      sets.push('tool_job_id=?');
      values.push(String(args.toolJobId));
    } // PLAN_TOOL_JOB_LINK_v1（方案 C：bulk 工具）
    sets.push('ts=?');
    values.push(new Date().toISOString());
    if (sets.length === 1) return { error: 'nothing_to_update' };
    values.push(args.planId, args.stepN);
    db.prepare(`UPDATE copilot_plan_steps SET ${sets.join(', ')} WHERE plan_id=? AND n=?`).run(
      ...values
    );
    db.prepare('UPDATE copilot_plans SET updated_at=? WHERE id=?').run(
      new Date().toISOString(),
      args.planId
    );

    // If all steps done → mark plan completed
    const counts = db
      .prepare(
        `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
      FROM copilot_plan_steps WHERE plan_id=?`
      )
      .get(args.planId);
    if (counts && counts.total > 0 && counts.total === counts.done) {
      db.prepare('UPDATE copilot_plans SET status=? WHERE id=?').run('completed', args.planId);
      return {
        ok: true,
        planId: args.planId,
        stepN: args.stepN,
        allDone: true,
        message: '所有步骤完成，plan 已标记 completed',
      };
    }
    return { ok: true, planId: args.planId, stepN: args.stepN, status };
  }

  if (op === 'pause' || op === 'resume' || op === 'complete' || op === 'cancel') {
    if (!args.planId) return { error: 'missing_planId' };
    const newStatus =
      op === 'pause'
        ? 'paused'
        : op === 'resume'
          ? 'active'
          : op === 'complete'
            ? 'completed'
            : 'cancelled';
    const r = db
      .prepare('UPDATE copilot_plans SET status=?, updated_at=? WHERE id=? AND user_id=?')
      .run(newStatus, new Date().toISOString(), args.planId, userId);
    if (r.changes === 0) return { error: 'plan_not_found' };
    return { ok: true, planId: args.planId, status: newStatus };
  }

  return { error: 'unknown_op', message: 'op not allowed: ' + op };
}

// FIGCODE_ACT_v1 — replace code in the figcode editor (frontend-side action)
async function actUpdateFigcodeEditor(args, _ctx) {
  if (typeof args.code !== 'string' || args.code.length < 5) {
    return { error: 'missing_code', message: '需要 code 字段（完整的 R 代码）' };
  }
  if (args.code.length > 30000) {
    return { error: 'code_too_long', message: '代码超过 30K 字符上限' };
  }
  // Server-side validation only — actual injection happens on the frontend
  // when it receives the tool_result SSE event.
  return {
    ok: true,
    type: 'update_figcode_editor',
    autoRun: args.autoRun !== false,
    codeLen: args.code.length,
    code: args.code, // sent to frontend via SSE
    message: '已为你重写编辑器代码' + (args.autoRun !== false ? '并自动运行' : '') + '。',
  };
}

// SCRNA_UI_ACT_v1 — frontend-side UI controls for the result view
async function actSwitchResultTab(args, _ctx) {
  const allowed = ['preview', 'plots', 'data', 'params'];
  if (!allowed.includes(args.tab)) return { error: 'invalid_tab' };
  return {
    ok: true,
    type: 'switch_result_tab',
    tab: args.tab,
    message: '已切换到 ' + args.tab + ' 页',
  };
}
async function actFocusCluster(args, _ctx) {
  if (args.cluster == null) return { error: 'missing_cluster' };
  return {
    ok: true,
    type: 'focus_cluster',
    cluster: String(args.cluster),
    message: '已聚焦 cluster ' + args.cluster,
  };
}
async function actHighlightGene(args, _ctx) {
  const gene = String(args.gene || '').trim();
  if (!gene) return { error: 'missing_gene' };
  return { ok: true, type: 'highlight_gene', gene, message: '已按基因 ' + gene + ' 着色' };
}

// SCRNA_DATA_ACT_v1 — frontend-side ops on the dataset / result page
async function actSelectCells(args, ctx) {
  // SELECT_CELLS_AUTO_v1
  if (!args.columnFilters || typeof args.columnFilters !== 'object')
    return { error: 'missing_columnFilters' };
  const userId = ctx.userId;
  const subsetName = (args.subsetName || '').trim();

  // No subsetName → just emit filter event for frontend (legacy behavior)
  if (!subsetName) {
    return {
      ok: true,
      type: 'select_cells',
      columnFilters: args.columnFilters,
      subsetName: null,
      message: '已按筛选条件选中匹配细胞。如要保存为子集请告诉我名字。',
    };
  }

  // Need datasetId + ownership
  const datasetId = args.datasetId || (ctx.context && ctx.context.datasetId);
  if (!datasetId) return { error: 'missing_datasetId', message: '请告诉我在哪个数据集上做子集。' };

  const dsRow = sqlite
    .prepare(
      `SELECT d.* FROM datasets d JOIN projects p ON d.project_id=p.id WHERE d.id=? AND p.user_id=?`
    )
    .get(datasetId, userId);
  if (!dsRow) return { error: 'dataset_not_found' };

  // Fetch metaUrl — datasets table has a meta_url column
  const metaUrl = dsRow.meta_url;
  if (!metaUrl)
    return {
      error: 'no_meta',
      message: '该数据集还没有 metadata，无法按列筛选。请先做完标准分析生成 metadata。',
    };

  // Fetch CSV — 本地 /api/files/ 走本地文件；其它 URL 走 HTTP 拉取
  const config = require('../config');
  let text = '';

  if (metaUrl && metaUrl.startsWith('/api/files/')) {
    // 本地存储路径：/api/files/<key> → 从本地 results 目录读
    try {
      const key = metaUrl.replace('/api/files/', '');
      const localPath = require('path').join(
        config.localResultsDir || '',
        key
      );
      if (require('fs').existsSync(localPath)) {
        text = require('fs').readFileSync(localPath, 'utf8');
      }
    } catch {}
  } else {
    // 原有逻辑：从 HTTP/HTTPS URL 拉取（OSS 或其他）
    text = await new Promise((resolve) => {
      try {
        const isHttps = metaUrl.startsWith('https:');
        const lib = require(isHttps ? 'https' : 'http');
        let buf = '';
        const req = lib.get(metaUrl, { timeout: 15000 }, (res) => {
          if (res.statusCode !== 200) {
            resolve('');
            return;
          }
          res.setEncoding('utf8');
          res.on('data', (c) => {
            buf += c;
            if (buf.length > 50_000_000) {
              try {
                res.destroy();
              } catch {}
              resolve(buf);
            }
          });
          res.on('end', () => resolve(buf));
        });
        req.on('error', () => resolve(''));
        req.on('timeout', () => {
          try {
            req.destroy();
          } catch {}
          resolve('');
        });
      } catch {
        resolve('');
      }
    });
  }
  if (!text)
    return { error: 'fetch_meta_failed', message: '拿不到 metadata 文件，可能 OSS 暂时不可达。' };

  // Parse CSV (same logic as frontend CsvTable)
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return { error: 'meta_empty' };
  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuote = !inQuote;
        continue;
      }
      if (c === ',' && !inQuote) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);

  const cellIdIdx = headers.findIndex(
    (h) => h === 'cell_id' || h === 'CellID' || h === 'barcode' || h === 'cellID'
  );
  if (cellIdIdx < 0) return { error: 'no_cell_id_column' };

  // Apply filters (mirror CsvTable logic, including comparison ops)
  const filterKeys = Object.keys(args.columnFilters).filter((k) =>
    String(args.columnFilters[k] || '').trim()
  );
  const matched = rows.filter((r) =>
    filterKeys.every((col) => {
      const idx = headers.indexOf(col);
      if (idx < 0) return false; // unknown column → filter fails
      const cellRaw = r[idx] || '';
      const searchStr = String(args.columnFilters[col]).trim();
      // FILTER_AND_OR_v1
      return testFilterExpr(cellRaw, searchStr);
    })
  );

  if (matched.length === 0) return { error: 'no_matches', message: '筛选条件没有匹配到任何细胞。' };

  // Sanity cap
  if (matched.length > 200_000) {
    return {
      error: 'too_many_cells',
      message: '匹配到 ' + matched.length + ' 个细胞，超过上限 20 万。请加更严格的筛选条件。',
    };
  }

  const cellIds = matched.map((r) => r[cellIdIdx]).filter(Boolean);
  if (cellIds.length === 0) return { error: 'no_cell_ids_extracted' };

  // Create subset through the shared database helper.
  const subset = dbMod.createSubset({
    datasetId,
    name: subsetName,
    description: '由 AI 通过筛选条件创建：' + JSON.stringify(args.columnFilters).slice(0, 200),
    cellIds,
  });

  return {
    ok: true,
    type: 'select_cells',
    columnFilters: args.columnFilters,
    subsetName,
    subsetId: subset && subset.id,
    cellCount: cellIds.length,
    message: '已创建子集 "' + subsetName + '" — 包含 ' + cellIds.length + ' 个细胞。',
  };
}
async function actFilterTable(args, _ctx) {
  if (!args.columnFilters || typeof args.columnFilters !== 'object')
    return { error: 'missing_columnFilters' };
  return {
    ok: true,
    type: 'filter_table',
    columnFilters: args.columnFilters,
    message: '已应用表格筛选，匹配的行已自动选中。',
  };
}
async function actLabelCells(args, _ctx) {
  if (!args.labelKey || !args.labelValue) return { error: 'missing_label_args' };
  return {
    ok: true,
    type: 'label_cells',
    labelKey: args.labelKey,
    labelValue: args.labelValue,
    columnFilters: args.columnFilters || null,
    message: '已打开标签对话框，请确认后保存。',
  };
}
async function actMergeDatasets(args, _ctx) {
  if (!Array.isArray(args.datasetIds) || args.datasetIds.length < 2)
    return { error: 'need_2_datasets' };
  return {
    ok: true,
    type: 'merge_datasets',
    datasetIds: args.datasetIds,
    mergeName: args.mergeName || null,
    message: '已打开数据集合并对话框，请确认后提交。',
  };
}
async function actOpenReplot(args, _ctx) {
  if (!args.analysisId) return { error: 'missing_analysisId' };
  return {
    ok: true,
    type: 'open_replot',
    analysisId: args.analysisId,
    message: '已为你打开在线绘图编辑器，可基于当前 RDS 自由绘制。',
  };
}
async function actUploadDataHint(_args, _ctx) {
  return {
    ok: true,
    type: 'upload_data_hint',
    message: '已为你定位到上传区域，把 .h5/.rds/.mtx 拖进去就能开始。',
  };
}

// OPEN_FIGCODE_PLOT_v1

async function actOpenTool(args, _ctx) {
  const toolId = args.toolId;
  if (!toolId) return { error: 'missing_toolId' };
  const toolNames = {
    deseq2: 'DESeq2 差异分析',
    'go-kegg': 'GO/KEGG ORA',
    'km-survival': 'KM 生存分析',
    gsea: 'GSEA',
    'bindea-immune': '免疫浸润',
    wgcna: 'WGCNA',
    'lasso-cox': 'LASSO Cox',
    'seurat-standard': 'Seurat 标准流程',
    'maftools-mutation': 'maftools 突变',
    cellchat: 'CellChat 通讯',
    'ml-feature-select': 'ML 特征选择',
    'ml-classifier': 'ML 分类器',
    'rsf-survival': '随机生存森林',
    'shap-explain': 'SHAP 可解释性',
    'consensus-cluster': '一致性聚类',
    'ml-scvi-annotate': 'scVI 自动注释',
    'mo-mofa': 'MOFA2 因子分析',
    'mo-snf': 'SNF 网络融合',
  };
  const name = toolNames[toolId] || toolId;
  return {
    ok: true,
    type: 'open_tool',
    toolId,
    message: '已打开 ' + name + ' 工具，请上传数据或使用示例数据开始分析。',
  };
}

async function actOpenFigcodePlot(args, ctx) {
  const id = String(args.figcardId || '').trim();
  if (!id) return { error: 'missing_figcardId' };
  const result = {
    ok: true,
    type: 'open_figcode_plot',
    figcardId: id,
    message: '已打开 FigCode ' + id + ' 的在线绘图，可以直接开始定制。',
  };
  // FIGCODE_PAGE_RACE_FIX_v1: mark implied page so subsequent update_figcode_editor passes
  _setImpliedPage(ctx, 'figcode');
  return result;
}

// VERIFY_STATE_v1 — fetch entity, compare expected fields, return diff

module.exports = {
  tool_plan,
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
};
