import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  HARNESS_TASK_PACK_VERSION,
  HARNESS_TASK_PACKS,
  selectHarnessTaskPack,
} from '../scripts/harness-task-packs.mjs';
import {
  createHarnessWorkflowPlan,
  rankHarnessToolsForRequest,
} from '../scripts/harness-file-index.mjs';

const STEP_MANIFESTS = [
  ['deseq2', 'DESeq2 差异表达分析'],
  ['go-kegg', 'GO KEGG 富集与通路分析'],
  ['gsea', 'GSEA 基因集富集分析'],
  ['seurat-standard', 'Seurat 单细胞标准流程与聚类'],
  ['ml-scvi-annotate', 'scVI 细胞类型注释'],
  ['mo-mofa', 'MOFA 多组学整合'],
  ['mo-snf', 'SNF 多组学整合'],
  ['km-survival', 'Kaplan Meier 生存分析'],
  ['cellchat', 'CellChat 配体受体细胞通讯'],
  ['maftools-mutation', 'maftools 突变景观分析'],
  ['spatial-standard', '空间转录组标准分析'],
  ['volcano-plot', '差异分析结果火山图'],
  ['pca-explorer', 'PCA 主成分降维'],
  ['gene-correlation', '基因相关性共表达热图'],
].map(([id, description]) => ({ id, title: description, description, inputs: [], outputs: [] }));

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'harness-weak-model-cases.json'),
    'utf8',
  ),
);

test('task packs are versioned, unique and only describe selection strategy', () => {
  assert.equal(HARNESS_TASK_PACK_VERSION, 1);
  assert.equal(new Set(HARNESS_TASK_PACKS.map((pack) => pack.id)).size, HARNESS_TASK_PACKS.length);
  for (const pack of HARNESS_TASK_PACKS) {
    assert.ok(pack.toolIds.length > 0);
    assert.ok(pack.patterns.length > 0);
    assert.equal('execute' in pack, false);
    assert.equal('script' in pack, false);
  }
});

test('workflow plan deterministically selects a tool without an LLM', () => {
  const plan = createHarnessWorkflowPlan({
    requestText: '用 MOFA 做多组学整合',
    manifests: STEP_MANIFESTS,
    index: { entries: [] },
    params: {},
  });
  assert.equal(plan.toolId, 'mo-mofa');
  assert.equal(plan.stages.find((stage) => stage.id === 'select')?.status, 'completed');
});

test('workflow plan blocks an unknown request instead of guessing a tool', () => {
  const plan = createHarnessWorkflowPlan({
    requestText: '总结当前项目进度',
    manifests: [],
    index: { entries: [] },
  });
  assert.equal(plan.toolId, null);
  assert.equal(plan.readiness, 'blocked');
});

for (const [request, packId, toolId] of fixtures.selection) {
  test(`weak-model selection: ${packId}`, () => {
    assert.equal(selectHarnessTaskPack(request)?.id, packId);
    const ranked = rankHarnessToolsForRequest(request, STEP_MANIFESTS, {}, { minRequiredBindings: false });
    assert.equal(ranked[0]?.toolId, toolId);
    assert.ok(ranked[0]?.reasons.includes(`task_pack_${packId}`));
  });
}

for (const request of fixtures.unknown) {
  test(`unknown request does not invent a task pack: ${request}`, () => {
    assert.equal(selectHarnessTaskPack(request), null);
  });
}
