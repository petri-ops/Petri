const dbMod = require('../db');
const sqlite = dbMod.getSqliteForLegacyModules();

async function tool_verify_state(args, ctx) {
  const userId = ctx.userId;
  if (!userId) return {error: 'unauthorized'};
  const db = sqlite;
  const expect = args.expect || {};
  let actual = null;

  try {
    if (args.kind === 'analysis') {
      if (!args.id) return {error: 'missing_id'};
      actual = db.prepare(`SELECT a.id, a.name, a.type, a.status, a.error FROM analyses a JOIN datasets d ON a.dataset_id=d.id JOIN projects p ON d.project_id=p.id WHERE a.id=? AND p.user_id=?`).get(args.id, userId);
    } else if (args.kind === 'project') {
      if (!args.id) return {error: 'missing_id'};
      actual = db.prepare('SELECT id, name, description FROM projects WHERE id=? AND user_id=?').get(args.id, userId);
    } else if (args.kind === 'dataset') {
      if (!args.id) return {error: 'missing_id'};
      actual = db.prepare(`SELECT d.id, d.name, d.n_cells, d.n_genes FROM datasets d JOIN projects p ON d.project_id=p.id WHERE d.id=? AND p.user_id=?`).get(args.id, userId);
    } else if (args.kind === 'plan') {
      if (!args.id) return {error: 'missing_id'};
      actual = db.prepare('SELECT id, title, status FROM copilot_plans WHERE id=? AND user_id=?').get(args.id, userId);
    } else if (args.kind === 'plan_step') {
      if (!args.planId || typeof args.stepN !== 'number') return {error: 'missing_args'};
      const plan = db.prepare('SELECT id FROM copilot_plans WHERE id=? AND user_id=?').get(args.planId, userId);
      if (!plan) return {error: 'plan_not_found'};
      actual = db.prepare('SELECT plan_id, n, title, status, result FROM copilot_plan_steps WHERE plan_id=? AND n=?').get(args.planId, args.stepN);
    } else if (args.kind === 'context') {
      // Context lives in the request — we just echo what the chat handler passed
      actual = ctx.context || {};
    } else {
      return {error: 'unknown_kind'};
    }
    if (!actual) return {error: 'not_found', kind: args.kind};

    // Compare each expected key
    const mismatches = [];
    for (const k of Object.keys(expect)) {
      const want = expect[k];
      const got = actual[k];
      if (got === undefined) {
        mismatches.push({field: k, expected: want, actual: '(undefined)'});
      } else if (typeof want === 'string' && typeof got === 'string') {
        if (got !== want) mismatches.push({field: k, expected: want, actual: got});
      } else if (got !== want) {
        mismatches.push({field: k, expected: want, actual: got});
      }
    }
    return {
      ok: mismatches.length === 0,
      kind: args.kind,
      actual,
      expect,
      mismatches,
      message: mismatches.length === 0
        ? '状态符合预期'
        : '状态不符：' + mismatches.map(m => `${m.field} 应为 ${m.expected}，实际 ${m.actual}`).join('；'),
    };
  } catch (e) {
    return {error: 'verify_failed', message: e.message};
  }
}

// --------------------------------------------------------------
// Dispatch
// --------------------------------------------------------------

module.exports = { tool_verify_state };
