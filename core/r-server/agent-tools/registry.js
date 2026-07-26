'use strict';

/**
 * Agent tool registry — the runtime source of truth for model-visible schemas,
 * handlers, and internal execution contracts.
 *
 * Provider adapters must consume getProviderToolDefs(), which deliberately
 * projects definitions without exposing internal contract metadata.
 */

const { TOOL_DEFS } = require('./tool-defs');
const { tool_query, tool_read_page, tool_search } = require('./query-tools');
const { tool_act } = require('./act-tools');
const { tool_plan } = require('./plan-ui-tools');
const {
  tool_run_tool,
  tool_generate_methods,
} = require('./learning');
const { tool_verify_state } = require('./verify-dispatch');
const { tool_read_image } = require('./vision-tools');
const {
  tool_result_edit_plan,
  tool_result_changeset_create,
  tool_result_changeset_status,
  tool_result_changeset_compare,
  tool_result_changeset_adopt,
  tool_result_changeset_revert,
  tool_artifact_revision_list,
  tool_artifact_revision_restore,
} = require('./result-edit-tools');
const { tool_result_selection_run } = require('./result-selection-tools');
const { tool_result_studio_context } = require('./result-context-tools');
const {
  tool_result_edit_plan_in_context,
  tool_result_changeset_create_in_context,
  tool_result_changeset_status_in_context,
  tool_result_changeset_compare_in_context,
  tool_result_changeset_adopt_in_context,
  tool_result_changeset_revert_in_context,
} = require('./result-context-edit-tools');
const {
  tool_workspace_list,
  tool_workspace_find,
  tool_workspace_search,
  tool_workspace_read,
  tool_workspace_write,
  tool_workspace_replace,
  tool_workspace_exec,
} = require('./workspace-tools');

const CONTRACT_VERSION = '1.0.0';
const RISK_TIERS = Object.freeze(['R0', 'R1', 'R2', 'R3']);
const RISK_TIER_SET = new Set(RISK_TIERS);
const CATEGORIES = new Set([
  'workspace',
  'retrieval',
  'action',
  'planning',
  'analysis',
  'vision',
  'reporting',
  'verification',
  'result-studio',
]);
const SIDE_EFFECTS = new Set([
  'none',
  'state-write',
  'workspace-write',
  'execution',
  'external-request',
]);

const HANDLERS = {
  workspace_list: tool_workspace_list,
  workspace_find: tool_workspace_find,
  workspace_search: tool_workspace_search,
  workspace_read: tool_workspace_read,
  workspace_write: tool_workspace_write,
  workspace_replace: tool_workspace_replace,
  workspace_exec: tool_workspace_exec,
  query: tool_query,
  read_page: tool_read_page,
  search: tool_search,
  act: tool_act,
  plan: tool_plan,
  run_tool: tool_run_tool,
  read_image: tool_read_image,
  generate_methods: tool_generate_methods,
  verify_state: tool_verify_state,
  result_edit_plan: tool_result_edit_plan,
  result_changeset_create: tool_result_changeset_create,
  result_changeset_status: tool_result_changeset_status,
  result_changeset_compare: tool_result_changeset_compare,
  result_changeset_adopt: tool_result_changeset_adopt,
  result_changeset_revert: tool_result_changeset_revert,
  artifact_revision_list: tool_artifact_revision_list,
  artifact_revision_restore: tool_artifact_revision_restore,
  result_selection_run: tool_result_selection_run,
  // G0-RS-P3: context-bound tools. The model never hand-writes internal ids;
  // every coordinate is re-projected from backend truth on each call.
  result_studio_context: tool_result_studio_context,
  result_edit_plan_in_context: tool_result_edit_plan_in_context,
  result_changeset_create_in_context: tool_result_changeset_create_in_context,
  result_changeset_status_in_context: tool_result_changeset_status_in_context,
  result_changeset_compare_in_context: tool_result_changeset_compare_in_context,
  result_changeset_adopt_in_context: tool_result_changeset_adopt_in_context,
  result_changeset_revert_in_context: tool_result_changeset_revert_in_context,
};

function contract(category, sideEffect, riskTier, resources, estimatedDurationMs) {
  return {
    contractVersion: CONTRACT_VERSION,
    category,
    sideEffect,
    riskTier,
    resources,
    estimatedDurationMs,
    // Tool handlers do not yet receive a common AbortSignal. P7-B records the
    // current capability truth rather than claiming cancellation support.
    cancellable: false,
  };
}

