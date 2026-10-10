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
const DERIVED_DATA_PREFIXES = ['results/', 'derived/', 'outputs/', 'work/', '.petri/'];

// BLOCK-160 W2 P1（ORC-2）— 动态审批两维（预裁决缺省，蓝图 §3.4）。
// 命令维度 = 系统级破坏命令首 token（**不含 rm/del 等常规命令**——日常操作不拦，
// 用户需更严由 ORC-1 规则自配；静态黑名单已兜底最坏面）。
const DANGEROUS_FIRST_TOKENS = new Set([
  'format', 'mkfs', 'dd', 'diskpart', 'fsutil', 'cipher',
  'vssadmin', 'bcdedit', 'wipefs', 'shutdown',
]);
// 路径维度 = 敏感系统/凭证目录子串模式（大小写不敏感；刻意排除 /usr/bin、
// Program Files 等高频合法前缀，控制误报面）。
const SENSITIVE_PATH_PATTERNS = [
  '\\windows\\', '/windows/', 'system32', '/etc/', '/boot/', '/proc/',
  '/sys/kernel', '.ssh', '.gnupg', '.aws', '$recycle.bin',
];

function firstToken(command) {
  const raw = String(command || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  // 归一化：剥可执行后缀与派生名（format.com→format / mkfs.ext4→mkfs）
  const base = raw.replace(/\.(exe|com|cmd|bat)$/, '');
  return base.includes('.') ? base.split('.')[0] : base;
}

function normalizePathLike(value) {
  return String(value || '').replaceAll('\\', '/').toLowerCase();
}

function matchesSensitivePath(value) {
  const normalized = normalizePathLike(value);
  return SENSITIVE_PATH_PATTERNS.some((pattern) => normalized.includes(pattern));
}

/** PATH_ARG_FIELDS：显式路径字段的内建工具映射（v1；MCP 参数无标准字段，留 v2）。 */
const PATH_ARG_FIELDS = {
  workspace_write: ['path'],
  workspace_replace: ['path'],
  workspace_exec: ['cwd'],
  workspace_exec_background: ['cwd'],
};

/**
 * ORC-2 动态维度评估（纯函数）：仅对 mutating 调用生效；命中返回
 * { flagged:true, dimension, guardKey, detail }，否则 { flagged:false }。
 * guardKey 形如 `cmd:format` / `path:c:/windows/system32/x`，供
 * ctx.dynamicGuardAcks（Set 或 {key:true} 对象）按键确认放行。
 */
function evaluateDynamicGuards(name, args = {}) {
  if (name === 'workspace_exec' || name === 'workspace_exec_background') {
    const command = String(args.command || '');
    const token = firstToken(command);
    if (token && DANGEROUS_FIRST_TOKENS.has(token)) {
      return {
        flagged: true, dimension: 'command', guardKey: `cmd:${token}`,
        detail: `命令「${token}」命中系统级破坏命令维度`,
      };
    }
    if (matchesSensitivePath(command)) {
      return {
        flagged: true, dimension: 'path', guardKey: `path:${normalizePathLike(command).slice(0, 120)}`,
        detail: '命令文本包含敏感系统/凭证路径',
      };
    }
  }
  const fields = PATH_ARG_FIELDS[name];
  if (fields) {
    for (const field of fields) {
      const value = args[field];
      if (typeof value === 'string' && value && matchesSensitivePath(value)) {
        return {
          flagged: true, dimension: 'path',
          guardKey: `path:${normalizePathLike(value).slice(0, 120)}`,
          detail: `参数 ${field} 指向敏感系统/凭证路径`,
        };
      }
    }
  }
  return { flagged: false };
}

/** ORC-1/确认 UI 共用：ctx.dynamicGuardAcks（Set 或 {key:true}）是否含该键。 */
function isGuardAcked(ctx, guardKey) {
  const acks = ctx && ctx.dynamicGuardAcks;
  if (!acks) return false;
  if (typeof acks.has === 'function') return acks.has(guardKey);
  return acks[guardKey] === true;
}

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
  // UI-303 — 计划模式激活判定：显式 planMode 标志（BLOCK-55 旧客户端兼容）或
  // accessMode='plan' 档位（档位菜单第四档）等效。
  const planModeActive = ctx.planMode === true || ctx.accessMode === 'plan';
  // BLOCK-55 P1 — Spec 门 plan 模式：只允许 plan 工具（起草/修订计划本身）与
  // 只读探索，其余有副作用工具一律拒绝；计划获批（planMode 关闭）后自动恢复。
  // 复用既有 policy 单闸，不新建第二套权限系统；plan 合同虽是 state-write，
  // 但它是 plan 模式的被授权主体（对齐 codex「plan 模式只留 update_plan」）。
  // UI-303 — 即使调用方漏传 planMode，档位本身也足以触发本闸（纵深防御）。
  if (operation.mutating && planModeActive && name !== 'plan') {
    return deny(
      'read_only',
      'plan_mode_active',
      '计划模式：当前仅进行方案讨论与计划起草，禁止执行有副作用的工具。计划获批后自动恢复执行能力。'
    );
  }
  // UI-303 — plan 模式激活时 plan 工具豁免 execution_not_allowed 闸：'plan' 档位
  // 使 inferExecutionPolicy 判 allowExecution=false（只读约束正确），但起草计划
  // 本身必须放行，否则计划模式连计划都提交不了。
  if (operation.mutating && !planModeActive && ctx.allowExecution === false) {
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

  // BLOCK-160 W2 P2（ORC-1）— 用户规则层（判定序第二层，first-match 先到先判）：
  // deny = 直接拦截；require-ack = 拦截并要求确认（ctx.dynamicGuardAcks 含
  // `rule:<id>` 键放行——与动态防护共用统一确认通道）。规则经 ctx.userRules 注入
  //（拦截器 fail-soft 缓存读），policy 保持纯函数。
  if (operation.mutating) {
    const match = evaluateUserRules(name, args, ctx);
    if (match) {
      const acked = isGuardAcked(ctx, match.guardKey);
      if (match.rule.action === 'deny' || !acked) {
        return deny(
          match.rule.action === 'deny' ? 'user_rule_denied' : 'user_rule_require_ack',
          'user_rule_triggered',
          `用户规则拦截：规则「${match.rule.id}」（${match.rule.action === 'deny' ? '动作=拒绝' : '动作=需确认'}）。` +
          `（guardKey=${match.guardKey}）`,
          { ruleId: match.rule.id, guardKey: match.guardKey }
        );
      }
    }
  }

  // BLOCK-160 W2 P1（ORC-2）— 动态维度（判定序第三层，取最严）：mutating 调用
  // 命中系统破坏命令/敏感路径 → deny+guardKey；ctx.dynamicGuardAcks 含键则放行
  //（统一确认通道：ORC-1 require-ack 规则与未来确认 UI 共用）。
  if (operation.mutating) {
    const guard = evaluateDynamicGuards(name, args);
    if (guard.flagged && !isGuardAcked(ctx, guard.guardKey)) {
      return deny(
        'dynamic_guard',
        'dynamic_guard_triggered',
        `动态防护拦截：${guard.detail}（guardKey=${guard.guardKey}）。` +
        '该调用命中动态审批维度；如属误判请调整调用方式，放行需经用户确认通道。',
        { guardKey: guard.guardKey, dimension: guard.dimension }
      );
    }
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

function evaluateUserRules(name, args, ctx = {}) {
  // 纯函数委托：规则数组来自 ctx.userRules（拦截器注入），policy 不做 I/O。
  return require('../helpers/agent-user-rules').evaluateUserRules(name, args, ctx && ctx.userRules);
}

module.exports = {
  decideAgentToolCall,
  effectiveOperation,
  evaluateUserRules,
  evaluateDynamicGuards,
  isProtectedScientificSource,
  checkAllowedDownstream,
};
