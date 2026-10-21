'use strict';

/**
 * HRT-2: translate a normalized ScientificTaskSpec into bounded evidence and
 * method candidates. This module is deliberately side-effect free: it never
 * creates a tool_job and never executes a plugin.
 *
 * BLOCK-234 S5: which modules are recommended, and under which observed roles,
 * is domain policy declared by the installed pack (`provides.scientificProfiles`
 * → planner rules). Core only evaluates the bounded rule vocabulary.
 */

const { loadScientificProfiles } = require('./pack-scientific-profiles');


const STATUS = Object.freeze({
  READY: 'ready_for_confirmation',
  NEEDS_DECISION: 'requires_user_decision',
  CANNOT_ANSWER: 'cannot_reliably_answer',
  NO_METHOD: 'no_matching_method',
});

function text(value) { return typeof value === 'string' ? value.trim() : ''; }

function normalizeEvidence(item) {
  const source = item && typeof item === 'object' ? item : {};
  return {
    relativePath: text(source.relativePath || source.path) || null,
    sha256: text(source.sha256).toLowerCase() || null,
    sizeBytes: Number.isFinite(Number(source.sizeBytes)) ? Number(source.sizeBytes) : null,
    kind: text(source.kind || source.fileType) || 'unknown',
    headers: Array.isArray(source.headers) ? source.headers.map(text).filter(Boolean) : [],
    sampleIds: Array.isArray(source.sampleIds) ? source.sampleIds.map(text).filter(Boolean) : [],
    rows: Number.isFinite(Number(source.rows)) ? Number(source.rows) : null,
    columns: Number.isFinite(Number(source.columns)) ? Number(source.columns) : null,
    source: text(source.source) || 'bounded_probe',
  };
}

function hasHeader(evidence, names) {
  const headers = new Set(evidence.flatMap((item) => item.headers.map((h) => h.toLowerCase())));
  return names.some((name) => headers.has(name));
}

// HLE-C5R: Detect contrast metadata column from evidence headers
function detectContrastLevels(evidence) {
  const headers = new Set((evidence || []).flatMap((item) => item.headers.map((h) => h.toLowerCase())));
  const contrastKeywords = ['condition', 'group', 'treatment', 'control', 'status', 'genotype', 'stage'];
  for (const h of headers) {
    for (const kw of contrastKeywords) {
      if (h.includes(kw)) return h;
    }
  }
  return null;
}

function inputEvidence(taskSpec, evidence) {
  const byPath = new Map(evidence.map((item) => [item.relativePath, item]));
  return (taskSpec.inputs || []).map((input) => {
    const relativePath = input.relativePath || null;
    return {
      role: input.role || 'unknown',
      relativePath,
      snapshot: byPath.get(relativePath) || null,
      evidenceStatus: byPath.has(relativePath) ? 'observed' : 'missing',
    };
  });
}

function candidateFor(manifest, reason, prerequisites, risk = []) {
  return {
    toolId: manifest.id,
    title: manifest.title || manifest.id,
    category: manifest.category || null,
    entryPoint: manifest.entryPoint || manifest.execution?.entryPoint || null,
    pluginVersion: manifest.version || null,
    rationale: reason,
    prerequisites,
    risks: risk,
    supportedPlatforms: manifest.supportedPlatforms || [],
    inputs: (manifest.inputs || []).map((input) => input.id),
  };
}

function conditionMatches(condition, context) {
  if (!condition || typeof condition !== 'object') return false;
  if (Array.isArray(condition.rolesAll) && condition.rolesAll.length > 0
      && !condition.rolesAll.every((role) => context.roles.has(role))) return false;
  if (Array.isArray(condition.questionTypes) && condition.questionTypes.length > 0
      && !condition.questionTypes.includes(context.questionType)) return false;
  if (Array.isArray(condition.methodCategories) && condition.methodCategories.length > 0
      && !condition.methodCategories.includes(context.methodCategory)) return false;
  if (condition.originalRequest === true && context.originalRequest !== true) return false;
  return true;
}

