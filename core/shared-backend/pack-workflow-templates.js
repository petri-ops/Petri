'use strict';

/**
 * BLOCK-234 — installed domain packs' agent workflow templates.
 *
 * Mechanism stays in core; the workflow catalog (ids, titles, steps, tool
 * candidates) is domain data owned by the pack. A pack declares
 * `provides.agentWorkflowTemplates = "<relative json path>"`; the file shape is
 * an array of templates:
 *
 *   [{ id, title, description, steps: [{ id, toolCandidates, dependsOn?, inputBindings? }] }]
 *
 * Discipline (same precedent as pack-methods.js):
 * - only installed and enabled packs; missing/disabled pack → empty catalog;
 * - read-only and bounded; bad shape fails closed per pack (no partial merge);
 * - paths must stay inside packRoot; multi-pack overrides are stable by packId
 *   and recorded in `warnings`.
 */

const fs = require('fs');
const path = require('path');
const packRegistry = require('./pack-registry');
const { resolveDataDir } = require('./data-paths');

const MAX_FILE_BYTES = 256 * 1024;
const MAX_TEMPLATES = 20;
const MAX_STEPS = 20;
const MAX_CANDIDATES = 10;
const MAX_BINDINGS = 20;
const MAX_TEXT_CHARS = 400;

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

function sanitizeStringList(value, limit) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => clip(item.trim()))
    .slice(0, limit);
}

function sanitizeTemplate(raw, packId, warnings) {
  if (!isPlainObject(raw)) {
    warnings.push({ packId, code: 'template_not_object' });
    return null;
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id || id.length > 80) {
    warnings.push({ packId, code: 'template_id_invalid' });
    return null;
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    warnings.push({ packId, code: 'template_steps_missing', templateId: id });
    return null;
  }
  const steps = [];
  const stepIds = new Set();
  for (const rawStep of raw.steps.slice(0, MAX_STEPS)) {
    if (!isPlainObject(rawStep)) {
      warnings.push({ packId, code: 'step_not_object', templateId: id });
      return null;
    }
    const stepId = typeof rawStep.id === 'string' ? rawStep.id.trim() : '';
    if (!stepId || stepIds.has(stepId)) {
      warnings.push({ packId, code: 'step_id_invalid', templateId: id });
      return null;
    }
    stepIds.add(stepId);
    const toolCandidates = sanitizeStringList(rawStep.toolCandidates, MAX_CANDIDATES);
    if (toolCandidates.length === 0) {
      warnings.push({ packId, code: 'step_candidates_missing', templateId: id, stepId });
      return null;
    }
    const dependsOn = sanitizeStringList(rawStep.dependsOn, MAX_STEPS);
    const inputBindings = [];
    if (rawStep.inputBindings !== undefined) {
      if (!Array.isArray(rawStep.inputBindings)) {
        warnings.push({ packId, code: 'bindings_not_array', templateId: id, stepId });
        return null;
      }
      for (const rawBinding of rawStep.inputBindings.slice(0, MAX_BINDINGS)) {
        if (!isPlainObject(rawBinding)) {
          warnings.push({ packId, code: 'binding_not_object', templateId: id, stepId });
          return null;
        }
        const inputId = typeof rawBinding.inputId === 'string' ? rawBinding.inputId.trim() : '';
        const fromStepId = typeof rawBinding.fromStepId === 'string' ? rawBinding.fromStepId.trim() : '';
        if (!inputId || !fromStepId) {
          warnings.push({ packId, code: 'binding_ids_missing', templateId: id, stepId });
          return null;
        }
        const binding = { inputId, fromStepId };
        if (typeof rawBinding.artifactType === 'string' && rawBinding.artifactType.trim()) {
          binding.artifactType = clip(rawBinding.artifactType.trim());
        }
        if (typeof rawBinding.artifactProfile === 'string' && rawBinding.artifactProfile.trim()) {
          binding.artifactProfile = clip(rawBinding.artifactProfile.trim());
        }
        if (typeof rawBinding.description === 'string' && rawBinding.description.trim()) {
          binding.description = clip(rawBinding.description.trim());
        }
        inputBindings.push(binding);
      }
    }
    steps.push({ id: stepId, toolCandidates, dependsOn, inputBindings });
  }
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (dep === step.id || !stepIds.has(dep)) {
        warnings.push({ packId, code: 'step_dependency_invalid', templateId: id, stepId: step.id, dependency: dep });
        return null;
      }
    }
    for (const binding of step.inputBindings) {
      if (!stepIds.has(binding.fromStepId)) {
        warnings.push({ packId, code: 'binding_source_invalid', templateId: id, stepId: step.id });
        return null;
      }
    }
  }
  return {
    id,
    title: typeof raw.title === 'string' ? clip(raw.title.trim()) : id,
    description: typeof raw.description === 'string' ? clip(raw.description.trim()) : '',
    steps,
  };
}

/**
 * Read all enabled packs' workflow templates.
 * Returns `{ templates, warnings }`; no pack installed → `{ templates: [] }`.
 */
function loadAgentWorkflowTemplates() {
  let packs = [];
  try {
    packs = packRegistry.readInstalledPacks(resolveDataDir());
  } catch {
    return { templates: [], warnings: [] };
  }
  const warnings = [];
  const templates = [];
  const indexById = new Map();
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
      ? manifest.provides.agentWorkflowTemplates
      : null;
    if (typeof relative !== 'string' || !relative.trim()) continue;
    const parsed = readBoundedJson(
      path.join(pack.packRoot, relative.trim()),
      pack.packRoot,
      packId,
      warnings,
      relative.trim(),
    );
    if (!Array.isArray(parsed)) {
      if (parsed !== null) warnings.push({ packId, code: 'templates_not_array' });
      continue;
    }
    if (parsed.length > MAX_TEMPLATES) {
      warnings.push({ packId, code: 'templates_truncated', kept: MAX_TEMPLATES });
    }
    for (const raw of parsed.slice(0, MAX_TEMPLATES)) {
      const template = sanitizeTemplate(raw, packId, warnings);
      if (!template) continue;
      if (indexById.has(template.id)) {
        warnings.push({ packId, code: 'template_overridden', templateId: template.id });
        templates[indexById.get(template.id)] = template;
      } else {
        indexById.set(template.id, templates.length);
        templates.push(template);
      }
    }
  }
  return { templates, warnings };
}

module.exports = {
  loadAgentWorkflowTemplates,
};
