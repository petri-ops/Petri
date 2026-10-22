'use strict';

const { decideAgentToolCall } = require('./agent-tool-policy');
const { getToolEntry } = require('./registry');
const { preflightWorkspaceTool } = require('./workspace-tools');
const { bindResultStudioContextToken } = require('./result-context-binding');
// BLOCK-243 — 编辑参数批准后的原始指纹→生效参数替换（一次性，执行前再校验）。
const {
  callFingerprint,
  findInputOverride,
  consumeInputOverride,
} = require('../helpers/approval-request-store');

function matchesType(value, expected) {
  if (expected === 'object') return !!value && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'integer') {
    // Accept JSON integer numbers and their numeric-string form (e.g. "1"),
    // matching handler coercion (clampInteger). Floats/non-integers still fail.
    if (Number.isInteger(value)) return true;
    if (typeof value === 'string') {
      const t = value.trim();
      return t !== '' && /^-?\d+$/.test(t);
    }
    return false;
  }
  if (expected === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return true;
    if (typeof value === 'string') {
      const t = value.trim();
      return t !== '' && Number.isFinite(Number(t));
    }
    return false;
  }
  if (expected === 'null') return value === null;
  return typeof value === expected;
}

function validateToolArguments(value, schema, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type) => matchesType(value, type))) {
    errors.push({ path, code: 'invalid_type', expected: types.join('|') });
    return errors;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push({ path, code: 'invalid_enum', expected: schema.enum });
    return errors;
  }
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) {
        errors.push({ path: `${path}.${required}`, code: 'required' });
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties && schema.properties[key]) {
        errors.push(...validateToolArguments(child, schema.properties[key], `${path}.${key}`));
      }
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validateToolArguments(item, schema.items, `${path}[${index}]`));
    });
  }
  return errors;
}

function policyResult(result, extra = {}) {
  return {
    ok: false,
    error: result.error,
    reason: result.reason,
    message: result.message,
    messageKey: result.messageKey,
    ...extra,
  };
}

/** BLOCK-243 — 审批卡可见的决策附加字段（guardKey/dimension 既有字段不动）。 */
function approvalFields(decision) {
  if (!decision || typeof decision !== 'object') return {};
  return {
    ...(decision.guardKey ? { guardKey: decision.guardKey } : {}),
    ...(decision.dimension ? { dimension: decision.dimension } : {}),
    ...(decision.ruleId ? { ruleId: decision.ruleId } : {}),
    ...(decision.mcpServerId ? { mcpServerId: decision.mcpServerId } : {}),
    ...(decision.approvalVariant ? { approvalVariant: decision.approvalVariant } : {}),
    ...(decision.explanation ? { explanation: decision.explanation } : {}),
  };
}

/**
 * BLOCK-243 — 从 MCP 合同元数据解析**调用时**信任位（策略在调用时重读，
 * 投影快照不能成为放行依据）；策略存储不可读时 fail-closed 到 ask。
 */
function resolveMcpApprovalContext(entry) {
  const meta = entry && entry.contract && entry.contract.mcpApproval;
  if (!meta || typeof meta !== 'object' || !meta.serverId) return null;
  const base = { serverId: String(meta.serverId), destructive: meta.destructive === true };
  try {
    const { policyForServer } = require('../helpers/mcp-server-policy');
    return { ...base, trust: policyForServer(base.serverId).trust };
  } catch {
    return { ...base, trust: 'ask' };
  }
}

// BLOCK-180 P0 — 审批请求注册（deny 携 guardKey 且任务注入了资源 store 时）。
// 请求幂等（同指纹+guardKey 复用 pending 请求），信封附 requestId/spans/expiresAt
// （guardKey 既有字段不动，前端与事件向后兼容）。store 缺席=存量行为（纯键确认）。
// BLOCK-243 — 附 mcpServerId/argsPreview/计数/重复标记与执行上下文快照（供编辑重校验）。
function attachApprovalRequest(ctx, { name, args, decision }) {
  if (!decision || !decision.guardKey) return {};
  const store = ctx && ctx.approvalRequests;
  if (!store) return {};
  try {
    const ctxSnapshot = {
      accessMode: ctx.accessMode,
      planMode: ctx.planMode,
      allowExecution: ctx.allowExecution,
      projectId: ctx.projectId,
      userId: ctx.userId,
    };
    const registered = require('../helpers/approval-request-store').registerApprovalRequest(store, {
      toolName: name,
      args,
      guardKey: decision.guardKey,
      dimension: decision.dimension,
      detail: decision.message,
      mcpServerId: decision.mcpServerId || null,
      ctxSnapshot,
    });
    if (!registered.ok) return {};
    const { request } = registered;
    return {
      requestId: request.requestId,
      expiresAt: new Date(request.expiresAt).toISOString(),
      ...(request.command ? { command: request.command, spans: request.spans } : {}),
      // BLOCK-243 — 参数预览只给用户面（工具结果顶层 approval，不走模型 commonData）
      ...(request.argsPreview !== undefined
        ? { argsPreview: request.argsPreview, inputEditable: request.inputEditable === true }
        : {}),
      pendingRequestCount: registered.pendingCount,
      duplicatePending: registered.created === false,
    };
  } catch {
    // 资源层故障不阻断既有 deny 语义（fail-soft 回纯键确认）
    return {};
  }
}

/**
 * BLOCK-243 — 替换执行时只放行本次审批的 guardKey（代理 Set，不污染任务级 ack）；
 * 同时清空指纹集，确保生效参数重新走策略而不是被旧指纹放行。
 */
