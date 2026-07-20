'use strict';

/**
 * Pure Agent tool policy. This module classifies a validated call but never
 * performs I/O, issues confirmation tokens, or executes a handler.
 */

const MUTATING_SIDE_EFFECTS = new Set(['state-write', 'workspace-write', 'execution']);
const READ_ONLY_RUN_TOOL_OPS = new Set(['list', 'plan', 'status', 'next', 'bind_artifact']);
const READ_ONLY_PLAN_OPS = new Set(['list', 'get']);

function allow(reason = 'policy_allowed', extra = {}) {
  return {
    decision: 'allow',
    reason,
    messageKey: `agent_tool.${reason}`,
    ...extra,
  };
}

function deny(reason, error, message, extra = {}) {
  return {
    decision: 'deny',
    reason,
    error,
    message,
    messageKey: `agent_tool.${reason}`,
    ...extra,
  };
}

function effectiveOperation(name, args, contract) {
  if ((name === 'workspace_write' || name === 'workspace_replace') && args && args.dryRun === true) {
    return { mutating: false, delegatedApproval: false };
  }
  if (name === 'run_tool') {
    if (READ_ONLY_RUN_TOOL_OPS.has(args && args.op)) {
      return { mutating: false, delegatedApproval: false };
    }
    if (args && args.op === 'run') {
      return { mutating: true, delegatedApproval: true };
    }
  }
  if (name === 'plan' && READ_ONLY_PLAN_OPS.has(args && args.op)) {
    return { mutating: false, delegatedApproval: false };
  }
  return {
    mutating: MUTATING_SIDE_EFFECTS.has(contract && contract.sideEffect),
    delegatedApproval: false,
  };
}

function preflightDenial(preflight) {
  const error = preflight.error || 'policy_denied';
  if (error === 'project_required' || error === 'project_not_found' || error === 'workspace_unavailable') {
    return deny('project_required', error, preflight.message || '该工具需要有效项目工作区。');
  }
  if (error === 'unauthorized' || error === 'permission_denied' || error === 'project_archived') {
    return deny('permission_denied', error, preflight.message || '无权访问该项目工作区。');
  }
  if (
    error === 'absolute_path_not_allowed' ||
    error === 'sensitive_path' ||
    error === 'path_escape' ||
    error === 'symlink_escape' ||
    error === 'symlink_not_allowed' ||
    error === 'command_blocked'
  ) {
    return deny('policy_denied', error, preflight.message || '工具调用被安全策略拒绝。');
  }
  return deny('invalid_arguments', error, preflight.message || '工具参数或目标无效。');
}

function decideAgentToolCall({ name, args = {}, ctx = {}, contract, preflight = null }) {
  if (!contract) {
    return deny('unknown_tool', 'unknown_tool', `未知工具: ${name}`);
  }

  const operation = effectiveOperation(name, args, contract);
  if (operation.mutating && ctx.allowExecution === false) {
    return deny(
      'read_only',
      'execution_not_allowed',
      '用户当前明确要求只检查或规划，禁止执行分析、修改文件或运行命令。',
      { policySource: ctx.executionPolicyReason || 'explicit_read_only_request' }
    );
  }
  if (operation.mutating && ctx.accessMode === 'read') {
    return deny(
      'read_only',
      'access_mode_read_only',
      '聊天当前处于只读模式，禁止执行有副作用的工具。'
    );
  }
  if (contract.riskTier === 'R3') {
    return deny('policy_denied', 'policy_denied', '该工具风险等级不允许由 Agent 执行。');
  }

  // The interceptor calls the pure policy once before I/O so read-only denials
  // remain deterministic, then again with workspace preflight facts.
  if (!preflight) {
    return allow(operation.delegatedApproval ? 'delegated_approval' : 'policy_allowed', {
      delegatedApproval: operation.delegatedApproval,
    });
  }
  if (preflight.ok === false) return preflightDenial(preflight);

  if (name === 'workspace_write' && preflight.exists) {
    if (args.overwrite !== true || !args.expectedSha256) {
      return deny(
        'overwrite_requires_sha256',
        'expected_sha256_required',
        '完整覆写已有文件前必须先读取文件，并传入 overwrite=true 和 expectedSha256。'
      );
    }
  }
  if (name === 'workspace_replace' && !args.expectedSha256) {
    return deny(
      'replace_requires_sha256',
      'expected_sha256_required',
      '文本替换前必须先读取文件并传入 expectedSha256。'
    );
  }
  if (name === 'workspace_exec' && preflight.commandRisk !== 'read_only') {
    return deny(
      'command_not_allowlisted',
      'command_not_allowlisted',
      '该命令不在自动执行白名单中，当前调用未执行。'
    );
  }

  return allow(operation.delegatedApproval ? 'delegated_approval' : 'policy_allowed', {
    delegatedApproval: operation.delegatedApproval,
  });
}

module.exports = {
  decideAgentToolCall,
  effectiveOperation,
};