function ruleMatches(when, context) {
  if (!conditionMatches(when, context)) return false;
  if (Array.isArray(when.any) && when.any.length > 0
      && !when.any.some((group) => conditionMatches(group, context))) return false;
  return true;
}

function evidenceFromIndex(index = {}) {
  return (Array.isArray(index.entries) ? index.entries : []).map((entry) => ({
    relativePath: entry.relativePath || null,
    sha256: entry.hash?.sha256 || entry.sha256 || null,
    sizeBytes: entry.size,
    kind: entry.kind,
    headers: entry.table?.headers || [],
    rows: entry.table?.rowCount ?? null,
    columns: entry.table?.columnCount ?? entry.table?.headers?.length ?? null,
    source: 'harness-file-index',
  }));
}

function planScientificTask({ taskSpec, evidence = [], plugins = [], runtime = null, plannerRules = null } = {}) {
  if (!taskSpec || typeof taskSpec !== 'object') throw new Error('taskSpec is required');
  const observed = evidence.map(normalizeEvidence);
  const mappedInputs = inputEvidence(taskSpec, observed);
  const counts = mappedInputs.find((item) => item.role === 'counts');
  const metadata = mappedInputs.find((item) => item.role === 'metadata');
  const normalizedPlugins = Array.isArray(plugins) ? plugins.filter((item) => item && item.id) : [];
  const diagnostics = [];
  const gaps = [];

  if (mappedInputs.some((item) => item.evidenceStatus === 'missing')) {
    gaps.push({ code: 'input_evidence_missing', message: '至少一个输入文件尚未获得可审阅的结构证据。' });
  }
  if (!counts) gaps.push({ code: 'counts_input_missing', message: '没有识别到 counts 表。' });
  // HLE-C5R: Explicit contrast detection for Bulk RNA coldata binding
  // BLOCK-145 D3（多因子 design）：taskSpec.design（scientific-task-spec 既有 groups/covariates
  // 词汇）显式声明设计时，coldataBinding 必须完整携带公式与因子项，不再静默收窄为单列；
  // 公式最后一项为 contrast 列，contrast 仍限两水平。声明列缺失时 fail-closed（design_column_missing）。
  const designSpec = taskSpec.design && typeof taskSpec.design === 'object' ? taskSpec.design : null;
  const declaredCovariates = Array.isArray(designSpec?.covariates) ? designSpec.covariates.map(text).filter(Boolean) : [];
  const declaredGroups = Array.isArray(designSpec?.groups) ? designSpec.groups.map(text).filter(Boolean) : [];
  const declaredTerms = [...declaredCovariates, ...declaredGroups];
  const declaredFormula = declaredTerms.length > 0 ? `~ ${declaredTerms.join(' + ')}` : null;
  const declaredContrastCol = declaredGroups.length > 0 ? declaredGroups[declaredGroups.length - 1] : null;
  const declaredMissing = metadata?.snapshot && declaredTerms.length > 0
    ? declaredTerms.filter((term) => !metadata.snapshot.headers.map((h) => String(h).toLowerCase()).includes(term.toLowerCase()))
    : [];
  if (declaredMissing.length > 0) {
    gaps.push({
      code: 'design_column_missing',
      message: `design 公式 '${declaredFormula}' 中的列 '${declaredMissing.join("', '")}' 不存在于 metadata 表头，需补齐 coldata 列或修正 design 声明。`,
    });
  }
  let coldataBinding = null;
  if (metadata?.snapshot && declaredTerms.length === 0
      && !hasHeader([metadata.snapshot], ['condition', 'group', 'treatment', 'control'])) {
    gaps.push({ code: 'contrast_column_missing', message: 'metadata 中没有可识别的处理/对照分组列，不能可靠推断 contrast。' });
  } else if (metadata?.snapshot && counts) {
    const contrastCol = declaredContrastCol || detectContrastLevels([metadata.snapshot]);
    const bindingUsable = declaredTerms.length > 0
      ? Boolean(declaredContrastCol) && declaredMissing.length === 0
      : Boolean(contrastCol);
    if (bindingUsable) {
      coldataBinding = {
        metadataFile: metadata.relativePath,
        coldataFile: metadata.relativePath,
        designColumn: contrastCol,
        ...(declaredFormula ? { designFormula: declaredFormula, designTerms: declaredTerms } : {}),
        note: `coldata 来自 metadata 文件 '${metadata.relativePath}'，${declaredFormula ? `design 公式 '${declaredFormula}'（contrast 列 '${contrastCol}'，contrast_ref/contrast_treat 仍限两水平）` : `design 列 '${contrastCol}'`}。contrast_ref/contrast_treat 具体值必须来自 sample-metadata-validator 验证结果，禁止 Agent 自行推断。`,
        requiredValidator: 'sample-metadata-validator',
      };
    }
  }
  const unresolved = Array.isArray(taskSpec.requiresUserDecision)
    ? taskSpec.requiresUserDecision.filter((item) => item && item.required !== false && item.status === 'unresolved')
    : [];
  if (unresolved.length) {
    gaps.push(...unresolved.map((item) => ({ code: 'user_decision_required', message: item.question, decisionId: item.id })));
  }

  const candidates = [];
  const rules = Array.isArray(plannerRules) ? plannerRules : loadScientificProfiles().plannerRules;
  const roles = new Set(mappedInputs.map((item) => item.role).filter((role) => role && role !== 'unknown'));
  const context = {
    roles,
    questionType: text(taskSpec.question?.questionType) || null,
    methodCategory: text(taskSpec.method?.category) || null,
    originalRequest: Boolean(text(taskSpec.originalRequest)),
  };
  const seen = new Set();
  const ordered = rules
    .map((rule, index) => ({ rule, index }))
    .sort((left, right) => (left.rule.order - right.rule.order) || (left.index - right.index));
  for (const { rule } of ordered) {
    if (seen.has(rule.toolId) || !ruleMatches(rule.when, context)) continue;
    const manifest = normalizedPlugins.find((item) => item.id === rule.toolId);
    if (!manifest) continue;
    seen.add(rule.toolId);
    candidates.push(candidateFor(manifest, rule.rationale, rule.prerequisites, rule.risks));
  }

  let status = STATUS.READY;
  if (gaps.some((gap) => ['contrast_column_missing', 'counts_input_missing'].includes(gap.code))) status = STATUS.CANNOT_ANSWER;
  else if (gaps.length) status = STATUS.NEEDS_DECISION;
  if (!candidates.length) status = STATUS.NO_METHOD;

  const recommendation = candidates[0] || null;
  return {
    schemaVersion: 1,
    planner: 'scientific-task-planner',
    status,
    taskRef: { taskId: taskSpec.taskId || null, projectId: taskSpec.projectId || null, conversationId: taskSpec.conversationId || null },
    evidence: mappedInputs,
    runtime: runtime ? { status: text(runtime.status) || 'unknown', version: text(runtime.version) || null, source: text(runtime.source) || 'runtime_probe' } : null,
    candidates,
    recommendation,
    coldataBinding, // HLE-C5R: explicit metadata→coldata binding
    gaps,
    diagnostics,
    execution: { createsToolJob: false, requiresConfirmation: status === STATUS.READY || status === STATUS.NEEDS_DECISION },
    next: status === STATUS.CANNOT_ANSWER ? '补充分组/contrast 或可识别的 metadata 证据后重新规划。' : status === STATUS.NO_METHOD ? '安装或开发声明了该输入/产物契约的插件。' : '审阅推荐方案、输入快照和风险后再进入确认门。',
  };
}

function planScientificTaskFromIndex({ taskSpec, index, manifests = [], runtime = null, plannerRules = null } = {}) {
  return planScientificTask({
    taskSpec,
    evidence: evidenceFromIndex(index),
    plugins: manifests,
    runtime,
    plannerRules,
  });
}

module.exports = { STATUS, normalizeEvidence, evidenceFromIndex, planScientificTask, planScientificTaskFromIndex };
