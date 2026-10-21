'use strict';

/**
 * BLOCK-234 S5 — installed domain packs' scientific profiles.
 *
 * The comparison/rerun/replay engines stay in core; which Artifact schemas are
 * admitted, how their columns classify, and which direct children may be
 * replayed are domain policy owned by the pack. A pack declares
 * `provides.scientificProfiles = "<relative json path>"`; the file shape is:
 *
 *   {
 *     version: 1,
 *     comparisons: [{
 *       artifactIds, kind, mode, idColumns,
 *       effectColumns?, significanceColumns?, thresholdParameters?,
 *       statusColumns?, statuses?,
 *       rankColumns?, directionColumns?, directionValues?, unavailableDirectionValue?,
 *       reasons?
 *     }],
 *     rerun: { rootArtifactId, directChildPrimaryArtifacts: { [toolId]: artifactId } },
 *     cohort: { rootArtifactId, childToolId, childArtifactId, childInputId }
 *   }
 *
 * Discipline (same precedent as pack-workflow-templates.js):
 * - only installed and enabled packs; missing/disabled pack → empty profiles;
 * - read-only and bounded; a malformed section is ignored whole per pack;
 * - paths must stay inside packRoot; multi-pack entries are stable by packId
 *   and recorded in `warnings`.
 */

const fs = require('fs');
const path = require('path');
const packRegistry = require('./pack-registry');
const { resolveDataDir } = require('./data-paths');

const MAX_FILE_BYTES = 256 * 1024;
const MAX_PROFILES = 50;
const MAX_ALIASES = 20;
const MAX_ENTRIES = 50;
const MAX_CONSUMERS = 20;
const MAX_PARAMS = 20;
const MAX_PLANNER_RULES = 100;
const MAX_TEXT_CHARS = 200;
const MAX_REASON_CHARS = 160;
const COMPARISON_MODES = new Set(['threshold', 'status', 'ranked']);
const PLANNER_WHEN_KEYS = new Set(['rolesAll', 'questionTypes', 'methodCategories', 'originalRequest', 'any']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clip(text, limit = MAX_TEXT_CHARS) {
  const str = String(text);
  return str.length > limit ? str.slice(0, limit) : str;
}

function readBoundedJson(filePath, packRoot, packId, warnings, label) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(packRoot);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    warnings.push({ packId, code: 'path_outside_pack', file: label });
    return null;
  }
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  if (stat.size > MAX_FILE_BYTES) {
    warnings.push({ packId, code: 'file_too_large', file: label, size: stat.size });
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    warnings.push({ packId, code: 'invalid_json', file: label });
    return null;
  }
}

function stringList(value, packId, code, warnings, limit = MAX_ALIASES) {
  if (!Array.isArray(value) || value.length === 0) {
    warnings.push({ packId, code });
    return null;
  }
  const out = [];
  const seen = new Set();
  for (const item of value.slice(0, limit)) {
    if (typeof item !== 'string' || !item.trim()) {
      warnings.push({ packId, code });
      return null;
    }
    const text = clip(item.trim());
    if (seen.has(text.toLowerCase())) {
      warnings.push({ packId, code: `${code}_duplicate`, value: text });
      return null;
    }
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out;
}

function optionalStringList(value, packId, code, warnings) {
  if (value === undefined) return undefined;
  return stringList(value, packId, code, warnings);
}

function requiredString(value, packId, code, warnings) {
  if (typeof value !== 'string' || !value.trim()) {
    warnings.push({ packId, code });
    return null;
  }
  return clip(value.trim());
}

function sanitizeReasons(raw, packId, warnings) {
  if (raw === undefined) return {};
  if (!isPlainObject(raw)) {
    warnings.push({ packId, code: 'comparison_reasons_invalid' });
    return null;
  }
  const out = {};
  for (const key of ['thresholdsUnavailable', 'schemaInvalid', 'noDirectionColumn', 'directionUnavailable']) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'string' || !raw[key].trim()) {
      warnings.push({ packId, code: 'comparison_reason_invalid', reason: key });
      return null;
    }
    out[key] = clip(raw[key].trim(), MAX_REASON_CHARS);
  }
  return out;
}

