'use strict';

/**
 * item88 第二波：变更单（文档链第三份，设计稿 §3.3 / §4.7）。
 * 结构化字段进 wb_changes，文档本体进 wb_documents 的 append-only chain_hash 链。
 */

const REQUIRED_FIELDS = [
  ['taskRef', 'change_task_ref_required'],
  ['impact', 'change_impact_required'],
  ['decision', 'change_decision_required'],
  ['effectiveVersion', 'change_effective_version_required'],
];

function validateChangeOrder(order) {
  const raw = order && typeof order === 'object' ? order : {};
  const issues = [];
  for (const [field, code] of REQUIRED_FIELDS) {
    const value = raw[field];
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