const CONTRACTS = {
  workspace_list: contract('workspace', 'none', 'R0', ['project.files'], 100),
  workspace_find: contract('workspace', 'none', 'R0', ['project.files'], 500),
  workspace_search: contract('workspace', 'none', 'R0', ['project.files'], 1000),
  workspace_read: contract('workspace', 'none', 'R0', ['project.files'], 100),
  workspace_write: contract('workspace', 'workspace-write', 'R2', ['project.files'], 200),
  workspace_replace: contract('workspace', 'workspace-write', 'R2', ['project.files'], 200),
  workspace_exec: contract('workspace', 'execution', 'R2', ['project.files', 'local.process'], 30000),
  query: contract('retrieval', 'none', 'R0', ['project.database'], 250),
  read_page: contract('retrieval', 'external-request', 'R1', ['plugin.content', 'network.remote'], 15000),
  search: contract('retrieval', 'external-request', 'R1', ['project.database', 'plugin.content', 'llm.provider'], 30000),
  act: contract('action', 'execution', 'R2', ['user.account', 'project.database', 'ui.session', 'local.process'], 30000),
  plan: contract('planning', 'state-write', 'R1', ['project.database'], 500),
  run_tool: contract('analysis', 'execution', 'R2', ['tool_jobs', 'artifacts', 'local.process'], 300000),
  read_image: contract('vision', 'external-request', 'R1', ['artifacts', 'llm.provider'], 30000),
  generate_methods: contract('reporting', 'external-request', 'R1', ['project.database', 'llm.provider'], 30000),
  verify_state: contract('verification', 'none', 'R0', ['project.database', 'ui.session'], 500),
  result_edit_plan: contract('result-studio', 'none', 'R0', ['tool_jobs', 'artifacts', 'project.database'], 500),
  result_changeset_create: contract('result-studio', 'execution', 'R2', ['tool_jobs', 'artifacts', 'project.database', 'project.files', 'local.process'], 300000),
  result_changeset_status: contract('result-studio', 'none', 'R0', ['tool_jobs', 'artifacts', 'project.database'], 500),
  result_changeset_compare: contract('result-studio', 'none', 'R0', ['artifacts', 'project.database', 'project.files'], 1500),
  result_changeset_adopt: contract('result-studio', 'state-write', 'R2', ['artifacts', 'project.database', 'project.files'], 1000),
  result_changeset_revert: contract('result-studio', 'state-write', 'R2', ['artifacts', 'project.database', 'project.files'], 1000),
  artifact_revision_list: contract('result-studio', 'none', 'R0', ['artifacts', 'project.database'], 500),
  artifact_revision_restore: contract('result-studio', 'state-write', 'R2', ['artifacts', 'project.database', 'project.files'], 1500),
  result_selection_run: contract('result-studio', 'execution', 'R2', ['tool_jobs', 'artifacts', 'project.database', 'project.files', 'local.process'], 300000),
  result_studio_context: contract('result-studio', 'none', 'R0', ['tool_jobs', 'artifacts', 'project.database'], 500),
  result_edit_plan_in_context: contract('result-studio', 'none', 'R0', ['tool_jobs', 'artifacts', 'project.database'], 700),
  result_changeset_create_in_context: contract('result-studio', 'execution', 'R2', ['tool_jobs', 'artifacts', 'project.database', 'project.files', 'local.process'], 300000),
  result_changeset_status_in_context: contract('result-studio', 'none', 'R0', ['tool_jobs', 'artifacts', 'project.database'], 700),
  result_changeset_compare_in_context: contract('result-studio', 'none', 'R0', ['artifacts', 'project.database', 'project.files'], 1700),
  result_changeset_adopt_in_context: contract('result-studio', 'state-write', 'R2', ['artifacts', 'project.database', 'project.files'], 1200),
  result_changeset_revert_in_context: contract('result-studio', 'state-write', 'R2', ['artifacts', 'project.database', 'project.files'], 1200),
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function getDefinitionName(definition) {
  return definition && definition.function && definition.function.name;
}

function projectProviderDefinition(definition) {
  return {
    type: 'function',
    function: {
      name: definition.function.name,
      description: definition.function.description || '',
      parameters: cloneJson(definition.function.parameters),
    },
  };
}

function validateContract(name, metadata, errors) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    errors.push(`${name}: missing contract metadata`);
    return;
  }
  if (typeof metadata.contractVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(metadata.contractVersion)) {
    errors.push(`${name}: invalid contractVersion`);
  }
  if (!CATEGORIES.has(metadata.category)) errors.push(`${name}: invalid category`);
  if (!SIDE_EFFECTS.has(metadata.sideEffect)) errors.push(`${name}: invalid sideEffect`);
  if (!RISK_TIER_SET.has(metadata.riskTier)) errors.push(`${name}: invalid riskTier`);
  if (
    !Array.isArray(metadata.resources) ||
    metadata.resources.some((resource) => typeof resource !== 'string' || resource.length === 0)
  ) {
    errors.push(`${name}: invalid resources`);
  }
  if (!Number.isInteger(metadata.estimatedDurationMs) || metadata.estimatedDurationMs < 0) {
    errors.push(`${name}: invalid estimatedDurationMs`);
  }
  if (typeof metadata.cancellable !== 'boolean') errors.push(`${name}: invalid cancellable`);
}