function sanitizeComparison(raw, packId, warnings) {
  if (!isPlainObject(raw)) {
    warnings.push({ packId, code: 'comparison_not_object' });
    return null;
  }
  const artifactIds = stringList(raw.artifactIds, packId, 'comparison_artifacts_invalid', warnings);
  if (!artifactIds) return null;
  const mode = typeof raw.mode === 'string' ? raw.mode.trim() : '';
  if (!COMPARISON_MODES.has(mode)) {
    warnings.push({ packId, code: 'comparison_mode_invalid', mode });
    return null;
  }
  const kind = requiredString(raw.kind, packId, 'comparison_kind_invalid', warnings);
  if (!kind) return null;
  const idColumns = stringList(raw.idColumns, packId, 'comparison_id_columns_invalid', warnings);
  if (!idColumns) return null;
  const reasons = sanitizeReasons(raw.reasons, packId, warnings);
  if (!reasons) return null;

  const profile = { artifactIds, kind, mode, idColumns, reasons };
  if (mode === 'threshold') {
    profile.effectColumns = stringList(raw.effectColumns, packId, 'comparison_effect_columns_invalid', warnings);
    profile.significanceColumns = stringList(raw.significanceColumns, packId, 'comparison_significance_columns_invalid', warnings);
    if (!profile.effectColumns || !profile.significanceColumns || !isPlainObject(raw.thresholdParameters)) {
      if (!isPlainObject(raw.thresholdParameters)) warnings.push({ packId, code: 'comparison_threshold_parameters_invalid' });
      return null;
    }
    profile.thresholdParameters = {
      significance: stringList(raw.thresholdParameters.significance, packId, 'comparison_threshold_significance_invalid', warnings),
      effect: stringList(raw.thresholdParameters.effect, packId, 'comparison_threshold_effect_invalid', warnings),
    };
    if (!profile.thresholdParameters.significance || !profile.thresholdParameters.effect) return null;
  } else if (mode === 'status') {
    profile.statusColumns = stringList(raw.statusColumns, packId, 'comparison_status_columns_invalid', warnings);
    if (!profile.statusColumns || !isPlainObject(raw.statuses)) {
      if (!isPlainObject(raw.statuses)) warnings.push({ packId, code: 'comparison_statuses_invalid' });
      return null;
    }
    const statuses = {};
    for (const key of ['positive', 'negative', 'neutral']) {
      if (typeof raw.statuses[key] !== 'string' || !raw.statuses[key].trim()) {
        warnings.push({ packId, code: 'comparison_status_value_invalid', status: key });
        return null;
      }
      statuses[key] = clip(raw.statuses[key].trim());
    }
    profile.statuses = statuses;
  } else {
    profile.rankColumns = stringList(raw.rankColumns, packId, 'comparison_rank_columns_invalid', warnings);
    profile.directionColumns = optionalStringList(raw.directionColumns, packId, 'comparison_direction_columns_invalid', warnings);
    profile.directionValues = optionalStringList(raw.directionValues, packId, 'comparison_direction_values_invalid', warnings);
    profile.unavailableDirectionValue = typeof raw.unavailableDirectionValue === 'string'
      ? clip(raw.unavailableDirectionValue.trim())
      : undefined;
    if (!profile.rankColumns || (raw.directionColumns !== undefined && !profile.directionColumns)
        || (raw.directionValues !== undefined && !profile.directionValues)
        || (raw.unavailableDirectionValue !== undefined && !profile.unavailableDirectionValue)) {
      return null;
    }
  }
  return profile;
}

function sanitizeRerun(raw, packId, warnings) {
  if (!isPlainObject(raw)) {
    warnings.push({ packId, code: 'rerun_not_object' });
    return null;
  }
  const rootArtifactId = requiredString(raw.rootArtifactId, packId, 'rerun_root_artifact_invalid', warnings);
  if (!rootArtifactId) return null;
  if (!isPlainObject(raw.directChildPrimaryArtifacts)) {
    warnings.push({ packId, code: 'rerun_children_invalid' });
    return null;
  }
  const entries = Object.entries(raw.directChildPrimaryArtifacts).slice(0, MAX_ENTRIES);
  const directChildPrimaryArtifacts = {};
  for (const [toolId, artifactId] of entries) {
    if (!toolId.trim() || typeof artifactId !== 'string' || !artifactId.trim()) {
      warnings.push({ packId, code: 'rerun_child_invalid', toolId });
      return null;
    }
    directChildPrimaryArtifacts[clip(toolId.trim())] = clip(artifactId.trim());
  }
  if (Object.keys(raw.directChildPrimaryArtifacts).length > MAX_ENTRIES) {
    warnings.push({ packId, code: 'rerun_children_truncated', kept: MAX_ENTRIES });
  }
  return { rootArtifactId, directChildPrimaryArtifacts };
}

