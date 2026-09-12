'use strict';

/**
 * Loop Repair Strategy v1 — lineage-safe repair planning from diagnosed failures.
 *
 * Pure functions: no I/O, no DB, no network.
 *
 * HLE-4 scope:
 *  - selectRepairStrategy() — pick best repair strategy from diagnosis + context
 *  - buildRepairAttempt() — produce a repair plan with parent lineage preserved
 *  - 12 repair strategies with applicability rules, cost estimates, and safety levels
 *
 * NOT in scope:
 *  - Actually executing repair actions (live in integration layer)
 *  - User authorization for unsafe strategies (handled by integration layer)
 *  - Scientific design questions (delegated to user via wait_for_user)
 *
 * Key invariants:
 *  - Original script/params/artifact are NEVER mutated
 *  - Every repair creates a new Job version with parent reference
 *  - Invalidation boundaries mark what changed
 *  - Unsafe strategies require explicit user authorization
 *  - Scientific design changes never bypass user confirmation
 *
 * Integration contract:
 *  - Integration layer calls diagnoseFailure() first
 *  - Then calls selectRepairStrategy() with diagnosis + context
 *  - Then calls buildRepairAttempt() to produce repair plan
 *  - Repair plan is stored as LoopEvidence (kind: 'repair_attempt')
 *  - Integration layer decides whether to auto-proceed or wait for user
 */

const { REASON_CODES } = require('./loop-contract');

// ---------------------------------------------------------------------------
// HLE-C5R: Strict Repair Boundary
// Defines what automatic repair CAN and CANNOT do.
// These rules are enforced BEFORE any isActionable check.
// ---------------------------------------------------------------------------

/**
 * Explicit ALLOWED automatic repair actions (safe parameter/infrastructure fixes).
 * Anything not on this list requires explicit user authorization or is blocked.
 */
const REPAIR_BOUNDARY_ALLOW = new Set([
  // Safe automatic repairs (deterministic, non-destructive)
  'metadata_to_coldata_mapping',     // metadata.csv → coldata parameter alias
  'column_name_mapping',             // known alias mapping (log2FC → log2FoldChange)
  'path_resolution',                  // relative → absolute path within project
  'runtime_readiness',               // R/Python/package missing → provisioning
  'retry_same_params',               // transient failure, same params
  'retry_with_reconcile',            // transient + state reconciliation
  'provider_backoff_retry',         // rate limit, exponential backoff
  'fix_schema_violation',            // missing optional field with known default
  'fix_enum_or_range',               // enum/range fix from known valid values
  'transform_input_format',           //无损格式转换（TSV↔CSV、编码）
  'ensure_capability',               // bundle/capability provisioning
  'rerun_upstream',                  // upstream failed, rerun first verified node
  'reduce_resource_request',         // OOM/disk-full: lower resource request (safe)
  'chunk_workflow',                  // split large workflow into smaller chunks
]);

/**
 * EXPLICITLY BLOCKED automatic repair actions.
 * These require explicit user authorization or must block.
 * No strategy may set isActionable=true for these fault types.
 */
const REPAIR_BOUNDARY_BLOCK = new Set([
  // Data fabrication — NEVER auto-generate data
  'fabricate_gene_data',             // adding genes to make results significant
  'fabricate_sample_data',            // creating fake samples
  'pad_data_to_reach_threshold',      // padding data to reach minimum counts

  // Scientific design changes
  'change_contrast',                 // modifying comparison groups
  'change_design_formula',           // changing statistical model
  'change_statistical_method',       // DESeq2 → limma without user consent
  'downgrade_significance_threshold', // lowering padj cutoff to get sig results
  'change_p_value_adjustment',       // BH → Bonferroni without user consent

  // Data manipulation
  'delete_outlier_samples',          // removing "bad" samples to improve results
  'impute_missing_values',           // filling in data without user consent
  'filter_genes_to_subset',         // narrowing gene set to make results look better

  // Plugin source modification
  'modify_plugin_source',            // changing plugin R/Python scripts
  'inject_workspace_external',        // writing outside project directory
  'suppress_validation_error',       // hiding validator failures

  // Irreversible operations
  'delete_artifacts',                // deleting existing results
  'overwrite_input_hash',           // modifying source data hash
  'replay_with_modified_params',    // rerunning with undeclared parameter changes
]);

