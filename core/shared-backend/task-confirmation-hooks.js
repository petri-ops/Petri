'use strict';

/**
 * Task confirmation hook registry (BLOCK-83 D3).
 *
 * Domain-neutral seam: the agent loop / tool-job layer must not hard-reference
 * any specific task-confirmation contract (e.g. scientific tasks). Domain packs
 * register hooks here; with zero hooks registered every gate is a pass-through
 * (the "no domain pack installed" behaviour).
 *
 * Contract: hook = { id: string, validateTaskExecution(payload) -> {ok:true} | {ok:false, error} }.
 * First veto wins; later hooks are not consulted for the same payload.
 *
 * A hook may additionally declare `userInputErrorCodes: string[]` — error codes that
 * mean "the run is blocked until the user supplies something". The core asks this
 * registry instead of hard-coding domain error names (BLOCK-83 D12).
 */

/** 领域中性基础码：任意插件的必填输入缺失（非领域专属，核心保留）。 */
const BASE_USER_INPUT_ERROR_CODES = Object.freeze(['missing_required_file_inputs']);

const registry = new Map();

function registerTaskConfirmationHook(hook) {
  if (!hook || typeof hook !== 'object') throw new Error('task_confirmation_hook_required');
  if (typeof hook.id !== 'string' || !hook.id.trim()) throw new Error('task_confirmation_hook_id_required');
  if (typeof hook.validateTaskExecution !== 'function') throw new Error('task_confirmation_hook_validate_required');
  const previous = registry.get(hook.id) || null;
  const userInputErrorCodes = Array.isArray(hook.userInputErrorCodes)
    ? Object.freeze(hook.userInputErrorCodes.filter((code) => typeof code === 'string' && code))
    : Object.freeze([]);
  registry.set(hook.id, Object.freeze({
    id: hook.id,
    validateTaskExecution: hook.validateTaskExecution,
    userInputErrorCodes,
  }));
  return previous;
}

function unregisterTaskConfirmationHook(id) {
  return registry.delete(id);
}

function listTaskConfirmationHooks() {
  return [...registry.keys()];
}

function runTaskConfirmationHooks(payload = {}) {
  for (const hook of registry.values()) {
    let gate;
    try {
      gate = hook.validateTaskExecution(payload);
    } catch (error) {
      return { ok: false, error: (error && error.message) || 'task_confirmation_hook_threw', hookId: hook.id };
    }
    if (!gate || gate.ok !== true) {
      return { ok: false, error: (gate && gate.error) || 'task_confirmation_hook_failed', hookId: hook.id };
    }
  }
  return { ok: true };
}

/**
 * 该错误码是否表示「阻塞等待用户输入」——基础码 + 各领域 hook 声明的码。
 * 核心用它替代硬编码的领域错误名清单（BLOCK-83 D12）。
 */
function isUserInputRequiredError(errorCode) {
  if (!errorCode || typeof errorCode !== 'string') return false;
  if (BASE_USER_INPUT_ERROR_CODES.includes(errorCode)) return true;
  for (const hook of registry.values()) {
    if (hook.userInputErrorCodes.includes(errorCode)) return true;
  }
  return false;
}

/** 当前「需用户输入」错误码全集（诊断与测试可见）。 */
function listUserInputErrorCodes() {
  const codes = new Set(BASE_USER_INPUT_ERROR_CODES);
  for (const hook of registry.values()) {
    for (const code of hook.userInputErrorCodes) codes.add(code);
  }
  return [...codes];
}

function __resetTaskConfirmationHooksForTest() {
  registry.clear();
}

module.exports = {
  registerTaskConfirmationHook,
  unregisterTaskConfirmationHook,
  listTaskConfirmationHooks,
  runTaskConfirmationHooks,
  isUserInputRequiredError,
  listUserInputErrorCodes,
  BASE_USER_INPUT_ERROR_CODES,
  __resetTaskConfirmationHooksForTest,
};