function sanitizeCohort(raw, packId, warnings) {
  if (!isPlainObject(raw)) {
    warnings.push({ packId, code: 'cohort_not_object' });
    return null;
  }
  const fields = ['rootArtifactId', 'rootToolId', 'childToolId', 'childArtifactId', 'childInputId'];
  const out = {};
  for (const field of fields) {
    const value = requiredString(raw[field], packId, `cohort_${field}_invalid`, warnings);
    if (!value) return null;
    out[field] = value;
  }
  return out;
}

function sanitizePrimitiveParams(raw, packId, code, warnings) {
  if (raw === undefined) return {};
  if (!isPlainObject(raw) || Object.keys(raw).length > MAX_PARAMS) {
    warnings.push({ packId, code });
    return null;
  }
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key.trim() || !['string', 'number', 'boolean'].includes(typeof value)) {
      warnings.push({ packId, code });
      return null;
    }
    out[clip(key.trim())] = typeof value === 'string' ? clip(value) : value;
  }
  return out;
}

function sanitizeSelectionConsumer(raw, packId, warnings) {
  if (!isPlainObject(raw)) {
    warnings.push({ packId, code: 'selection_consumer_not_object' });
    return null;
  }
  const toolId = requiredString(raw.toolId, packId, 'selection_consumer_tool_invalid', warnings);
  const entityType = requiredString(raw.entityType, packId, 'selection_consumer_entity_invalid', warnings);
  const fileInput = requiredString(raw.fileInput, packId, 'selection_consumer_file_input_invalid', warnings);
  if (!toolId || !entityType || !fileInput) return null;
  const defaultParams = sanitizePrimitiveParams(raw.defaultParams, packId, 'selection_consumer_params_invalid', warnings);
  if (!defaultParams) return null;
  let argMappings = {};
  if (raw.argMappings !== undefined) {
    if (!isPlainObject(raw.argMappings) || Object.keys(raw.argMappings).length > MAX_PARAMS) {
      warnings.push({ packId, code: 'selection_consumer_arg_mappings_invalid' });
      return null;
    }
    argMappings = {};
    for (const [argKey, paramKey] of Object.entries(raw.argMappings)) {
      if (!argKey.trim() || typeof paramKey !== 'string' || !paramKey.trim()) {
        warnings.push({ packId, code: 'selection_consumer_arg_mappings_invalid' });
        return null;
      }
      argMappings[clip(argKey.trim())] = clip(paramKey.trim());
    }
  }
  const requiredSourceActions = raw.requiredSourceActions === undefined
    ? []
    : stringList(raw.requiredSourceActions, packId, 'selection_consumer_source_actions_invalid', warnings);
  if (!requiredSourceActions) return null;
  let deriveFromRevision = null;
  if (raw.deriveFromRevision !== undefined && raw.deriveFromRevision !== null) {
    if (!isPlainObject(raw.deriveFromRevision)) {
      warnings.push({ packId, code: 'selection_consumer_derive_invalid' });
      return null;
    }
    const sourceArtifactId = requiredString(raw.deriveFromRevision.sourceArtifactId, packId, 'selection_consumer_derive_source_invalid', warnings);
    const idField = requiredString(raw.deriveFromRevision.idField, packId, 'selection_consumer_derive_id_field_invalid', warnings);
    if (!sourceArtifactId || !idField) return null;
    deriveFromRevision = { sourceArtifactId, idField };
  }
  return {
    toolId,
    entityType,
    fileInput,
    label: typeof raw.label === 'string' && raw.label.trim() ? clip(raw.label.trim()) : toolId,
    defaultParams,
    argMappings,
    requiredSourceActions,
    deriveFromRevision,
  };
}