/**
 * Check if a strategyId or faultType is allowed for automatic repair.
 * @returns {{ allowed: boolean, reason?: string }}
 */
function repairBoundaryCheck(strategyId, faultType, actionDescription) {
  // HLE-C5R: 需用户输入时禁止数据/方法被自动修改（BLOCK-83 D12 中性化 faultType）
  if (faultType === 'user_input_required') {
    const prohibited = [
      'replan_subgraph',       // changes contrast/method
      'substitute_data',       // generates/replaces data
      'padj_threshold_relax',  // lowers thresholds
      'lfc_threshold_relax',   // adjusts fold change
      'delete_outliers',       // removes samples
      'add_samples',           // adds synthetic data
      'augment_samples',       // modifies sample counts
      'method_substitution',    // swaps statistical method
    ];
    if (prohibited.includes(strategyId)) {
      return {
        allowed: false,
        reason: `Scientific design/contrast decision requires user. Strategy '${strategyId}' would modify scientific method or data.`,
        blockedStrategy: strategyId,
      };
    }
  }

  // Block explicitly forbidden strategies or fault types
  if (REPAIR_BOUNDARY_BLOCK.has(strategyId) || REPAIR_BOUNDARY_BLOCK.has(faultType)) {
    return {
      allowed: false,
      reason: `Repair boundary block: strategy '${strategyId}' or fault '${faultType}' is explicitly forbidden for automatic repair. Requires user authorization.`,
    };
  }
  // Strategy must be in allow list
  if (!REPAIR_BOUNDARY_ALLOW.has(strategyId)) {
    return {
      allowed: false,
      reason: `Repair boundary: strategy '${strategyId}' is not on the automatic repair allowlist. Requires user authorization.`,
    };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Strategy definitions
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} RepairStrategy
 * @property {string} strategyId
 * @property {string} version
 * @property {string[]} faultTypes          - fault types this strategy handles
 * @property {string} name
 * @property {string} description
 * @property {Function} applicability       - (diagnosis, context) => { applicable: bool, reason?: string }
 * @property {Function} attempt             - (diagnosis, context) => RepairAttempt
 * @property {string} safetyLevel           - 'safe' | 'risky' | 'unsafe'
 * @property {number} costMultiplier        - relative cost vs original job (1.0 = same, 2.0 = 2x, etc.)
 */

/**
 * @typedef {Object} RepairAttempt
 * @property {string} strategyId
 * @property {string} strategyVersion
 * @property {string|null} newToolId
 * @property {Object|null} newInputs
 * @property {Object|null} newParams
 * @property {Object} parentLineage        - { parentJobId, parentArtifactIds, parentPlanHash }
 * @property {Array<string>} invalidatedArtifactIds
 * @property {Array<string>} preservedArtifactIds
 * @property {boolean} isActionable         - can auto-proceed?
 * @property {boolean} requiresUserAuth     - needs explicit user authorization
 * @property {string} publicMessage         - user-facing explanation
 * @property {number} costMultiplier
 * @property {string} safetyLevel
 */

const REPAIR_STRATEGIES = Object.freeze([
  // ---------------------------------------------------------------------------
  // S-01: retry_with_reconcile
  // ---------------------------------------------------------------------------
  {
    strategyId: 'retry_with_reconcile',
    version: '1.0.0',
    faultTypes: ['transient_runtime', 'transient_provider'],
    name: 'Retry after state reconciliation',
    description: 'Re-run the same tool after reconciling job/artifact state.',
    safetyLevel: 'safe',
    costMultiplier: 1.0,

    applicability(diagnosis, context) {
      if (!['transient_runtime', 'transient_provider'].includes(diagnosis.faultType)) {
        return { applicable: false, reason: 'not a transient fault type' };
      }
      if (!context.parentJobId) {
        return { applicable: false, reason: 'no parent job to reconcile' };
      }
      return { applicable: true };
    },

    attempt(diagnosis, context) {
      return buildRepairAttempt({
        strategyId: 'retry_with_reconcile',
        strategyVersion: '1.0.0',
        newToolId: context.originalToolId || null,
        newInputs: context.originalInputs || null,
        newParams: context.originalParams || null,
        parentLineage: {
          parentJobId: context.parentJobId,
          parentArtifactIds: context.parentArtifactIds || [],
          parentPlanHash: context.parentPlanHash || null,
          repairReason: diagnosis.faultType,
        },
        invalidatedArtifactIds: [],
        preservedArtifactIds: context.parentArtifactIds || [],
        isActionable: true,
        requiresUserAuth: false,
        publicMessage: `重新执行同一工具（故障类型：${diagnosis.faultType}）。`,
        costMultiplier: 1.0,
        safetyLevel: 'safe',
      });
    },
  },

  // ---------------------------------------------------------------------------
  // S-02: retry_same_params
  // ---------------------------------------------------------------------------
  {
    strategyId: 'retry_same_params',
    version: '1.0.0',
    faultTypes: ['transient_runtime'],
    name: 'Simple retry with same parameters',
    description: 'Re-run with identical parameters — no changes, just wait and retry.',
    safetyLevel: 'safe',
    costMultiplier: 1.0,

    applicability(diagnosis, context) {
      if (diagnosis.faultType !== 'transient_runtime') {
        return { applicable: false, reason: 'not transient_runtime' };
      }
      return { applicable: true };
    },

    attempt(diagnosis, context) {
      return buildRepairAttempt({
        strategyId: 'retry_same_params',
        strategyVersion: '1.0.0',
        newToolId: context.originalToolId || null,
        newInputs: context.originalInputs || null,
        newParams: context.originalParams || null,
        parentLineage: {
          parentJobId: context.parentJobId,
          parentArtifactIds: context.parentArtifactIds || [],
          parentPlanHash: context.parentPlanHash || null,
          repairReason: 'simple_retry',
        },
        invalidatedArtifactIds: [],
        preservedArtifactIds: context.parentArtifactIds || [],
        isActionable: true,
        requiresUserAuth: false,
        publicMessage: '简单重试（参数不变）。',
        costMultiplier: 1.0,
        safetyLevel: 'safe',
      });
    },
  },

  // ---------------------------------------------------------------------------
  // S-03: provider_backoff_retry
  // ---------------------------------------------------------------------------
  {
    strategyId: 'provider_backoff_retry',
    version: '1.0.0',
    faultTypes: ['transient_provider'],
    name: 'Provider backoff retry',
    description: 'Wait and retry with exponential backoff, only using configured fallback.',
    safetyLevel: 'safe',
    costMultiplier: 1.1,

    applicability(diagnosis, context) {
      if (diagnosis.faultType !== 'transient_provider') {
        return { applicable: false, reason: 'not transient_provider' };
      }
      return { applicable: true };
    },

    attempt(diagnosis, context) {
      return buildRepairAttempt({
        strategyId: 'provider_backoff_retry',
        strategyVersion: '1.0.0',
        newToolId: context.originalToolId || null,
        newInputs: context.originalInputs || null,
        newParams: {
          ...(context.originalParams || {}),
          _repair: 'backoff_retry',
          _retryCount: (context.originalParams?._retryCount || 0) + 1,
        },
        parentLineage: {
          parentJobId: context.parentJobId,
          parentArtifactIds: context.parentArtifactIds || [],
          parentPlanHash: context.parentPlanHash || null,
          repairReason: 'provider_backoff',
        },
        invalidatedArtifactIds: [],
        preservedArtifactIds: context.parentArtifactIds || [],
        isActionable: true,
        requiresUserAuth: false,
        publicMessage: '等待后重试（Provider 限流退避）。',
        costMultiplier: 1.1,
        safetyLevel: 'safe',
      });
    },
  },

  // ---------------------------------------------------------------------------
  // S-04: fallback_provider
  // ---------------------------------------------------------------------------
  {
    strategyId: 'fallback_provider',
    version: '1.0.0',
    faultTypes: ['transient_provider'],
    name: 'Switch to fallback provider',
    description: 'Use the configured fallback provider when primary is unavailable.',
    safetyLevel: 'risky',
    costMultiplier: 1.2,

    applicability(diagnosis, context) {
      if (diagnosis.faultType !== 'transient_provider') {
        return { applicable: false, reason: 'not transient_provider' };
      }
      if (!context.fallbackProvider) {
        return { applicable: false, reason: 'no fallback provider configured' };
      }
      return { applicable: true };
    },

    attempt(diagnosis, context) {
      return buildRepairAttempt({
        strategyId: 'fallback_provider',
        strategyVersion: '1.0.0',
        newToolId: context.originalToolId || null,
        newInputs: context.originalInputs || null,
        newParams: {
          ...(context.originalParams || {}),
          _repair: 'fallback_provider',
          _provider: context.fallbackProvider,
        },
        parentLineage: {
          parentJobId: context.parentJobId,
          parentArtifactIds: context.parentArtifactIds || [],
          parentPlanHash: context.parentPlanHash || null,
          repairReason: 'provider_fallback',
        },
        invalidatedArtifactIds: [],
        preservedArtifactIds: context.parentArtifactIds || [],
        isActionable: false,
        requiresUserAuth: true,
        publicMessage: `切换到备用 Provider（${context.fallbackProvider}），结果可能略有差异。`,
        costMultiplier: 1.2,
        safetyLevel: 'risky',
      });
    },
  },

  // ---------------------------------------------------------------------------
  // S-05: fix_schema_violation
  // ---------------------------------------------------------------------------
  {
    strategyId: 'fix_schema_violation',
    version: '1.0.0',
    faultTypes: ['invalid_arguments'],
    name: 'Fix schema violations',
    description: 'Correct argument values based on tool schema definition.',
    safetyLevel: 'safe',
    costMultiplier: 1.0,

    applicability(diagnosis, context) {
      if (diagnosis.faultType !== 'invalid_arguments') {
        return { applicable: false, reason: 'not invalid_arguments' };
      }
      if (!context.toolDefinition || !context.toolDefinition.parameters) {
        return { applicable: false, reason: 'no tool definition available for schema fix' };
      }
      return { applicable: true };
    },

    attempt(diagnosis, context) {
      const schema = context.toolDefinition.parameters;
      const newParams = fixParamsFromSchema(context.originalParams || {}, schema, diagnosis);
      return buildRepairAttempt({
        strategyId: 'fix_schema_violation',
        strategyVersion: '1.0.0',
        newToolId: null,
        newInputs: null,
        newParams,
        parentLineage: {
          parentJobId: context.parentJobId,
          parentArtifactIds: context.parentArtifactIds || [],
          parentPlanHash: context.parentPlanHash || null,
          repairReason: 'schema_violation_fix',
        },
        invalidatedArtifactIds: [],
        preservedArtifactIds: context.parentArtifactIds || [],
        isActionable: true,
        requiresUserAuth: false,
        publicMessage: '根据工具 schema 修正了参数。',
        costMultiplier: 1.0,
        safetyLevel: 'safe',
      });
    },
  },

  // ---------------------------------------------------------------------------
  // S-06: fix_enum_or_range
  // ---------------------------------------------------------------------------
  {
    strategyId: 'fix_enum_or_range',
    version: '1.0.0',
    faultTypes: ['invalid_arguments'],
    name: 'Fix enum or range violations',
    description: 'Clamp out-of-range numeric values or pick nearest valid enum.',
    safetyLevel: 'safe',
    costMultiplier: 1.0,

    applicability(diagnosis, context) {
      if (diagnosis.faultType !== 'invalid_arguments') {
        return { applicable: false, reason: 'not invalid_arguments' };
      }
      return { applicable: true };
    },

    attempt(diagnosis, context) {
      const newParams = clampParams(context.originalParams || {});
      return buildRepairAttempt({
        strategyId: 'fix_enum_or_range',
        strategyVersion: '1.0.0',
        newToolId: null,
        newInputs: null,
        newParams,
        parentLineage: {
          parentJobId: context.parentJobId,
          parentArtifactIds: context.parentArtifactIds || [],
          parentPlanHash: context.parentPlanHash || null,
          repairReason: 'enum_or_range_fix',
        },
        invalidatedArtifactIds: [],
        preservedArtifactIds: context.parentArtifactIds || [],
        isActionable: true,
        requiresUserAuth: false,
        publicMessage: '修正了超出范围的参数值。',
        costMultiplier: 1.0,
        safetyLevel: 'safe',
      });
    },
  },

  // ---------------------------------------------------------------------------
  // S-07: transform_input_format
  // ---------------------------------------------------------------------------
  {
    strategyId: 'transform_input_format',
    version: '1.0.0',
    faultTypes: ['input_format'],
    name: 'Transform input format',
    description: 'Apply a deterministic input transformation (column rename, encoding, transpose).',
    safetyLevel: 'safe',
    costMultiplier: 1.0,

    applicability(diagnosis, context) {
      if (diagnosis.faultType !== 'input_format') {
        return { applicable: false, reason: 'not input_format' };
      }
      if (!context.inputTransformation) {
        return { applicable: false, reason: 'no specific input transformation specified' };
      }
      return { applicable: true };
    },

    attempt(diagnosis, context) {
      return buildRepairAttempt({
        strategyId: 'transform_input_format',
        strategyVersion: '1.0.0',
        newToolId: context.originalToolId || null,
        newInputs: {
          ...(context.originalInputs || {}),
          _transformed: true,
          _transformations: context.inputTransformation,
        },
        newParams: context.originalParams || null,
        parentLineage: {
          parentJobId: context.parentJobId,
          parentArtifactIds: context.parentArtifactIds || [],
          parentPlanHash: context.parentPlanHash || null,
          repairReason: 'input_format_transform',
        },
        invalidatedArtifactIds: [],
        preservedArtifactIds: [],
        isActionable: true,
        requiresUserAuth: false,
        publicMessage: `对输入格式进行转换：${describeTransformation(context.inputTransformation)}。`,
        costMultiplier: 1.0,
        safetyLevel: 'safe',
      });
    },
  },

  // ---------------------------------------------------------------------------
  // S-08: ensure_capability
  // ---------------------------------------------------------------------------
  {
    strategyId: 'ensure_capability',
    version: '1.0.0',
    faultTypes: ['runtime_not_ready'],
    name: 'Ensure runtime capability',
    description: 'Ensure required R/Python packages or runtime are installed before retry.',
    safetyLevel: 'safe',
    costMultiplier: 1.1,

    applicability(diagnosis, context) {
      if (diagnosis.faultType !== 'runtime_not_ready') {
        return { applicable: false, reason: 'not runtime_not_ready' };
      }
      return { applicable: true };
    },

    attempt(diagnosis, context) {
      return buildRepairAttempt({
        strategyId: 'ensure_capability',
        strategyVersion: '1.0.0',
        newToolId: context.originalToolId || null,
        newInputs: context.originalInputs || null,
        newParams: {
          ...(context.originalParams || {}),
          _repair: 'ensure_capability',
        },
        parentLineage: {
          parentJobId: context.parentJobId,
          parentArtifactIds: context.parentArtifactIds || [],
          parentPlanHash: context.parentPlanHash || null,
          repairReason: 'capability_provisioning',
        },
        invalidatedArtifactIds: [],
        preservedArtifactIds: context.parentArtifactIds || [],
        isActionable: false,
        requiresUserAuth: false,
        publicMessage: '准备运行时环境后重试。',
        costMultiplier: 1.1,
        safetyLevel: 'safe',
      });
    },
  },

  // ---------------------------------------------------------------------------
  // S-09: rerun_upstream
  // ---------------------------------------------------------------------------
  {
    strategyId: 'rerun_upstream',
    version: '1.0.0',
    faultTypes: ['artifact_invalid'],
    name: 'Re-run upstream DAG nodes',
    description: 'Re-run the first failing node and all downstream nodes, preserving verified artifacts.',
    safetyLevel: 'safe',
    costMultiplier: 1.5,

    applicability(diagnosis, context) {
      if (diagnosis.faultType !== 'artifact_invalid') {
        return { applicable: false, reason: 'not artifact_invalid' };
      }
      if (!context.dag || !Array.isArray(context.dag.nodes)) {
        return { applicable: false, reason: 'no DAG available for subgraph planning' };
      }
      return { applicable: true };
    },

    attempt(diagnosis, context) {
      const { dag, failedNodeId, verifiedArtifactIds = [] } = context;
      const affected = computeAffectedSubgraph(dag, failedNodeId);
      return buildRepairAttempt({
        strategyId: 'rerun_upstream',
        strategyVersion: '1.0.0',
        newToolId: null,
        newInputs: null,
        newParams: {
          _repair: 'rerun_upstream',
          _affectedNodeIds: affected.nodeIds,
          _startNodeId: affected.firstUnverifiedNodeId,
        },
        parentLineage: {
          parentJobId: context.parentJobId,
          parentArtifactIds: context.parentArtifactIds || [],
          parentPlanHash: context.parentPlanHash || null,
          repairReason: 'artifact_invalid_rerun',
        },
        invalidatedArtifactIds: affected.artifactIdsToInvalidate,
        preservedArtifactIds: verifiedArtifactIds,
        isActionable: true,
        requiresUserAuth: false,
        publicMessage: `重新执行节点 [${affected.firstUnverifiedNodeId}] 及其下游 [${affected.nodeIds.join(', ')}]，保留 ${verifiedArtifactIds.length} 个已验证产物。`,
        costMultiplier: 1.5,
        safetyLevel: 'safe',
      });
    },
  },

  // ---------------------------------------------------------------------------
  // S-10: replan_subgraph
  // ---------------------------------------------------------------------------
  {
    strategyId: 'replan_subgraph',
    version: '1.0.0',
    faultTypes: ['method_not_applicable', 'user_input_required'],
    name: 'Replan affected subgraph',
    description: 'Redesign the affected DAG subgraph with alternative method or clearer design.',
    safetyLevel: 'risky',
    costMultiplier: 2.0,

    applicability(diagnosis, context) {
      if (!['method_not_applicable', 'user_input_required'].includes(diagnosis.faultType)) {
        return { applicable: false, reason: 'not method/design fault type' };
      }
      return { applicable: true };
    },

    attempt(diagnosis, context) {
      return buildRepairAttempt({
        strategyId: 'replan_subgraph',
        strategyVersion: '1.0.0',
        newToolId: null,
        newInputs: null,
        newParams: {
          _repair: 'replan_subgraph',
          _faultType: diagnosis.faultType,
        },
        parentLineage: {
          parentJobId: context.parentJobId,
          parentArtifactIds: context.parentArtifactIds || [],
          parentPlanHash: context.parentPlanHash || null,
          repairReason: 'scientific_redesign',
        },
        invalidatedArtifactIds: context.parentArtifactIds || [],
        preservedArtifactIds: [],
        isActionable: false,
        requiresUserAuth: diagnosis.faultType === 'user_input_required',
        publicMessage: diagnosis.faultType === 'user_input_required'
          ? '需要确认实验设计（contrast、配对、批次），无法自动继续。'
          : '方法前提不满足，需要重新设计受影响的子图。',
        costMultiplier: 2.0,
        safetyLevel: 'risky',
      });
    },
  },

  // ---------------------------------------------------------------------------
  // S-11: reduce_resource_request
  // ---------------------------------------------------------------------------
  {
    strategyId: 'reduce_resource_request',
    version: '1.0.0',
    faultTypes: ['resource_pressure'],
    name: 'Reduce resource request',
    description: 'Lower memory/disk/CPU request and retry.',
    safetyLevel: 'safe',
    costMultiplier: 1.0,

    applicability(diagnosis, context) {
      if (diagnosis.faultType !== 'resource_pressure') {
        return { applicable: false, reason: 'not resource_pressure' };
      }
      return { applicable: true };
    },

    attempt(diagnosis, context) {
      return buildRepairAttempt({
        strategyId: 'reduce_resource_request',
        strategyVersion: '1.0.0',
        newToolId: context.originalToolId || null,
        newInputs: context.originalInputs || null,
        newParams: {
          ...(context.originalParams || {}),
          _repair: 'resource_reduction',
        },
        parentLineage: {
          parentJobId: context.parentJobId,
          parentArtifactIds: context.parentArtifactIds || [],
          parentPlanHash: context.parentPlanHash || null,
          repairReason: 'resource_constraint',
        },
        invalidatedArtifactIds: [],
        preservedArtifactIds: context.parentArtifactIds || [],
        isActionable: false,
        requiresUserAuth: false,
        publicMessage: '降低资源请求后重试。',
        costMultiplier: 1.0,
        safetyLevel: 'safe',
      });
    },
  },

  // ---------------------------------------------------------------------------
  // S-12: require_user_authorization
  // ---------------------------------------------------------------------------
  {
    strategyId: 'require_user_authorization',
    version: '1.0.0',
    faultTypes: ['external_side_effect'],
    name: 'Require user authorization',
    description: 'Cannot auto-repair; must have explicit user authorization for external operations.',
    safetyLevel: 'unsafe',
    costMultiplier: 0,

    applicability(diagnosis, context) {
      if (diagnosis.faultType !== 'external_side_effect') {
        return { applicable: false, reason: 'not external_side_effect' };
      }
      return { applicable: true };
    },

    attempt(diagnosis, context) {
      return buildRepairAttempt({
        strategyId: 'require_user_authorization',
        strategyVersion: '1.0.0',
        newToolId: null,
        newInputs: null,
        newParams: null,
        parentLineage: {
          parentJobId: context.parentJobId,
          parentArtifactIds: context.parentArtifactIds || [],
          parentPlanHash: context.parentPlanHash || null,
          repairReason: 'external_side_effect_blocked',
        },
        invalidatedArtifactIds: [],
        preservedArtifactIds: context.parentArtifactIds || [],
        isActionable: false,
        requiresUserAuth: true,
        publicMessage: '外部副作用操作被安全策略阻断，需要明确用户授权。',
        costMultiplier: 0,
        safetyLevel: 'unsafe',
      });
    },
  },
]);

// ---------------------------------------------------------------------------
// Strategy selection
// ---------------------------------------------------------------------------

/**
 * Select the best repair strategy given a diagnosis and context.
 * Priority: prefer safe strategies with lowest cost for the diagnosis.
 *
 * @param {Object} diagnosis  - result of diagnoseFailure()
 * @param {Object} context    - { parentJobId, originalToolId, originalParams, dag, ... }
 * @returns {RepairAttempt|null}
 */
function selectRepairStrategy(diagnosis, context = {}) {
  if (!diagnosis || !diagnosis.faultType) return null;

  const candidates = REPAIR_STRATEGIES.filter(
    (s) => s.faultTypes.includes(diagnosis.faultType),
  );

  if (candidates.length === 0) return null;

  const applicable = [];
  for (const strategy of candidates) {
    const { applicable: isApplicable, reason } = strategy.applicability(diagnosis, context);
    if (isApplicable) {
      applicable.push({ strategy, reason: null });
    }
  }

  if (applicable.length === 0) return null;

  // Prefer: safe > risky > unsafe, then lowest cost
  // For transient_provider: if user has a fallback provider, prefer it (explicitly configured)
  applicable.sort((a, b) => {
    const safetyOrder = { safe: 0, risky: 1, unsafe: 2 };

    // For transient_provider with configured fallback: prefer fallback over backoff
    if (diagnosis.faultType === 'transient_provider' && context.fallbackProvider) {
      if (a.strategy.strategyId === 'fallback_provider') return -1;
      if (b.strategy.strategyId === 'fallback_provider') return 1;
    }

    const sa = safetyOrder[a.strategy.safetyLevel] ?? 1;
    const sb = safetyOrder[b.strategy.safetyLevel] ?? 1;
    if (sa !== sb) return sa - sb;
    return (a.strategy.costMultiplier || 1) - (b.strategy.costMultiplier || 1);
  });

  const best = applicable[0].strategy;

  // HLE-C5R: Enforce strict repair boundary before returning
  const boundary = repairBoundaryCheck(best.strategyId, diagnosis.faultType, best.description);
  if (!boundary.allowed) {
    const attempt = best.attempt(diagnosis, context);
    // Boundary blocked: return new (unfrozen) object with override fields
    return {
      ...attempt,
      isActionable: false,
      requiresUserAuth: true,
      publicMessage: `自动修复 '${best.strategyId}' 被 Repair Boundary 阻断：${boundary.reason} 当前决定：等待用户授权或人工处理。`,
    };
  }
  // Allowed: return original frozen attempt
  return best.attempt(diagnosis, context);
}

/**
 * Build a repair attempt from a strategy.
 */
function buildRepairAttempt({
  strategyId,
  strategyVersion,
  newToolId,
  newInputs,
  newParams,
  parentLineage,
  invalidatedArtifactIds = [],
  preservedArtifactIds = [],
  isActionable = false,
  requiresUserAuth = false,
  publicMessage = '',
  costMultiplier = 1.0,
  safetyLevel = 'safe',
}) {
  return Object.freeze({
    strategyId,
    strategyVersion,
    newToolId: newToolId || null,
    newInputs: newInputs ? Object.freeze({ ...newInputs }) : null,
    newParams: newParams ? Object.freeze({ ...newParams }) : null,
    parentLineage: Object.freeze({
      parentJobId: parentLineage?.parentJobId || null,
      parentArtifactIds: Object.freeze([...(parentLineage?.parentArtifactIds || [])]),
      parentPlanHash: parentLineage?.parentPlanHash || null,
      repairReason: parentLineage?.repairReason || null,
    }),
    invalidatedArtifactIds: Object.freeze([...invalidatedArtifactIds]),
    preservedArtifactIds: Object.freeze([...preservedArtifactIds]),
    isActionable: !!isActionable,
    requiresUserAuth: !!requiresUserAuth,
    publicMessage,
    costMultiplier,
    safetyLevel,
  });
}

// ---------------------------------------------------------------------------
// Utility helpers used by strategies
// ---------------------------------------------------------------------------

function fixParamsFromSchema(params, schema, diagnosis) {
  // Returns a copy of params with schema-violating values corrected.
  // For now: if a required param is missing and has a default, use the default.
  // In production, this would consult the tool definition schema.
  const fixed = { ...params };
  if (schema && Array.isArray(schema.required)) {
    for (const req of schema.required) {
      if (fixed[req] === undefined || fixed[req] === null) {
        if (schema.defaults && schema.defaults[req] !== undefined) {
          fixed[req] = schema.defaults[req];
        }
      }
    }
  }
  fixed._repair = 'schema_fix';
  return fixed;
}

function clampParams(params) {
  // Returns params with out-of-range values clamped.
  // Placeholder: in production, this consults tool schema min/max/enum.
  return {
    ...params,
    _repair: 'clamp_fix',
  };
}

function describeTransformation(transformation) {
  if (!transformation) return '未知转换';
  if (typeof transformation === 'string') return transformation;
  if (Array.isArray(transformation)) return transformation.join(' + ');
  return JSON.stringify(transformation);
}

/**
 * Compute which DAG nodes and artifacts are affected by a failure at failedNodeId.
 * - Preserves all verified artifacts (not in invalidated set)
 * - Marks failedNodeId and all downstream nodes as needing re-run
 *
 * @param {Object} dag
 * @param {string} failedNodeId
 * @returns {{ nodeIds: string[], artifactIdsToInvalidate: string[], firstUnverifiedNodeId: string|null }}
 */
function computeAffectedSubgraph(dag, failedNodeId) {
  if (!dag || !Array.isArray(dag.nodes) || !failedNodeId) {
    return { nodeIds: [], artifactIdsToInvalidate: [], firstUnverifiedNodeId: null };
  }

  const nodeMap = new Map(dag.nodes.map((n) => [n.id, n]));
  const downstream = new Set();
  const queue = [failedNodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (downstream.has(current)) continue;
    downstream.add(current);
    const node = nodeMap.get(current);
    // Only walk downstream (children), not dependsOn (parents)
    if (node && Array.isArray(node.downstream)) {
      for (const child of node.downstream) {
        if (!downstream.has(child)) queue.push(child);
      }
    }
  }

  // Find the first unverified node in topological order
  const verifiedIds = new Set(
    (dag.nodes || [])
      .filter((n) => n.status === 'verified' || n.status === 'completed')
      .map((n) => n.id),
  );
  let firstUnverifiedNodeId = null;
  for (const nodeId of downstream) {
    if (!verifiedIds.has(nodeId)) {
      firstUnverifiedNodeId = nodeId;
      break;
    }
  }

  const artifactIdsToInvalidate = (dag.nodes || [])
    .filter((n) => downstream.has(n.id))
    .map((n) => n.artifactId)
    .filter(Boolean);

  return {
    nodeIds: [...downstream],
    artifactIdsToInvalidate,
    firstUnverifiedNodeId,
  };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

function listStrategies() {
  return REPAIR_STRATEGIES.map((s) => ({
    strategyId: s.strategyId,
    version: s.version,
    faultTypes: s.faultTypes,
    name: s.name,
    safetyLevel: s.safetyLevel,
    costMultiplier: s.costMultiplier,
  }));
}

function getStrategy(strategyId) {
  return REPAIR_STRATEGIES.find((s) => s.strategyId === strategyId) || null;
}

module.exports = {
  REPAIR_STRATEGIES,
  REPAIR_BOUNDARY_ALLOW,
  REPAIR_BOUNDARY_BLOCK,
  repairBoundaryCheck,
  selectRepairStrategy,
  buildRepairAttempt,
  computeAffectedSubgraph,
  listStrategies,
  getStrategy,
  fixParamsFromSchema,
  clampParams,
};