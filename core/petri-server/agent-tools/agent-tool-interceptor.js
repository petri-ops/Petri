'use strict';

const { decideAgentToolCall } = require('./agent-tool-policy');
const { getToolEntry } = require('./registry');
const { preflightWorkspaceTool } = require('./workspace-tools');
const { bindResultStudioContextToken } = require('./result-context-binding');

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

// BLOCK-180 P0 — 审批请求注册（deny 携 guardKey 且任务注入了资源 store 时）。
// 请求幂等（同指纹+guardKey 复用 pending 请求），信封附 requestId/spans/expiresAt
// （guardKey 既有字段不动，前端与事件向后兼容）。store 缺席=存量行为（纯键确认）。
function attachApprovalRequest(ctx, { name, args, decision }) {
  if (!decision || !decision.guardKey) return {};
  const store = ctx && ctx.approvalRequests;
  if (!store) return {};
  try {
    const registered = require('../helpers/approval-request-store').registerApprovalRequest(store, {
      toolName: name,
      args,
      guardKey: decision.guardKey,
      dimension: decision.dimension,
      detail: decision.message,
    });
    if (!registered.ok) return {};
    const { request } = registered;
    return {
      requestId: request.requestId,
      expiresAt: new Date(request.expiresAt).toISOString(),
      ...(request.command ? { command: request.command, spans: request.spans } : {}),
    };
  } catch {
    // 资源层故障不阻断既有 deny 语义（fail-soft 回纯键确认）
    return {};
  }
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
    const args = bindResultStudioContextToken(name, argsObj == null ? {} : argsObj, ctx);
    // BLOCK-160 W2 P2（ORC-1）— 用户规则注入（fail-soft 缓存读；零文件=零规则零行为）
    if (!ctx.userRules) {
      try {
        ctx = { ...ctx, userRules: require('../helpers/agent-user-rules').loadUserRules() };
      } catch { /* 规则层故障不阻断调用（fail-soft） */ }
    }
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

    const initialDecision = decide({ name, args, ctx, contract: entry.contract });
    if (initialDecision.decision === 'deny') {
      // BLOCK-171 CP-2 — 确认通道键随拒绝对外透出（存量缺陷修复：policyResult
      // 曾丢弃 extra，guardKey 从未到达 envelope，确认 UI 无从确认）。
      // BLOCK-180 P0 — 审批请求资源随拒绝注册并透出（requestId/spans/expiresAt）。
      return policyResult(initialDecision, {
        guardKey: initialDecision.guardKey,
        dimension: initialDecision.dimension,
        ruleId: initialDecision.ruleId,
        ...attachApprovalRequest(ctx, { name, args, decision: initialDecision }),
      });
    }

    let preflight = null;
    if (entry.contract.category === 'workspace') {
      preflight = await workspacePreflight(name, args, ctx);
    }
    const decision = decide({ name, args, ctx, contract: entry.contract, preflight });
    if (decision.decision === 'deny') {
      return policyResult(decision, {
        guardKey: decision.guardKey,
        dimension: decision.dimension,
        ruleId: decision.ruleId,
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

    // BLOCK-33 P3 — handlerOptions（可选 { onOutput }）透传给 handler；
    // 现有 handler 均为 (args, ctx) 签名，多余的实参会被安全忽略。
    return entry.handler(args, ctx, handlerOptions);
  };
}

const interceptAgentToolCall = createAgentToolInterceptor();

module.exports = {
  createAgentToolInterceptor,
  interceptAgentToolCall,
  validateToolArguments,
};