function sanitizeCondition(raw, packId, code, warnings, { allowAny = false, allowEmpty = false } = {}) {
  if (!isPlainObject(raw)) {
    warnings.push({ packId, code });
    return null;
  }
  const allowed = allowAny ? PLANNER_WHEN_KEYS : new Set(['rolesAll', 'questionTypes', 'methodCategories', 'originalRequest']);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    warnings.push({ packId, code: `${code}_unknown`, keys: unknown });
    return null;
  }
  const out = {};
  let specified = 0;
  for (const key of ['rolesAll', 'questionTypes', 'methodCategories']) {
    if (raw[key] === undefined) continue;
    out[key] = stringList(raw[key], packId, `${code}_${key}_invalid`, warnings);
    if (!out[key]) return null;
    specified += 1;
  }
  if (raw.originalRequest !== undefined) {
    if (typeof raw.originalRequest !== 'boolean') {
      warnings.push({ packId, code: `${code}_original_request_invalid` });
      return null;
    }
    out.originalRequest = raw.originalRequest;
    specified += 1;
  }
  if (specified === 0 && !allowEmpty) {
    warnings.push({ packId, code: `${code}_empty` });
    return null;
  }
  return out;
}

function sanitizePlannerRule(raw, packId, warnings) {
  if (!isPlainObject(raw)) {
    warnings.push({ packId, code: 'planner_rule_not_object' });
    return null;
  }
  const toolId = requiredString(raw.toolId, packId, 'planner_rule_tool_invalid', warnings);
  const rationale = requiredString(raw.rationale, packId, 'planner_rule_rationale_invalid', warnings);
  if (!toolId || !rationale) return null;
  if (!isPlainObject(raw.when)) {
    warnings.push({ packId, code: 'planner_rule_when_invalid' });
    return null;
  }
  const hasAny = raw.when.any !== undefined;
  const when = sanitizeCondition(raw.when, packId, 'planner_rule_when_invalid', warnings, {
    allowAny: true,
    allowEmpty: hasAny,
  });
  if (!when) return null;
  if (hasAny) {
    if (!Array.isArray(raw.when.any) || raw.when.any.length === 0 || raw.when.any.length > MAX_ALIASES) {
      warnings.push({ packId, code: 'planner_rule_any_invalid' });
      return null;
    }
    when.any = [];
    for (const group of raw.when.any) {
      const sanitized = sanitizeCondition(group, packId, 'planner_rule_any_group_invalid', warnings);
      if (!sanitized) return null;
      when.any.push(sanitized);
    }
  }
  const prerequisites = raw.prerequisites === undefined
    ? []
    : stringList(raw.prerequisites, packId, 'planner_rule_prerequisites_invalid', warnings);
  const risks = raw.risks === undefined
    ? []
    : stringList(raw.risks, packId, 'planner_rule_risks_invalid', warnings);
  if (!prerequisites || !risks) return null;
  if (raw.order !== undefined && !Number.isFinite(raw.order)) {
    warnings.push({ packId, code: 'planner_rule_order_invalid' });
    return null;
  }
  return {
    toolId,
    when,
    rationale,
    prerequisites,
    risks,
    order: raw.order === undefined ? 1000 : raw.order,
  };
}

function sanitizeHeavyTools(raw, packId, warnings) {
  const tools = stringList(raw, packId, 'heavy_tools_invalid', warnings, MAX_ENTRIES);
  return tools;
}

function sanitizeInterpret(raw, packId, warnings) {
  if (!isPlainObject(raw)) {
    warnings.push({ packId, code: 'interpret_not_object' });
    return null;
  }
  const standardAnalysisTypes = stringList(
    raw.standardAnalysisTypes,
    packId,
    'interpret_standard_types_invalid',
    warnings,
    MAX_ENTRIES,
  );
  if (!standardAnalysisTypes) return null;
  return { standardAnalysisTypes };
}

function emptyProfiles() {
  return {
    comparisons: {},
    rerun: null,
    cohort: null,
    selectionConsumers: {},
    plannerRules: [],
    heavyTools: [],
    interpret: null,
    warnings: [],
  };
}

/**
 * Read all enabled packs' scientific profiles.
 * No pack installed → empty profiles; helpers then degrade honestly.
 */
