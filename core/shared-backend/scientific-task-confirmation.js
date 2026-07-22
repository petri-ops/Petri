'use strict';

const crypto = require('crypto');
const {
  normalizeScientificTaskSpec,
  validateScientificTaskSpec,
  hashScientificTaskSpec,
  transitionScientificTaskSpec,
  stableStringify,
} = require('./scientific-task-spec');

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function confirmationIssues(spec, plan, confirmation = {}) {
  const issues = [];
  if (!plan || typeof plan !== 'object') issues.push({ code: 'plan_required', message: '必须提供 HRT-2 候选计划。' });
  if (plan && plan.status !== 'ready_for_confirmation') issues.push({ code: 'plan_not_ready', message: `计划状态为 ${plan.status || 'unknown'}，不能进入确认。` });
  if (spec.status !== 'ready_for_confirmation') issues.push({ code: 'task_not_ready', message: `TaskSpec 状态为 ${spec.status}，不能确认。` });
  if (!confirmation.userId) issues.push({ code: 'confirming_user_required', message: '确认人不能为空。' });
  if (confirmation.riskAcknowledged !== true) issues.push({ code: 'risk_not_acknowledged', message: '用户必须明确确认风险和失败边界。' });
  const expectedHashes = Object.fromEntries((spec.inputs || []).map((input) => [input.relativePath, input.sha256]));
  const actualHashes = confirmation.inputHashes && typeof confirmation.inputHashes === 'object' ? confirmation.inputHashes : {};
  for (const [relativePath, sha256] of Object.entries(expectedHashes)) {
    if (!sha256) issues.push({ code: 'input_hash_missing', path: relativePath, message: '确认前必须锁定输入 SHA-256。' });
    else if (actualHashes[relativePath] !== sha256) issues.push({ code: 'input_hash_mismatch', path: relativePath, message: '确认时输入哈希与 TaskSpec 不一致。' });
  }
  if (!confirmation.method || confirmation.method !== spec.method.category) issues.push({ code: 'method_mismatch', message: '确认的方法必须与 TaskSpec 方法类别一致。' });
  if (!Array.isArray(confirmation.requestedDeliverables) || confirmation.requestedDeliverables.length === 0) issues.push({ code: 'deliverables_required', message: '确认必须包含预期交付物。' });
  return issues;
}

function createScientificTaskConfirmationPreview({ taskSpec, plan, evidence = [], estimatedResources = null } = {}) {
  const spec = normalizeScientificTaskSpec(taskSpec);
  const validation = validateScientificTaskSpec(spec, { normalized: true });
  if (!validation.ok) return { ok: false, error: 'scientific_task_spec_invalid', issues: validation.issues };
  const taskSpecHash = hashScientificTaskSpec(spec);
  return {
    ok: true,
    status: spec.status,
    taskSpecHash,
    preview: {
      taskId: spec.taskId,
      projectId: spec.projectId,
      conversationId: spec.conversationId,
      originalRequest: spec.originalRequest,
      inputs: spec.inputs.map((input) => ({ relativePath: input.relativePath, sha256: input.sha256, sizeBytes: input.sizeBytes, role: input.role })),
      method: spec.method,
      requestedDeliverables: spec.requestedDeliverables,
      evidence,
      plan: plan || null,
      estimatedResources,
      sideEffects: { createsToolJob: false, writesWorkspace: false },
      confirmationRequired: true,
    },
  };
}

function confirmScientificTask({ taskSpec, plan, confirmation = {} } = {}) {
  const spec = normalizeScientificTaskSpec(taskSpec);
  const validation = validateScientificTaskSpec(spec, { normalized: true });
  if (!validation.ok) return { ok: false, error: 'scientific_task_spec_invalid', issues: validation.issues };
  const issues = confirmationIssues(spec, plan, confirmation);
  if (issues.length) return { ok: false, error: 'confirmation_rejected', issues, taskSpecHash: hashScientificTaskSpec(spec) };
  const transitioned = transitionScientificTaskSpec(spec, 'confirmed');
  if (!transitioned.ok) return transitioned;
  const record = {
    confirmationVersion: 1,
    confirmedAt: confirmation.confirmedAt || new Date().toISOString(),
    userId: String(confirmation.userId),
    taskSpecHash: transitioned.specHash,
    planHash: plan.planHash || digest(plan),
    selectedToolId: plan.recommendation?.toolId || null,
    inputHashes: { ...confirmation.inputHashes },
    method: confirmation.method,
    params: confirmation.params && typeof confirmation.params === 'object' ? confirmation.params : {},
    requestedDeliverables: [...confirmation.requestedDeliverables],
    riskAcknowledged: true,
  };
  return { ok: true, spec: transitioned.spec, taskSpecHash: transitioned.specHash, confirmation: record, createsToolJob: false };
}

function validateScientificTaskExecution({ persistedTask, projectId, toolId, params = {} } = {}) {
  if (!persistedTask) return { ok: false, error: 'scientific_task_not_found' };
  if (persistedTask.status !== 'confirmed' || !persistedTask.confirmation) return { ok: false, error: 'scientific_task_not_confirmed' };
  if (!projectId || persistedTask.project_id !== projectId) return { ok: false, error: 'scientific_task_project_mismatch' };
  if (persistedTask.tool_job_id) return { ok: false, error: 'scientific_task_already_bound', toolJobId: persistedTask.tool_job_id };
  if (persistedTask.confirmation.selectedToolId && persistedTask.confirmation.selectedToolId !== toolId) {
    return { ok: false, error: 'scientific_task_tool_changed', expected: persistedTask.confirmation.selectedToolId, actual: toolId };
  }
  const expectedParams = persistedTask.confirmation.params || {};
  const actualParams = params || {};
  if (stableStringify(expectedParams) !== stableStringify(actualParams)) return { ok: false, error: 'scientific_task_params_changed' };
  return { ok: true, taskId: persistedTask.task_id, version: persistedTask.version, specHash: persistedTask.spec_hash };
}

module.exports = { confirmationIssues, createScientificTaskConfirmationPreview, confirmScientificTask, validateScientificTaskExecution };
