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

function createAgentToolInterceptor(options = {}) {
  const resolveEntry = options.getToolEntry || getToolEntry;
  const workspacePreflight = options.preflightWorkspaceTool || preflightWorkspaceTool;
  const decide = options.decideAgentToolCall || decideAgentToolCall;

  return async function interceptAgentToolCall(name, argsObj, ctx = {}) {
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
    if (initialDecision.decision === 'deny') return policyResult(initialDecision);

    let preflight = null;
    if (entry.contract.category === 'workspace') {
      preflight = await workspacePreflight(name, args, ctx);
    }
    const decision = decide({ name, args, ctx, contract: entry.contract, preflight });
    if (decision.decision === 'deny') return policyResult(decision);

    return entry.handler(args, ctx);
  };
}

const interceptAgentToolCall = createAgentToolInterceptor();

module.exports = {
  createAgentToolInterceptor,
  interceptAgentToolCall,
  validateToolArguments,
};
