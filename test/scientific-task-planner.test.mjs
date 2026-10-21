import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { planScientificTask, planScientificTaskFromIndex, STATUS } = require('../core/shared-backend/scientific-task-planner');

const plugins = [
  { id: 'sample-metadata-validator', title: '样本元数据校验', category: 'bulk RNA-seq', version: '1.0.0', entryPoint: 'scripts/sample-metadata-validator.R', inputs: [{ id: 'counts' }, { id: 'metadata' }] },
  { id: 'expression-qc', title: '表达矩阵质量控制', category: 'bulk RNA-seq', version: '1.0.0', entryPoint: 'scripts/expression-qc.R', inputs: [{ id: 'counts' }] },
  { id: 'deseq2', title: '差异表达分析', category: 'bulk RNA-seq', version: '1.0.0', entryPoint: 'scripts/deseq2.R', inputs: [{ id: 'counts' }, { id: 'metadata' }] },
  { id: 'go-kegg', title: 'GO/KEGG 富集', category: 'bulk RNA-seq', version: '1.0.0', entryPoint: 'scripts/go-kegg.R', inputs: [{ id: 'deg_artifact' }] },
];

// Pack-declared planner rules (BLOCK-234 S5); injected so this leg does not
// depend on an installed domain pack.
const PLANNER_RULES = [
  { toolId: 'sample-metadata-validator', when: { rolesAll: ['counts'] }, rationale: 'metadata first', prerequisites: ['counts', 'metadata', 'contrast'], risks: ['grouping required'], order: 10 },
  { toolId: 'expression-qc', when: { rolesAll: ['counts'] }, rationale: 'qc first', prerequisites: ['counts'], risks: ['no auto drop'], order: 20 },
  {
    toolId: 'deseq2',
    when: {
      rolesAll: ['counts'],
      any: [
        { questionTypes: ['differential_expression'] },
        { methodCategories: ['bulk RNA-seq'] },
        { originalRequest: true },
      ],
    },
    rationale: 'deg',
    prerequisites: ['validated_metadata', 'qc_summary', 'contrast'],
    risks: ['no inference'],
    order: 30,
  },
  { toolId: 'go-kegg', when: { rolesAll: ['counts'] }, rationale: 'downstream', prerequisites: ['verified_upstream_artifact'], risks: ['bind upstream'], order: 100 },
];

function plan(input) {
  return planScientificTask({ ...input, plannerRules: PLANNER_RULES });
}

function planFromIndex(input) {
  return planScientificTaskFromIndex({ ...input, plannerRules: PLANNER_RULES });
}

function spec(overrides = {}) {
  return {
    taskId: 'task_1', projectId: 'project_1', conversationId: 'conv_1',
    originalRequest: '比较处理组和对照组，并解释功能变化。',
    question: { domain: 'bulk RNA-seq', analysisUnit: 'gene', questionType: 'differential_expression' },
    method: { category: 'bulk RNA-seq' },
    inputs: [
      { role: 'counts', relativePath: 'data/counts.csv' },
      { role: 'metadata', relativePath: 'data/metadata.csv' },
    ],
    ...overrides,
  };
}

const evidence = [
  { relativePath: 'data/counts.csv', sha256: 'a'.repeat(64), kind: 'csv', headers: ['gene', 'S1', 'S2'], rows: 100, columns: 3 },
  { relativePath: 'data/metadata.csv', sha256: 'b'.repeat(64), kind: 'csv', headers: ['sample', 'condition'], rows: 2, columns: 2 },
];

test('HRT-2 produces evidence and candidates without creating a Job', () => {
  const result = plan({ taskSpec: spec(), evidence, plugins });
  assert.equal(result.status, STATUS.READY);
  assert.equal(result.execution.createsToolJob, false);
  assert.equal(result.evidence[0].evidenceStatus, 'observed');
  assert.equal(result.recommendation.toolId, 'sample-metadata-validator');
  assert.ok(result.candidates.some((item) => item.toolId === 'deseq2'));
});

test('HRT-2 consumes the bounded harness index shape and preserves hashes', () => {
  const result = planFromIndex({
    taskSpec: spec(),
    index: {
      entries: [
        { relativePath: 'data/counts.csv', size: 100, hash: { sha256: 'a'.repeat(64) }, kind: 'csv', table: { headers: ['gene', 'S1', 'S2'], rowCount: 100, columnCount: 3 } },
        { relativePath: 'data/metadata.csv', size: 40, hash: { sha256: 'b'.repeat(64) }, kind: 'csv', table: { headers: ['sample', 'condition'], rowCount: 2, columnCount: 2 } },
      ],
    },
    manifests: plugins,
  });
  assert.equal(result.status, STATUS.READY);
  assert.equal(result.evidence[0].snapshot.sha256, 'a'.repeat(64));
  assert.equal(result.evidence[1].snapshot.source, 'harness-file-index');
});

test('HRT-2 blocks ambiguous metadata even in trusted mode', () => {
  const result = plan({
    taskSpec: spec({ execution: { automationMode: 'trusted' } }),
    evidence: [evidence[0], { ...evidence[1], headers: ['sample', 'batch'] }],
    plugins,
  });
  assert.equal(result.status, STATUS.CANNOT_ANSWER);
  assert.ok(result.gaps.some((gap) => gap.code === 'contrast_column_missing'));
  assert.equal(result.execution.createsToolJob, false);
});

test('HRT-2 preserves missing-input and unresolved-decision evidence', () => {
  const result = plan({
    taskSpec: spec({ requiresUserDecision: [{ id: 'contrast', question: '哪一组是对照组？', required: true, status: 'unresolved' }] }),
    evidence: [evidence[0]],
    plugins,
  });
  assert.equal(result.status, STATUS.NEEDS_DECISION);
  assert.ok(result.gaps.some((gap) => gap.code === 'input_evidence_missing'));
  assert.ok(result.gaps.some((gap) => gap.code === 'user_decision_required'));
});
