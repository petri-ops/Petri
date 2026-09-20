'use strict';

/**
 * HRT-2: translate a normalized ScientificTaskSpec into bounded evidence and
 * method candidates. This module is deliberately side-effect free: it never
 * creates a tool_job and never executes a plugin.
 */


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

function planScientificTask({ taskSpec, evidence = [], plugins = [], runtime = null } = {}) {
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
  let coldataBinding = null;
  if (metadata?.snapshot && !hasHeader([metadata.snapshot], ['condition', 'group', 'treatment', 'control'])) {
    gaps.push({ code: 'contrast_column_missing', message: 'metadata 中没有可识别的处理/对照分组列，不能可靠推断 contrast。' });
  } else if (metadata?.snapshot && counts) {
    const contrastCol = detectContrastLevels([metadata.snapshot]);
    if (contrastCol) {
      coldataBinding = {
        metadataFile: metadata.relativePath,
        coldataFile: metadata.relativePath,
        designColumn: contrastCol,
        note: `DESeq2 coldata 来自 metadata 文件 '${metadata.relativePath}'，design 列 '${contrastCol}'。contrast_ref/contrast_treat 具体值必须来自 sample-metadata-validator 验证结果，禁止 Agent 自行推断。`,
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
  const add = (id, reason, prerequisites, risk) => {
    const manifest = normalizedPlugins.find((item) => item.id === id);
    if (manifest) candidates.push(candidateFor(manifest, reason, prerequisites, risk));
  };
  if (counts) add('sample-metadata-validator', '先验证 counts 与 metadata 的样本对齐、分组和重复数，避免把文件名当作实验设计。', ['counts', 'metadata', 'contrast'], ['分组列缺失时必须阻断']);
  if (counts) add('expression-qc', 'counts 结构已被定位，先做有界质量检查，再决定是否进入差异分析。', ['counts'], ['QC 不会自动删除样本']);
  if (counts && (taskSpec.question?.questionType === 'differential_expression' || taskSpec.method?.category === 'bulk RNA-seq' || taskSpec.originalRequest)) {
    add('deseq2', '用户目标涉及处理组与对照组的差异，且 counts 是适合该模块的输入；正式运行前仍需确认 contrast。', ['validated_metadata', 'qc_summary', 'contrast'], ['结果显著性必须来自实际结果表，不能由规划器推断', 'contrast_ref/contrast_treat 来自 sample-metadata-validator，不来自 Agent 猜测']);
  }
  const downstream = normalizedPlugins.filter((item) => ['go-kegg', 'gsea', 'volcano-plot', 'pca-explorer'].includes(item.id));
  for (const manifest of downstream) {
    candidates.push(candidateFor(manifest, '作为差异结果或 QC artifact 的下游展示/功能解释模块，必须绑定已验证上游 Artifact。', ['verified_upstream_artifact'], ['不能直接消费聊天文本或未验证文件']));
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

function planScientificTaskFromIndex({ taskSpec, index, manifests = [], runtime = null } = {}) {
  return planScientificTask({
    taskSpec,
    evidence: evidenceFromIndex(index),
    plugins: manifests,
    runtime,
  });
}

module.exports = { STATUS, normalizeEvidence, evidenceFromIndex, planScientificTask, planScientificTaskFromIndex };