function loadScientificProfiles() {
  let packs = [];
  try {
    packs = packRegistry.readInstalledPacks(resolveDataDir());
  } catch {
    return emptyProfiles();
  }
  const result = emptyProfiles();
  const warnings = result.warnings;
  const ordered = packs
    .filter((pack) => pack && pack.enabled !== false && pack.packRoot)
    .sort((a, b) => String(a.packId).localeCompare(String(b.packId)));
  for (const pack of ordered) {
    const packId = pack.packId;
    const manifest = readBoundedJson(
      path.join(pack.packRoot, 'pack.json'),
      pack.packRoot,
      packId,
      warnings,
      'pack.json',
    );
    const relative = manifest && isPlainObject(manifest.provides)
      ? manifest.provides.scientificProfiles
      : null;
    if (typeof relative !== 'string' || !relative.trim()) continue;
    const parsed = readBoundedJson(
      path.join(pack.packRoot, relative.trim()),
      pack.packRoot,
      packId,
      warnings,
      relative.trim(),
    );
    if (!isPlainObject(parsed)) {
      if (parsed !== null) warnings.push({ packId, code: 'scientific_profiles_not_object' });
      continue;
    }

    if (parsed.comparisons !== undefined) {
      if (!Array.isArray(parsed.comparisons)) {
        warnings.push({ packId, code: 'comparisons_not_array' });
      } else {
        if (parsed.comparisons.length > MAX_PROFILES) {
          warnings.push({ packId, code: 'comparisons_truncated', kept: MAX_PROFILES });
        }
        for (const raw of parsed.comparisons.slice(0, MAX_PROFILES)) {
          const profile = sanitizeComparison(raw, packId, warnings);
          if (!profile) continue;
          for (const artifactId of profile.artifactIds) {
            if (result.comparisons[artifactId]) {
              warnings.push({ packId, code: 'comparison_overridden', artifactId });
            }
            result.comparisons[artifactId] = profile;
          }
        }
      }
    }

    if (parsed.rerun !== undefined) {
      const rerun = sanitizeRerun(parsed.rerun, packId, warnings);
      if (rerun) {
        if (result.rerun) warnings.push({ packId, code: 'rerun_overridden' });
        result.rerun = rerun;
      }
    }

    if (parsed.cohort !== undefined) {
      const cohort = sanitizeCohort(parsed.cohort, packId, warnings);
      if (cohort) {
        if (result.cohort) warnings.push({ packId, code: 'cohort_overridden' });
        result.cohort = cohort;
      }
    }

    if (parsed.selectionConsumers !== undefined) {
      if (!isPlainObject(parsed.selectionConsumers)) {
        warnings.push({ packId, code: 'selection_consumers_not_object' });
      } else {
        const entries = Object.entries(parsed.selectionConsumers).slice(0, MAX_CONSUMERS);
        if (Object.keys(parsed.selectionConsumers).length > MAX_CONSUMERS) {
          warnings.push({ packId, code: 'selection_consumers_truncated', kept: MAX_CONSUMERS });
        }
        for (const [actionId, rawConsumer] of entries) {
          if (!actionId.trim()) {
            warnings.push({ packId, code: 'selection_consumer_action_invalid' });
            continue;
          }
          const consumer = sanitizeSelectionConsumer(rawConsumer, packId, warnings);
          if (!consumer) continue;
          const key = clip(actionId.trim());
          if (result.selectionConsumers[key]) {
            warnings.push({ packId, code: 'selection_consumer_overridden', actionId: key });
          }
          result.selectionConsumers[key] = consumer;
        }
      }
    }

    if (parsed.planner !== undefined) {
      if (!isPlainObject(parsed.planner) || !Array.isArray(parsed.planner.rules)) {
        warnings.push({ packId, code: 'planner_rules_invalid' });
      } else {
        if (parsed.planner.rules.length > MAX_PLANNER_RULES) {
          warnings.push({ packId, code: 'planner_rules_truncated', kept: MAX_PLANNER_RULES });
        }
        for (const rawRule of parsed.planner.rules.slice(0, MAX_PLANNER_RULES)) {
          const rule = sanitizePlannerRule(rawRule, packId, warnings);
          if (rule) result.plannerRules.push(rule);
        }
      }
    }

    if (parsed.heavyTools !== undefined) {
      const tools = sanitizeHeavyTools(parsed.heavyTools, packId, warnings);
      if (tools) {
        for (const toolId of tools) {
          if (!result.heavyTools.includes(toolId)) result.heavyTools.push(toolId);
        }
      }
    }

    if (parsed.interpret !== undefined) {
      const interpret = sanitizeInterpret(parsed.interpret, packId, warnings);
      if (interpret) {
        if (result.interpret) warnings.push({ packId, code: 'interpret_overridden' });
        result.interpret = interpret;
      }
    }
  }
  return result;
}

module.exports = {
  loadScientificProfiles,
  MAX_FILE_BYTES,
  MAX_PROFILES,
  MAX_ALIASES,
};
