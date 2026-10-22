'use strict';

/**
 * Pure Agent tool policy. This module classifies a validated call but never
 * performs I/O, issues confirmation tokens, or executes a handler.
 */

const MUTATING_SIDE_EFFECTS = new Set(['state-write', 'workspace-write', 'execution']);
const READ_ONLY_RUN_TOOL_OPS = new Set(['list', 'plan', 'status', 'next', 'bind_artifact']);
const READ_ONLY_PLAN_OPS = new Set(['list', 'get']);
// BLOCK-180 P2 — 命令/路径风险规则单源（原内联定义原样迁 helpers/command-risk-rules.js，
// 动态防护判定与 span 分析共用，拦截与高亮不漂移）。
const {
  DANGEROUS_FIRST_TOKENS,
  firstToken,
  normalizePathLike,
  matchesSensitivePath,
} = require('../helpers/command-risk-rules');
// BLOCK-180 P0/P1 — 审批请求资源：指纹计算与指纹放行读侧（policy 保持纯函数，
// 资源注册/决策在拦截器与路由层）。
const {
  callFingerprint,
  isFingerprintApproved,
} = require('../helpers/approval-request-store');
const SCIENTIFIC_SOURCE_EXTENSIONS = new Set([
  '.csv', '.tsv', '.h5ad', '.h5', '.loom', '.rds', '.rdata', '.mtx',
  '.vcf', '.bam', '.sam', '.fastq', '.fq', '.bed', '.gff', '.gtf',
  '.xlsx', '.xls',
]);
const DERIVED_DATA_PREFIXES = ['results/', 'derived/', 'outputs/', 'work/', '.petri/'];

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
      // BLOCK-182 写入过审批门（用户裁决）：模型通道写项目记忆文件 .petri/MEMORY.md
      // 需经审批卡（guardKey=memory:<path>，走 BLOCK-180 审批资源/指纹放行全链）；
      // 用户面板/REST 通道不经此门。记忆是长期自我叙事面，模型自主改写须用户知情。
      if (
        typeof value === 'string' && value
        && (name === 'workspace_write' || name === 'workspace_replace')
        && /(^|[\\/])\.petri([\\/])MEMORY\.md$/i.test(value.trim().replaceAll('\\', '/'))
      ) {
        return {
          flagged: true, dimension: 'memory',
          guardKey: `memory:${normalizePathLike(value).slice(0, 120)}`,
          detail: '写入目标为项目记忆文件 .petri/MEMORY.md（长期记忆面，须用户审批）',
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

  // BLOCK-180 P1 — 指纹放行经此标记透出（拦截器在执行前消耗指纹=「放行一次」
  // 只放行一次执行尝试）。
  let fingerprintConsumable = null;
  // BLOCK-160 W2 P2（ORC-1）— 用户规则层（判定序第二层，first-match 先到先判）：
  // deny = 直接拦截；require-ack = 拦截并要求确认（ctx.dynamicGuardAcks 含
  // `rule:<id>` 键放行——与动态防护共用统一确认通道）。规则经 ctx.userRules 注入
  //（拦截器 fail-soft 缓存读），policy 保持纯函数。
  // BLOCK-180 P1 — 指纹放行层：ctx.approvedFingerprints 含调用指纹时放行该调用
  // 一次（「放行一次」的请求级语义；维度级 always 仍走既有 guardKey Set）。
  if (operation.mutating) {
    const match = evaluateUserRules(name, args, ctx);
    if (match) {
      const fingerprint = callFingerprint(name, args);
      const acked = isGuardAcked(ctx, match.guardKey);
      const fingerprintApproved = isFingerprintApproved(ctx, fingerprint);
      if (match.rule.action === 'deny' || (!acked && !fingerprintApproved)) {
        return deny(
          match.rule.action === 'deny' ? 'user_rule_denied' : 'user_rule_require_ack',
          'user_rule_triggered',
          `用户规则拦截：规则「${match.rule.id}」（${match.rule.action === 'deny' ? '动作=拒绝' : '动作=需确认'}）。` +
          `（guardKey=${match.guardKey}）`,
          {
            ruleId: match.rule.id,
            guardKey: match.guardKey,
            ...(match.rule.action === 'deny' ? {} : {
              approvalVariant: 'warning',
              explanation: `你的用户规则「${match.rule.id}」要求此调用先确认；批准仅放行本次调用（本任务范围可在卡内选择）。`,
            }),
          }
        );
      }
      if (!acked && fingerprintApproved) fingerprintConsumable = fingerprint;
    }
  }

  // BLOCK-160 W2 P1（ORC-2）— 动态维度（判定序第三层，取最严）：mutating 调用
  // 命中系统破坏命令/敏感路径 → deny+guardKey；ctx.dynamicGuardAcks 含键则放行
  //（统一确认通道：ORC-1 require-ack 规则与未来确认 UI 共用）。
  // BLOCK-180 P1 — 指纹放行层同上（「放行一次」= 该调用指纹被批准一次）。
  if (operation.mutating) {
    const guard = evaluateDynamicGuards(name, args);
    if (guard.flagged && !isGuardAcked(ctx, guard.guardKey)) {
      const fingerprint = callFingerprint(name, args);
      if (!isFingerprintApproved(ctx, fingerprint)) {
        return deny(
          'dynamic_guard',
          'dynamic_guard_triggered',
          `动态防护拦截：${guard.detail}（guardKey=${guard.guardKey}）。` +
          '该调用命中动态审批维度；如属误判请调整调用方式，放行需经用户确认通道。',
          {
            guardKey: guard.guardKey,
            dimension: guard.dimension,
            approvalVariant: 'danger',
            explanation: `动态防护：${guard.detail}。批准仅放行本次调用；如属误判请调整调用方式。`,
          }
        );
      }
      fingerprintConsumable = fingerprint;
    }
  }

  // BLOCK-243 Q1 — MCP 服务信任位（判定序第四层）：trust='ask' 时仅对声明
  // destructiveHint 的工具要求审批；trust='allow' 自动放行。trust 由拦截器在
  // 调用时从 mcp-server-policy 重读注入（投影快照不作放行依据）。与用户规则/
  // 动态防护共用同一 guardKey ack（task）与指纹放行（once）通道。
  // BLOCK-244 — 逐工具显式策略（ask/deny）是更具体的用户裁决，优先于服务级
  // trust；否则同一调用会叠两次审批。
  const explicitToolApproval = ctx.toolApprovalMode === 'deny' || ctx.toolApprovalMode === 'ask';
  if (
    !explicitToolApproval
    && operation.mutating
    && ctx.mcpApproval
    && ctx.mcpApproval.destructive === true
    && ctx.mcpApproval.serverId
  ) {
    const serverId = String(ctx.mcpApproval.serverId);
    const guardKey = `mcp:${serverId}`;
    if (ctx.mcpApproval.trust !== 'allow' && !isGuardAcked(ctx, guardKey)) {
      const fingerprint = callFingerprint(name, args);
      if (!isFingerprintApproved(ctx, fingerprint)) {
        return deny(
          'mcp_trust_required',
          'mcp_trust_required',
          `MCP 服务「${serverId}」的信任位为 ask；工具 ${name} 声明 destructiveHint（可能执行不可逆操作），需要你确认后放行。`,
          {
            guardKey,
            dimension: 'mcp-trust',
            mcpServerId: serverId,
            approvalVariant: 'info',
            explanation: `MCP 服务「${serverId}」的信任位为 ask，且工具声明 destructiveHint（可能不可逆）。批准仅放行本次调用；可在扩展页把该服务信任位改为 allow。`,
          }
        );
      }
      fingerprintConsumable = fingerprint;
    }
  }

  // BLOCK-244 Q1-REM — 通用工具审批策略（A1/A8）：逐工具 allow/ask/deny。
  // allow=默认零漂移；ask 复用现有 guardKey/指纹通道（tool:<name>）；deny 直接拦截。
  if (ctx.toolApprovalMode === 'deny') {
    return deny(
      'tool_denied_by_policy',
      'tool_denied_by_policy',
      `工具审批策略：工具「${name}」被设为拒绝。`,
      {
        approvalVariant: 'danger',
        explanation: `你的工具审批策略把「${name}」设为 deny；如误配请到设置→决策原语调整。`,
      }
    );
  }
  if (ctx.toolApprovalMode === 'ask') {
    const guardKey = `tool:${name}`;
    if (!isGuardAcked(ctx, guardKey)) {
      const fingerprint = callFingerprint(name, args);
      if (!isFingerprintApproved(ctx, fingerprint)) {
        return deny(
          'tool_approval_required',
          'tool_approval_required',
          `工具审批策略：工具「${name}」被设为每次询问，需要你确认后放行。`,
          {
            guardKey,
            dimension: 'tool-approval',
            approvalVariant: 'warning',
            explanation: `工具审批策略：工具「${name}」被设为 ask（每次调用需确认）。批准仅放行本次调用；可在设置→决策原语改为 allow。`,
          }
        );
      }
      fingerprintConsumable = fingerprint;
    }
  }

  // BLOCK-244 Q1-REM — 同参连续循环防护（A5）：mutating 工具连续 N 次相同调用
  // 触发确认；read-only/检索族不触发（轮询是合法行为）。ack/指纹语义同上。
  if (operation.mutating) {
    const loop = evaluateLoopGuard(name, args, ctx);
    if (loop.flagged && !isGuardAcked(ctx, loop.guardKey)) {
      const fingerprint = callFingerprint(name, args);
      if (!isFingerprintApproved(ctx, fingerprint)) {
        return deny(
          'loop_guard',
          'loop_guard',
          `循环防护：检测到连续 ${loop.count} 次相同调用，可能陷入循环。请确认是否继续。`,
          {
            guardKey: loop.guardKey,
            dimension: 'loop',
            approvalVariant: 'warning',
            explanation: `循环防护：最近连续 ${loop.count} 次调用参数完全相同（${name}）。继续可能重复执行；拒绝会让模型停止重试。`,
          }
        );
      }
      fingerprintConsumable = fingerprint;
    }
  }

  // The interceptor calls the pure policy once before I/O so read-only denials
  // remain deterministic, then again with workspace preflight facts.
  if (!preflight) {
    return allow(operation.delegatedApproval ? 'delegated_approval' : 'policy_allowed', {
      delegatedApproval: operation.delegatedApproval,
      ...(fingerprintConsumable ? { fingerprintConsumable } : {}),
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
    ...(fingerprintConsumable ? { fingerprintConsumable } : {}),
  });
}

function evaluateUserRules(name, args, ctx = {}) {
  // 纯函数委托：规则数组来自 ctx.userRules（拦截器注入），policy 不做 I/O。
  return require('../helpers/agent-user-rules').evaluateUserRules(name, args, ctx && ctx.userRules);
}

/** BLOCK-244 — 循环防护阈值（env 覆盖，2..10，默认 3）。 */
function loopGuardThreshold() {
  const raw = Number(process.env.PETRI_LOOP_GUARD_THRESHOLD);
  return Number.isInteger(raw) && raw >= 2 && raw <= 10 ? raw : 3;
}

/** BLOCK-244 — 从 ctx.approvalRequests.callHistory 读取尾部同指纹连续次数。 */
function evaluateLoopGuard(name, args, ctx = {}) {
  const history = ctx && ctx.approvalRequests && Array.isArray(ctx.approvalRequests.callHistory)
    ? ctx.approvalRequests.callHistory
    : null;
  if (!history || history.length === 0) return { flagged: false };
  const fingerprint = callFingerprint(name, args);
  let count = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].fingerprint === fingerprint) count += 1;
    else break;
  }
  const threshold = loopGuardThreshold();
  if (count < threshold) return { flagged: false };
  return { flagged: true, threshold, count, fingerprint, guardKey: `loop:${fingerprint}` };
}

module.exports = {
  decideAgentToolCall,
  effectiveOperation,
  evaluateUserRules,
  evaluateDynamicGuards,
  evaluateLoopGuard,
  loopGuardThreshold,
  isProtectedScientificSource,
  checkAllowedDownstream,
};
