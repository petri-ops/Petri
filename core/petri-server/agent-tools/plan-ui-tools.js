/**
 * agent-tools/plan-ui-tools.js — Plan management + UI control acts
 */
const dbMod = require('../db');
const sqlite = dbMod.getDatabase();

// A-008: static require breaks act-tools ↔ plan-ui-tools cycle

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
    // BLOCK-55 P1 — Spec 门：draft=true 创建 draft 态计划（等待用户批准后转
    // approved 再执行）；specMd 为计划正文（目标/边界/步骤+验收标准），批准后
    // 可能作为新上下文的自包含执行依据。
    const isDraft = args.draft === true;
    db.prepare(
      `INSERT INTO copilot_plans(id, user_id, title, goal, status, chat_context_excerpt, spec_md, conversation_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      planId,
      userId,
      args.title.slice(0, 200),
      (args.goal || '').slice(0, 1000),
      isDraft ? 'draft' : 'active',
      (args.chatExcerpt || '').slice(0, 600),
      args.specMd ? String(args.specMd).slice(0, 30000) : null,
      (ctx && ctx.conversationId) || null,
      now,
      now
    );
    const stepInsert = db.prepare(
      `INSERT INTO copilot_plan_steps(plan_id, n, title, hint, assignee, status, ts) VALUES (?,?,?,?,?,?,?)`
    );
    args.steps.forEach((s, i) => {
      const n = typeof s.n === 'number' ? s.n : i + 1;
      stepInsert.run(
        planId,
        n,
        String(s.title || '').slice(0, 200),
        String(s.hint || '').slice(0, 500),
        s.assignee ? String(s.assignee).slice(0, 40) : null, // BLOCK-55 P2 步骤级分派
        'pending',
        now
      );
    });
    return {
      ok: true,
      planId,
      title: args.title,
      stepCount: args.steps.length,
      status: isDraft ? 'draft' : 'active',
      message: isDraft
        ? '计划草案已提交，等待用户批准。批准前不要执行任何其他操作。'
        : '已创建 plan，将按步骤推进',
    };
  }

  // BLOCK-55 P1 — plan 模式下修订计划正文（仅 draft 态可改；获批后走 propose_revision）
  if (op === 'update_spec') {
    if (!args.planId || typeof args.specMd !== 'string') return { error: 'missing_args' };
    const plan = db
      .prepare('SELECT id, status FROM copilot_plans WHERE id=? AND user_id=?')
      .get(args.planId, userId);
    if (!plan) return { error: 'plan_not_found' };
    if (plan.status !== 'draft') {
      return { error: 'plan_not_draft', message: '仅 draft 态计划可更新 spec；已批准计划请用 propose_revision 提修订案。' };
    }
    db.prepare('UPDATE copilot_plans SET spec_md=?, updated_at=? WHERE id=?').run(
      String(args.specMd).slice(0, 30000),
      new Date().toISOString(),
      args.planId
    );
    return { ok: true, planId: args.planId, message: '计划草案已更新，继续等待用户批准。' };
  }

  // BLOCK-55 P3 — Replan：失败/偏离时提交修订案（提议暂存，用户批准后替换生效）
  if (op === 'propose_revision') {
    if (!args.planId || !Array.isArray(args.steps) || args.steps.length === 0) {
      return { error: 'missing_args', message: '需要 planId 和修订后的 steps[]（含保留的已完成步骤）' };
    }
    const plan = db
      .prepare('SELECT id, status FROM copilot_plans WHERE id=? AND user_id=?')
      .get(args.planId, userId);
    if (!plan) return { error: 'plan_not_found' };
    if (plan.status === 'draft') {
      return { error: 'plan_is_draft', message: 'draft 计划直接用 update_spec 修改即可，无需修订案。' };
    }
    const allowedStepStatus = new Set(['pending', 'done', 'skipped']);
    const proposed = args.steps.slice(0, 50).map((s, i) => ({
      n: typeof s.n === 'number' ? s.n : i + 1,
      title: String(s.title || '').slice(0, 200),
      hint: String(s.hint || '').slice(0, 500),
      assignee: s.assignee ? String(s.assignee).slice(0, 40) : null,
      status: allowedStepStatus.has(s.status) ? s.status : 'pending',
      result: s.result ? String(s.result).slice(0, 1000) : null,
    }));
    const revRow = db
      .prepare('SELECT COALESCE(MAX(rev_no), 0) AS maxRev FROM copilot_plan_revisions WHERE plan_id=?')
      .get(args.planId);
    const revNo = (revRow && revRow.maxRev ? revRow.maxRev : 0) + 1;
    const revId = 'prev_' + uuidv4().slice(0, 12);
    db.prepare(
      `INSERT INTO copilot_plan_revisions(id, plan_id, rev_no, reason, proposed_json, status, created_at) VALUES (?,?,?,?,?,?,?)`
    ).run(
      revId,
      args.planId,
      revNo,
      String(args.reason || '').slice(0, 1000),
      JSON.stringify(proposed),
      'proposed',
      new Date().toISOString()
    );
    db.prepare('UPDATE copilot_plans SET updated_at=? WHERE id=?').run(
      new Date().toISOString(),
      args.planId
    );
    return {
      ok: true,
      planId: args.planId,
      revisionNo: revNo,
      proposedSteps: proposed.length,
      message: `修订案 #${revNo} 已提交，等待用户批准。批准前按原计划继续或暂停，不要重复提交。`,
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

module.exports = { tool_plan };
