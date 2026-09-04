'use strict';

/**
 * Pure Agent tool policy. This module classifies a validated call but never
 * performs I/O, issues confirmation tokens, or executes a handler.
 */

const MUTATING_SIDE_EFFECTS = new Set(['state-write', 'workspace-write', 'execution']);
const READ_ONLY_RUN_TOOL_OPS = new Set(['list', 'plan', 'status', 'next', 'bind_artifact']);
const READ_ONLY_PLAN_OPS = new Set(['list', 'get']);
const SCIENTIFIC_SOURCE_EXTENSIONS = new Set([
  '.csv', '.tsv', '.h5ad', '.h5', '.loom', '.rds', '.rdata', '.mtx',
  '.vcf', '.bam', '.sam', '.fastq', '.fq', '.bed', '.gff', '.gtf',
  '.xlsx', '.xls',
]);
const DERIVED_DATA_PREFIXES = ['results/', 'derived/', 'outputs/', 'work/', '.biof3/'];

function isProtectedScientificSource(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (!normalized || DERIVED_DATA_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return false;
  const basename = normalized.split('/').pop() || '';
  const dot = basename.lastIndexOf('.');
  const extension = dot >= 0 ? basename.slice(dot).toLowerCase() : '';
  return SCIENTIFIC_SOURCE_EXTENSIONS.has(extension);
}

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
    return { mutating: false, delegatedApproval: false, allowedDownstream: [] };
  }
  if (name === 'run_tool') {
    if (READ_ONLY_RUN_TOOL_OPS.has(args && args.op)) {
      // Plugin tool read-only ops must not chain into shell-execution side effects.
      return { mutating: false, delegatedApproval: false, allowedDownstream: [] };
    }
    if (args && args.op === 'run') {
      // BLOCK-10 S-001 minimal fix: when a plugin tool run is delegated
      // for execution, declare the downstream side effects it may legally
      // invoke. We deliberately keep this conservative — shell is the
      // primary attack surface (plugin → Rscript/Python bin → /bin/sh).
      // Plugins are not allowed to chain into `shell` or `workspace_exec`
      // directly via policy; the plugin runner enforces this via
      // checkAllowedDownstream() before execFile().
      return {
        mutating: true,
        delegatedApproval: true,
        allowedDownstream: ['r-runner', 'python-runner'],
      };
    }
  }
  if (name === 'plan' && READ_ONLY_PLAN_OPS.has(args && args.op)) {
    return { mutating: false, delegatedApproval: false, allowedDownstream: [] };
  }
  return {
    mutating: MUTATING_SIDE_EFFECTS.has(contract && contract.sideEffect),
    delegatedApproval: false,
    // Non-plugin operations never chain — they are leaf side effects.
    allowedDownstream: [],
  };
}

/**
 * BLOCK-10 S-001 single-line gate: refuse a downstream call when the
 * declared operation does not whitelist it. Callers should consult this
 * before invoking execFile() / spawn() inside plugin runners.
 *
 * @param {{allowedDownstream?: string[]}|null|undefined} operation - result of effectiveOperation()
 * @param {string} downstream - canonical side-effect token, e.g. 'shell' / 'r-runner' / 'python-runner'
 * @returns {boolean} true when the downstream call is permitted
 */
function checkAllowedDownstream(operation, downstream) {
  if (!operation || typeof operation !== 'object') return false;
  const allowed = Array.isArray(operation.allowedDownstream) ? operation.allowedDownstream : [];
  if (allowed.length === 0) return false;
  return allowed.includes(downstream);
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
  if (error === 'access_mode_read_only') {
    return deny('read_only', error, preflight.message || '聊天当前处于只读模式，禁止执行命令。');
  }
  if (error === 'access_mode_workspace_write') {
    return deny('read_only', error, preflight.message || '项目写模式仅允许项目内写入与前台命令，该操作需要完全访问模式。');
  }
  return deny('invalid_arguments', error, preflight.message || '工具参数或目标无效。');
}

function decideAgentToolCall({ name, args = {}, ctx = {}, contract, preflight = null }) {
  if (!contract) {
    return deny('unknown_tool', 'unknown_tool', `未知工具: ${name}`);
  }

  const operation = effectiveOperation(name, args, contract);
  // BLOCK-55 P1 — Spec 门 plan 模式：只允许 plan 工具（起草/修订计划本身）与
  // 只读探索，其余有副作用工具一律拒绝；计划获批（planMode 关闭）后自动恢复。
  // 复用既有 policy 单闸，不新建第二套权限系统；plan 合同虽是 state-write，
  // 但它是 plan 模式的被授权主体（对齐 codex「plan 模式只留 update_plan」）。
  if (operation.mutating && ctx.planMode === true && name !== 'plan') {
    return deny(
      'read_only',
      'plan_mode_active',
      '计划模式：当前仅进行方案讨论与计划起草，禁止执行有副作用的工具。计划获批后自动恢复执行能力。'
    );
  }
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
  // BLOCK-56 P2 — workspace-write 中间档白名单：仅放行项目内文件写
  // （sideEffect 'workspace-write'：workspace_write/replace）与前台命令
  // （workspace_exec，黑名单 + cwd 限项目根由 workspace-tools 兜底）。
  // 其余 execution/state-write 面（后台进程/进程停止/插件委托 run_tool/act/
  // plan 落库/result-studio 变更集等）维持 full 专属。
  if (
    operation.mutating &&
    ctx.accessMode === 'workspace-write' &&
    contract.sideEffect !== 'workspace-write' &&
    name !== 'workspace_exec'
  ) {
    return deny(
      'read_only',
      'access_mode_workspace_write',
      '聊天当前处于项目写模式：仅允许项目内文件写入与前台命令执行；后台进程、插件执行与系统写操作需要完全访问模式。'
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

  if (
    preflight.exists &&
    (name === 'workspace_write' || name === 'workspace_replace') &&
    isProtectedScientificSource(preflight.relativePath)
  ) {
    return deny(
      'source_data_immutable',
      'source_data_immutable',
      '科学源数据不可原地修改。请在 derived/ 或 results/ 下创建派生文件，并保留原始输入 hash。'
    );
  }
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
  // BLOCK-56 P2 — workspace-write 中间档放行前台命令执行（commandVerdict 黑名单
  // 维持 + cwd 由 resolveWorkspaceTarget 限定项目根）；后台进程/插件委托仍需 full。
  if (
    name === 'workspace_exec' &&
    !['full', 'workspace-write'].includes(ctx.accessMode)
  ) {
    return deny(
      'read_only',
      'access_mode_read_only',
      '聊天当前处于只读模式，禁止执行命令。'
    );
  }

  return allow(operation.delegatedApproval ? 'delegated_approval' : 'policy_allowed', {
    delegatedApproval: operation.delegatedApproval,
  });
}

module.exports = {
  decideAgentToolCall,
  effectiveOperation,
  isProtectedScientificSource,
  checkAllowedDownstream,
};
