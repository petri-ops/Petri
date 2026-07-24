'use strict';
const contract = require('./g0/security-permission-matrix.json');
const SECURITY_PERMISSION_VERSION = 2;
const HARD_BLOCKS = new Set(['cross_project_access', 'credential_exposure', 'scientific_source_overwrite', 'privilege_escalation', 'remote_push', 'remote_script_pipe']);

function evaluatePermissionAction({ mode = 'confirm', dimension, risk = 'low', projectScoped = true, reversible = true, externalSideEffect = false, boundary = null, developer = false } = {}) {
  const reasons = [];
  if (!contract.dimensions.includes(dimension)) reasons.push('dimension_unknown');
  if (!projectScoped) reasons.push('cross_project_access');
  if (boundary && HARD_BLOCKS.has(boundary)) reasons.push(boundary);
  if (reasons.length) return Object.freeze({ decision: 'block', reasons, auditRequired: true });
  if (mode === 'read' && dimension !== 'filesystem') return Object.freeze({ decision: 'block', reasons: ['mode_read_only'], auditRequired: true });
  if (externalSideEffect || !reversible || risk === 'high') return Object.freeze({ decision: 'confirm', reasons: ['material_side_effect'], auditRequired: true });
  if (mode === 'full' || (developer && mode === 'developer')) return Object.freeze({ decision: 'auto', reasons: [], auditRequired: true });
  return Object.freeze({ decision: 'confirm', reasons: ['mode_requires_confirmation'], auditRequired: true });
}
module.exports = { SECURITY_PERMISSION_VERSION, contract, evaluatePermissionAction };
