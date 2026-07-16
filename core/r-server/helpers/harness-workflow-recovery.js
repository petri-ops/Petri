const EXECUTABLE_RECOVERY_ACTIONS = new Set(['reconcile_artifacts', 'retry_run']);

function createRecoveryConfirmationStore(options = {}) {
  const ttlMs = options.ttlMs || 5 * 60 * 1000;
  const now = options.now || (() => Date.now());
  const tokenFactory = options.tokenFactory || (() => `wf_${require('crypto').randomUUID()}`);
  const records = new Map();
  return {
    issue(payload) {
      const token = tokenFactory();
      const record = { ...payload, expiresAt: now() + ttlMs };
      records.set(token, record);
      return { token, ...record };
    },
    consume(token, expected = {}) {
      const record = records.get(token);
      records.delete(token);
      if (!record || record.expiresAt < now()) {
        return { ok: false, error: 'confirmation_invalid_or_expired' };
      }
      for (const [key, value] of Object.entries(expected)) {
        if (record[key] !== value) {
          return { ok: false, error: 'confirmation_invalid_or_expired' };
        }
      }
      return { ok: true, record };
    },
  };
}

function validateWorkflowRecoveryAction(job, actionId) {
  if (!job) return { ok: false, error: 'job_not_found' };
  if (!EXECUTABLE_RECOVERY_ACTIONS.has(actionId)) {
    return { ok: false, error: 'action_requires_agent' };
  }
  if (actionId === 'reconcile_artifacts') {
    const result = job.result || job.result_json;
    if (!result) return { ok: false, error: 'result_not_available' };
    return { ok: true };
  }
  if (!['failed', 'cancelled'].includes(String(job.status || '').toLowerCase())) {
    return { ok: false, error: 'job_not_retryable' };
  }
  if (!job.tool_id && !job.toolId) return { ok: false, error: 'tool_not_available' };
  return { ok: true };
}

function appendWorkflowRecoveryAudit(params, entry, maxEntries = 20) {
  const source = params && typeof params === 'object' ? params : {};
  const history = Array.isArray(source.__harnessRecovery) ? source.__harnessRecovery : [];
  return {
    ...source,
    __harnessRecovery: [...history, entry].slice(-maxEntries),
  };
}

function publicRecoveryParams(params) {
  if (!params || typeof params !== 'object') return {};
  const { __harnessRecovery, ...publicParams } = params;
  return publicParams;
}

module.exports = {
  EXECUTABLE_RECOVERY_ACTIONS,
  appendWorkflowRecoveryAudit,
  createRecoveryConfirmationStore,
  publicRecoveryParams,
  validateWorkflowRecoveryAction,
};
