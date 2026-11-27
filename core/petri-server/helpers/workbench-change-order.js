'use strict';

/**
 * item88 第二波：变更单（文档链第三份，设计稿 §3.3 / §4.7）。
 * 结构化字段进 wb_changes，文档本体进 wb_documents 的 append-only chain_hash 链。
 */

function validateChangeOrder(order) {
  const raw = order && typeof order === 'object' ? order : {};
  const issues = [];
  // item90/lint:ledger——动态键改为封闭字段显式解构（REQUIRED_FIELDS 语义逐字保留）
  const { taskRef, impact, decision, effectiveVersion } = raw;
  // 显式字段值表（值来自上方封闭解构，无动态键访问）
  const checks = [
    { field: 'taskRef', code: 'change_task_ref_required', value: taskRef },
    { field: 'impact', code: 'change_impact_required', value: impact },
    { field: 'decision', code: 'change_decision_required', value: decision },
    { field: 'effectiveVersion', code: 'change_effective_version_required', value: effectiveVersion },
  ];
  for (const { field, code, value } of checks) {
    const missing = field === 'impact'
      ? !Array.isArray(value) || value.length === 0
      : value === undefined || value === null || value === '';
    if (missing) issues.push({ code, path: field, message: `${field} is required` });
  }
  return { ok: issues.length === 0, order: raw, issues };
}

function createChangeOrder(db, order) {
  const checked = validateChangeOrder(order);
  if (!checked.ok) return checked;
  const value = checked.order;
  const id = value.id || `co_${Date.now()}`;
  db.prepare('INSERT INTO wb_changes (id, task_id, content_json, impact_json, decision, created_at) VALUES (?,?,?,?,?,?)')
    .run(
      id,
      value.taskRef,
      JSON.stringify({ reason: value.reason || null, effectiveVersion: value.effectiveVersion }),
      JSON.stringify(value.impact),
      value.decision,
      new Date().toISOString(),
    );
  const { appendWorkbenchDoc } = require('./workbench-docs');
  const doc = appendWorkbenchDoc(db, {
    id: `doc_${id}`,
    taskId: value.taskRef,
    type: 'change-order',
    version: value.effectiveVersion,
    content: value,
  });
  return { ok: true, id, doc };
}

module.exports = { validateChangeOrder, createChangeOrder };