function withOverrideAcks(ctx, guardKey) {
  if (!guardKey) return ctx;
  const base = ctx.dynamicGuardAcks;
  const has = (key) => {
    if (key === guardKey) return true;
    if (!base) return false;
    if (typeof base.has === 'function') return base.has(key);
    return base[key] === true;
  };
  return { ...ctx, dynamicGuardAcks: { has }, approvedFingerprints: new Set() };
}

function createAgentToolInterceptor(options = {}) {
  const resolveEntry = options.getToolEntry || getToolEntry;
  const workspacePreflight = options.preflightWorkspaceTool || preflightWorkspaceTool;
  const decide = options.decideAgentToolCall || decideAgentToolCall;

  return async function interceptAgentToolCall(name, argsObj, ctx = {}, handlerOptions = {}) {
    const entry = resolveEntry(name);
    if (!entry) {
      return {
        ok: false,
        error: 'unknown_tool',
        reason: 'unknown_tool',
        message: `未知工具: ${name}`,
        messageKey: 'agent_tool.unknown_tool',
      };
    }

    // P4R-3: a result-focus Composer binds its opaque token in request
    // context. Inject before required-field validation; explicit model tokens
    // are never replaced, so stale writes still fail closed in the handler.
    const boundOriginalArgs = bindResultStudioContextToken(name, argsObj == null ? {} : argsObj, ctx);
    // BLOCK-160 W2 P2（ORC-1）— 用户规则注入（fail-soft 缓存读；零文件=零规则零行为）
    if (!ctx.userRules) {
      try {
        ctx = { ...ctx, userRules: require('../helpers/agent-user-rules').loadUserRules() };
      } catch { /* 规则层故障不阻断调用（fail-soft） */ }
    }
    // BLOCK-243 — MCP 信任位：调用时重读 server policy（投影快照不作放行依据）。
    if (!ctx.mcpApproval) {
      const mcpApproval = resolveMcpApprovalContext(entry);
      if (mcpApproval) ctx = { ...ctx, mcpApproval };
    }

    // BLOCK-243 — 编辑参数批准：模型重试原调用时替换为生效参数；原始指纹用于
    // 审计与替换消费，策略按生效参数重新判定（只代理本次 guardKey）。
    const originalFingerprint = callFingerprint(name, boundOriginalArgs);
    const override = findInputOverride(ctx, originalFingerprint);
    const args = override
      ? bindResultStudioContextToken(name, override.args, ctx)
      : boundOriginalArgs;
    const decisionCtx = override ? withOverrideAcks(ctx, override.guardKey) : ctx;

    const argumentErrors = validateToolArguments(args, entry.definition.function.parameters);
    if (argumentErrors.length) {
      return {
        ok: false,
        error: 'invalid_arguments',
        reason: 'invalid_arguments',
        message: '工具参数不符合声明的 schema。',
        messageKey: 'agent_tool.invalid_arguments',
        details: argumentErrors,
      };
    }

    const initialDecision = decide({ name, args, ctx: decisionCtx, contract: entry.contract });
    if (initialDecision.decision === 'deny') {
      // BLOCK-171 CP-2 — 确认通道键随拒绝对外透出（存量缺陷修复：policyResult
      // 曾丢弃 extra，guardKey 从未到达 envelope，确认 UI 无从确认）。
      // BLOCK-180 P0 — 审批请求资源随拒绝注册并透出（requestId/spans/expiresAt）。
      return policyResult(initialDecision, {
        ...approvalFields(initialDecision),
        ...attachApprovalRequest(ctx, { name, args, decision: initialDecision }),
      });
    }

    let preflight = null;
    if (entry.contract.category === 'workspace') {
      preflight = await workspacePreflight(name, args, decisionCtx);
    }
    const decision = decide({ name, args, ctx: decisionCtx, contract: entry.contract, preflight });
    if (decision.decision === 'deny') {
      return policyResult(decision, {
        ...approvalFields(decision),
        ...attachApprovalRequest(ctx, { name, args, decision }),
      });
    }

    // BLOCK-180 P1 — 「放行一次」指纹消耗：policy 经指纹层放行时在执行前消耗，
    // 同指纹再次调用需重新审批（一次放行=一次执行尝试，handler 失败需重批）。
    if (decision.fingerprintConsumable) {
      try {
        require('../helpers/approval-request-store').consumeFingerprint(ctx, decision.fingerprintConsumable);
      } catch { /* 消耗失败不阻断执行 */ }
    }
    if (override) {
      // 生效参数已通过 schema/preflight/policy；一次性替换在执行前消费。
      consumeInputOverride(ctx, originalFingerprint);
      if (typeof handlerOptions.onInputOverride === 'function') {
        handlerOptions.onInputOverride({
          requestId: override.requestId,
          edited: true,
          guardKey: override.guardKey,
          originalFingerprint,
          effectiveFingerprint: callFingerprint(name, args),
        });
      }
    }

    // BLOCK-33 P3 — handlerOptions（可选 { onOutput }）透传给 handler；
    // 现有 handler 均为 (args, ctx) 签名，多余的实参会被安全忽略。
    return entry.handler(args, ctx, handlerOptions);
  };
}

const interceptAgentToolCall = createAgentToolInterceptor();

module.exports = {
  createAgentToolInterceptor,
  interceptAgentToolCall,
  resolveMcpApprovalContext,
  validateToolArguments,
};
