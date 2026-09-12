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
 */

const registry = new Map();

function registerTaskConfirmationHook(hook) {
  if (!hook || typeof hook !== 'object') throw new Error('task_confirmation_hook_required');
  if (typeof hook.id !== 'string' || !hook.id.trim()) throw new Error('task_confirmation_hook_id_required');
  if (typeof hook.validateTaskExecution !== 'function') throw new Error('task_confirmation_hook_validate_required');
  const previous = registry.get(hook.id) || null;
  registry.set(hook.id, Object.freeze({ id: hook.id, validateTaskExecution: hook.validateTaskExecution }));
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

function __resetTaskConfirmationHooksForTest() {
  registry.clear();
}

module.exports = {
  registerTaskConfirmationHook,
  unregisterTaskConfirmationHook,
  listTaskConfirmationHooks,
  runTaskConfirmationHooks,
  __resetTaskConfirmationHooksForTest,
};