function buildToolRegistry(definitions, handlers = {}, contracts = {}) {
  const errors = [];
  const seen = new Set();
  const definitionNames = new Set();

  if (!Array.isArray(definitions)) {
    throw new Error('Invalid agent tool registry:\n- definitions must be an array');
  }
  if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers)) {
    throw new Error('Invalid agent tool registry:\n- handlers must be an object');
  }
  if (!contracts || typeof contracts !== 'object' || Array.isArray(contracts)) {
    throw new Error('Invalid agent tool registry:\n- contracts must be an object');
  }

  for (const definition of definitions) {
    const name = getDefinitionName(definition);
    if (
      !definition ||
      definition.type !== 'function' ||
      !definition.function ||
      typeof name !== 'string' ||
      name.length === 0 ||
      !definition.function.parameters ||
      typeof definition.function.parameters !== 'object'
    ) {
      errors.push('definition: invalid OpenAI-compatible function schema');
      continue;
    }
    if (seen.has(name)) errors.push(`${name}: duplicate definition`);
    seen.add(name);
    definitionNames.add(name);
    if (typeof handlers[name] !== 'function') errors.push(`${name}: definition has no handler`);
    validateContract(name, contracts[name], errors);
  }

  for (const name of Object.keys(handlers || {})) {
    if (!definitionNames.has(name)) errors.push(`${name}: handler has no definition`);
  }
  for (const name of Object.keys(contracts || {})) {
    if (!definitionNames.has(name)) errors.push(`${name}: contract has no definition`);
  }

  if (errors.length) {
    throw new Error(`Invalid agent tool registry:\n- ${errors.join('\n- ')}`);
  }

  return Object.freeze(
    definitions.map((definition) => {
      const name = getDefinitionName(definition);
      const metadata = Object.freeze({
        ...contracts[name],
        resources: Object.freeze([...contracts[name].resources]),
      });
      return Object.freeze({
        definition: deepFreeze(cloneJson(definition)),
        handler: handlers[name],
        contract: metadata,
      });
    })
  );
}

// Module-load construction is the startup consistency check. A mismatch in a
// model definition, handler, or contract fails before an agent request starts.
const TOOL_REGISTRY = buildToolRegistry(TOOL_DEFS, HANDLERS, CONTRACTS);
const TOOL_BY_NAME = new Map(
  TOOL_REGISTRY.map((entry) => [entry.definition.function.name, entry])
);

function getProviderToolDefs() {
  return TOOL_REGISTRY.map((entry) => projectProviderDefinition(entry.definition));
}

function getToolEntry(name) {
  return TOOL_BY_NAME.get(name);
}

function getToolHandler(name) {
  const entry = getToolEntry(name);
  return entry && entry.handler;
}

function getToolContract(name) {
  const entry = TOOL_BY_NAME.get(name);
  return entry && entry.contract;
}

function getToolRegistry() {
  return TOOL_REGISTRY;
}

module.exports = {
  CONTRACT_VERSION,
  RISK_TIERS,
  buildToolRegistry,
  getProviderToolDefs,
  getToolEntry,
  getToolHandler,
  getToolContract,
  getToolRegistry,
};
