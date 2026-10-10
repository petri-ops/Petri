/**
 * G0-RS3 — ArtifactInteractionManifest 与 SelectionContext 门禁。
 *
 * 覆盖 g0-result-studio-plan.md §14 G0-RS3 的四条验收：
 * 1. 稳定实体 ID，不依赖行号
 * 2. 10 万行表格仍可用 query/hash 表达选择
 * 3. 切换会话和重启后选择可恢复
 * 4. Agent 能准确回答"这些基因"对应的真实 ID
 *
 * 全部为纯函数与临时 SQLite；不访问网络、不读用户数据。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const {
  ARTIFACT_INTERACTION_VERSION,
  ArtifactInteractionError,
  assessFieldUniqueness,
  buildPlotInteractionManifest,
  buildQuerySelection,
  buildTableInteractionManifest,
  describeSelectionForAgent,
  inferEntityType,
  resolveEntityIdField,
  resolveSelectedEntityIds,
  validateArtifactInteractionManifest,
} = require('../core/shared-backend/artifact-interaction');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository');
const { summarizeSelection, validateSelectionContext } = require('../core/shared-backend/result-studio-contracts');

const DEG_COLUMNS = ['gene_id', 'symbol', 'log2FoldChange', 'pvalue', 'padj'];
const DEG_ROWS = [
  { gene_id: 'ENSG00000141510', symbol: 'TP53', log2FoldChange: 2.4, pvalue: 1e-8, padj: 1e-6 },
  { gene_id: 'ENSG00000146648', symbol: 'EGFR', log2FoldChange: -1.8, pvalue: 3e-6, padj: 2e-4 },
  { gene_id: 'ENSG00000012048', symbol: 'BRCA1', log2FoldChange: 1.1, pvalue: 4e-4, padj: 9e-3 },
];

// 收集本文件所有临时目录，统一在「文件级」after 钩子里清理。
// 文件级钩子在所有用例级 after 钩子（含各用例的 db.close / reopened.close）之后运行，
// 从而避免 Windows 上删除仍被打开的 SQLite 文件（EPERM）。
const tempDirs = [];

function makeRepo(context) {
  const root = mkdtempSync(join(tmpdir(), 'petri-rs3-'));
  tempDirs.push(root);
  const db = new Database(join(root, 'rs3.db'));
  // 关闭 makeRepo 自己持有的 DB（用例级 after 钩子）。
  context.after(() => { try { db.close(); } catch { /* already closed */ } });
  ensureResultStudioSchema(db);
  return { db, repo: createResultStudioRepository(db, { ensureSchema: false }), root, dbPath: join(root, 'rs3.db') };
}

test.after(() => {
  for (const root of tempDirs) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // 偶发句柄残留，不阻断测试结论
    }
  }
});

// ---------------------------------------------------------------------------
// 1. 稳定实体 ID，不依赖行号
// ---------------------------------------------------------------------------

test('RS3 resolves a declared id field and keeps it verbatim', () => {
  const resolved = resolveEntityIdField({ columns: DEG_COLUMNS, rows: DEG_ROWS, declaredIdField: 'gene_id' });
  assert.equal(resolved.idField, 'gene_id');
  assert.equal(resolved.idStrategy, 'declared_column');
  assert.deepEqual(resolved.diagnostics, []);
});

test('RS3 infers a stable id column when none is declared', () => {
  const resolved = resolveEntityIdField({ columns: DEG_COLUMNS, rows: DEG_ROWS });
  assert.equal(resolved.idField, 'gene_id');
  assert.equal(resolved.idStrategy, 'inferred_column');
});

test('RS3 rejects a declared id field that is not unique', () => {
  const rows = [
    { gene_id: 'ENSG1', symbol: 'A' },
    { gene_id: 'ENSG1', symbol: 'B' },
  ];
  const resolved = resolveEntityIdField({ columns: ['gene_id', 'symbol'], rows, declaredIdField: 'gene_id' });
  assert.equal(resolved.idField, null);
  assert.equal(resolved.idStrategy, 'positional');
  assert.equal(resolved.diagnostics.some((d) => d.code === 'declared_id_field_not_unique'), true);
});

test('RS3 rejects a declared id field that does not exist', () => {
  const resolved = resolveEntityIdField({ columns: DEG_COLUMNS, rows: DEG_ROWS, declaredIdField: 'missing_col' });
  assert.equal(resolved.idStrategy, 'positional');
  assert.equal(resolved.diagnostics.some((d) => d.code === 'declared_id_field_missing'), true);
});

test('RS3 falls back to positional when no stable column exists', () => {
  const rows = [{ value: 1 }, { value: 2 }];
  const resolved = resolveEntityIdField({ columns: ['value'], rows });
  assert.equal(resolved.idField, null);
  assert.equal(resolved.idStrategy, 'positional');
  assert.equal(resolved.diagnostics.some((d) => d.code === 'no_stable_id_field'), true);
});

test('RS3 does not claim uniqueness it could not verify', () => {
  // 没有行样本 → 只能是 inferred，且必须显式说明未验证。
  const resolved = resolveEntityIdField({ columns: DEG_COLUMNS, rows: [] });
  assert.equal(resolved.idStrategy, 'inferred_column');
  assert.equal(resolved.diagnostics.some((d) => d.code === 'id_uniqueness_unverified'), true);
});

test('RS3 assesses field uniqueness honestly', () => {
  assert.equal(assessFieldUniqueness(DEG_ROWS, 'gene_id').unique, true);
  // 有空值 → 不算 filled，也不算唯一
  const withHole = [...DEG_ROWS, { gene_id: '', symbol: 'X' }];
  assert.equal(assessFieldUniqueness(withHole, 'gene_id').unique, false);
  assert.equal(assessFieldUniqueness([], 'gene_id').unique, false);
});

test('RS3 infers entity types from id column names', () => {
  assert.equal(inferEntityType('gene_id'), 'gene');
  assert.equal(inferEntityType('Ensembl_Gene_ID'), 'gene');
  assert.equal(inferEntityType('barcode'), 'cell');
  assert.equal(inferEntityType('sample_id'), 'sample');
  // 认不出就归 row，不硬猜
  assert.equal(inferEntityType('weird_column'), 'row');
  assert.equal(inferEntityType(null), 'row');
});

// ---------------------------------------------------------------------------
// 2. 交互清单：能力与不变量
// ---------------------------------------------------------------------------

test('RS3 builds a durable table manifest with row selection enabled', () => {
  const manifest = buildTableInteractionManifest({
    artifactId: 'deg_table',
    revisionId: 'rev_1',
    columns: DEG_COLUMNS,
    rows: DEG_ROWS,
    rowCount: 18422,
  });
  assert.equal(manifest.interactionVersion, ARTIFACT_INTERACTION_VERSION);
  assert.equal(manifest.artifactKind, 'table');
  assert.equal(manifest.entityType, 'gene');
  assert.equal(manifest.idField, 'gene_id');
  assert.equal(manifest.selectionDurable, true);
  assert.equal(manifest.capabilities.includes('row_select'), true);
  // 抽样行数与真实行数分开记录，不用样本冒充总量
  assert.equal(manifest.totalRowCount, 18422);
  assert.equal(manifest.sampledRowCount, 3);
  assert.equal(validateArtifactInteractionManifest(manifest).ok, true);
});

test('RS3 withholds row selection from a positional table', () => {
  const manifest = buildTableInteractionManifest({
    artifactId: 'counts_table',
    columns: ['value'],
    rows: [{ value: 1 }, { value: 2 }],
  });
  assert.equal(manifest.idStrategy, 'positional');
  assert.equal(manifest.selectionDurable, false);
  assert.equal(manifest.capabilities.includes('row_select'), false);
  // 过滤与排序仍可用：它们不产生跨重算的实体断言
  assert.equal(manifest.capabilities.includes('filter'), true);
  assert.equal(validateArtifactInteractionManifest(manifest).ok, true);
});

test('RS3 plot manifest allows point selection only with an entity mapping', () => {
  const mapped = buildPlotInteractionManifest({
    artifactId: 'volcano_plot',
    declaredIdField: 'gene_id',
    axes: { x: 'log2FoldChange', y: 'padj' },
  });
  assert.equal(mapped.selectionDurable, true);
  assert.equal(mapped.capabilities.includes('point_select'), true);
  assert.equal(mapped.coordinateSpace, 'data');

  const unmapped = buildPlotInteractionManifest({ artifactId: 'heatmap_plot' });
  assert.equal(unmapped.selectionDurable, false);
  assert.equal(unmapped.capabilities.includes('point_select'), false);
  assert.equal(unmapped.capabilities.includes('region_select'), false);
  assert.deepEqual(unmapped.capabilities, []);
  assert.equal(unmapped.diagnostics.some((d) => d.code === 'plot_without_entity_mapping'), true);
});

test('RS3 validator rejects a manifest that claims durability without stable ids', () => {
  const lying = {
    interactionVersion: ARTIFACT_INTERACTION_VERSION,
    artifactId: 'x',
    idStrategy: 'positional',
    selectionDurable: true,
    capabilities: ['row_select'],
  };
  const result = validateArtifactInteractionManifest(lying);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((e) => e.code === 'positional_selection_cannot_be_durable'), true);
  assert.equal(result.errors.some((e) => e.code === 'positional_row_select_forbidden'), true);
});

test('RS3 manifest build requires an artifact id', () => {
  assert.throws(
    () => buildTableInteractionManifest({ columns: DEG_COLUMNS }),
    (error) => error instanceof ArtifactInteractionError && error.code === 'artifact_id_required'
  );
});

// ---------------------------------------------------------------------------
// 3. 行选择 → 稳定实体 ID（不依赖行号）
// ---------------------------------------------------------------------------

test('RS3 maps selected rows to stable entity ids regardless of order', () => {
  const manifest = buildTableInteractionManifest({
    artifactId: 'deg_table',
    columns: DEG_COLUMNS,
    rows: DEG_ROWS,
  });
  const forward = resolveSelectedEntityIds({ manifest, selectedRows: [DEG_ROWS[0], DEG_ROWS[2]] });
  assert.equal(forward.durable, true);
  assert.equal(forward.entityType, 'gene');
  assert.deepEqual(forward.entityIds, ['ENSG00000141510', 'ENSG00000012048']);

  // 表格重排后选择同样的两行 → 同样的实体 ID
  const reordered = resolveSelectedEntityIds({ manifest, selectedRows: [DEG_ROWS[2], DEG_ROWS[0]] });
  assert.deepEqual([...reordered.entityIds].sort(), [...forward.entityIds].sort());
});

test('RS3 refuses to fabricate entity ids for a positional artifact', () => {
  const manifest = buildTableInteractionManifest({
    artifactId: 'counts_table',
    columns: ['value'],
    rows: [{ value: 1 }, { value: 2 }],
  });
  const resolved = resolveSelectedEntityIds({ manifest, selectedRows: [{ value: 1 }] });
  assert.equal(resolved.durable, false);
  assert.deepEqual(resolved.entityIds, []);
  assert.equal(resolved.skipped, 1);
  assert.equal(resolved.diagnostics.some((d) => d.code === 'selection_not_durable'), true);
});

test('RS3 skips rows without a usable id value and reports how many', () => {
  const manifest = buildTableInteractionManifest({
    artifactId: 'deg_table',
    columns: DEG_COLUMNS,
    rows: DEG_ROWS,
  });
  const resolved = resolveSelectedEntityIds({
    manifest,
    selectedRows: [DEG_ROWS[0], { symbol: 'NO_ID' }, null],
  });
  assert.deepEqual(resolved.entityIds, ['ENSG00000141510']);
  assert.equal(resolved.skipped, 2);
  assert.equal(resolved.diagnostics.some((d) => d.code === 'rows_without_id_skipped'), true);
});

test('RS3 deduplicates repeated row selections', () => {
  const manifest = buildTableInteractionManifest({
    artifactId: 'deg_table',
    columns: DEG_COLUMNS,
    rows: DEG_ROWS,
  });
  const resolved = resolveSelectedEntityIds({ manifest, selectedRows: [DEG_ROWS[0], DEG_ROWS[0]] });
  assert.deepEqual(resolved.entityIds, ['ENSG00000141510']);
});

// ---------------------------------------------------------------------------
// 4. 10 万行：query/hash 表达
// ---------------------------------------------------------------------------

test('RS3 expresses a 100k row selection as a filter plus hash, not an id dump', () => {
  const manifest = buildTableInteractionManifest({
    artifactId: 'deg_table',
    revisionId: 'rev_1',
    columns: DEG_COLUMNS,
    rows: DEG_ROWS,
    rowCount: 100000,
  });
  const filter = { op: 'and', clauses: [{ field: 'padj', op: 'lt', value: 0.05 }] };
  const selection = buildQuerySelection({
    manifest,
    filter,
    matchedCount: 27431,
    sampleEntityIds: DEG_ROWS.map((row) => row.gene_id),
  });
  assert.equal(selection.selectionMode, 'query');
  assert.equal(selection.matchedCount, 27431);
  assert.match(selection.filterHash, /^[a-f0-9]{64}$/);
  // 权威表达是 filter；样本 ID 有界
  assert.equal(selection.sampleEntityIds.length <= 12, true);
  assert.equal(JSON.stringify(selection).length < 4000, true);
});

test('RS3 filter hash is order independent but value sensitive', () => {
  const manifest = buildTableInteractionManifest({ artifactId: 'deg_table', columns: DEG_COLUMNS, rows: DEG_ROWS });
  const a = buildQuerySelection({ manifest, filter: { field: 'padj', op: 'lt', value: 0.05 }, matchedCount: 10 });
  const b = buildQuerySelection({ manifest, filter: { op: 'lt', value: 0.05, field: 'padj' }, matchedCount: 10 });
  const c = buildQuerySelection({ manifest, filter: { field: 'padj', op: 'lt', value: 0.01 }, matchedCount: 10 });
  assert.equal(a.filterHash, b.filterHash, 'key order must not change the hash');
  assert.notEqual(a.filterHash, c.filterHash, 'threshold change must change the hash');
});

test('RS3 query selection requires a filter expression', () => {
  const manifest = buildTableInteractionManifest({ artifactId: 'deg_table', columns: DEG_COLUMNS, rows: DEG_ROWS });
  assert.throws(
    () => buildQuerySelection({ manifest, matchedCount: 5 }),
    (error) => error instanceof ArtifactInteractionError && error.code === 'filter_required'
  );
});

// ---------------------------------------------------------------------------
// 5. Agent 描述：有界且不说谎
// ---------------------------------------------------------------------------

test('RS3 agent description stays bounded and never dumps all ids', () => {
  const manifest = buildTableInteractionManifest({
    artifactId: 'deg_table',
    columns: DEG_COLUMNS,
    rows: DEG_ROWS,
    rowCount: 100000,
  });
  const selection = buildQuerySelection({
    manifest,
    filter: { field: 'padj', op: 'lt', value: 0.05 },
    matchedCount: 27431,
    sampleEntityIds: Array.from({ length: 500 }, (_, i) => `ENSG${i}`),
  });
  const described = describeSelectionForAgent(selection);
  assert.equal(described.entityCount, 27431);
  assert.equal(described.sampleEntityIds.length, 12);
  assert.equal(described.truncated, true);
  assert.equal(described.durable, true);
  assert.equal(described.caveat, null);
  assert.equal(JSON.stringify(described).length < 1500, true);
});

test('RS3 agent description carries a caveat for positional selections', () => {
  const described = describeSelectionForAgent({
    artifactId: 'counts_table',
    entityType: 'row',
    entityIds: ['1', '2'],
    durable: false,
  });
  assert.equal(described.durable, false);
  assert.match(described.caveat, /positional/i);
});

test('RS3 agent can answer which real ids "these genes" means', () => {
  const manifest = buildTableInteractionManifest({
    artifactId: 'deg_table',
    columns: DEG_COLUMNS,
    rows: DEG_ROWS,
  });
  const resolved = resolveSelectedEntityIds({ manifest, selectedRows: [DEG_ROWS[0], DEG_ROWS[1]] });
  const described = describeSelectionForAgent({
    artifactId: manifest.artifactId,
    entityType: resolved.entityType,
    entityIds: resolved.entityIds,
    durable: resolved.durable,
  });
  assert.equal(described.entityType, 'gene');
  assert.equal(described.entityCount, 2);
  assert.deepEqual(described.sampleEntityIds, ['ENSG00000141510', 'ENSG00000146648']);
  assert.equal(described.truncated, false);
});

// ---------------------------------------------------------------------------
// 6. 持久化与恢复（跨会话、跨重启）
// ---------------------------------------------------------------------------

test('RS3 persists an interaction-derived selection and restores it after reopen', (context) => {
  const { repo, db, dbPath } = makeRepo(context);
  const manifest = buildTableInteractionManifest({
    artifactId: 'deg_table',
    revisionId: 'rev_1',
    columns: DEG_COLUMNS,
    rows: DEG_ROWS,
  });
  const resolved = resolveSelectedEntityIds({ manifest, selectedRows: [DEG_ROWS[0], DEG_ROWS[1]] });

  repo.saveSelection({
    selectionId: 'sel_rs3',
    projectId: 'project_1',
    conversationId: 'conv_1',
    artifactId: manifest.artifactId,
    revisionId: manifest.revisionId,
    entityType: resolved.entityType,
    entityIds: resolved.entityIds,
  });
  db.close();

  // 模拟应用重启
  const reopened = new Database(dbPath);
  context.after(() => { try { reopened.close(); } catch { /* noop */ } });
  const repoB = createResultStudioRepository(reopened, { ensureSchema: false });
  const restored = repoB.getSelection('sel_rs3');
  assert.equal(restored.entityType, 'gene');
  assert.deepEqual(restored.entityIds, ['ENSG00000141510', 'ENSG00000146648']);
  assert.equal(restored.revisionId, 'rev_1');
  assert.match(restored.entityIdsHash, /^[a-f0-9]{64}$/);
});

test('RS3 keeps selections separated per conversation', (context) => {
  const { repo } = makeRepo(context);
  const base = {
    projectId: 'project_1',
    artifactId: 'deg_table',
    entityType: 'gene',
  };
  repo.saveSelection({ ...base, selectionId: 'sel_a', conversationId: 'conv_a', entityIds: ['TP53'] });
  repo.saveSelection({ ...base, selectionId: 'sel_b', conversationId: 'conv_b', entityIds: ['EGFR'] });
  assert.deepEqual(repo.getSelection('sel_a').entityIds, ['TP53']);
  assert.deepEqual(repo.getSelection('sel_b').entityIds, ['EGFR']);
});

test('RS3 a huge persisted selection keeps the filter as authoritative expression', (context) => {
  const { repo } = makeRepo(context);
  const manifest = buildTableInteractionManifest({
    artifactId: 'deg_table',
    columns: DEG_COLUMNS,
    rows: DEG_ROWS,
    rowCount: 100000,
  });
  const query = buildQuerySelection({
    manifest,
    filter: { field: 'padj', op: 'lt', value: 0.05 },
    matchedCount: 27431,
  });
  const huge = Array.from({ length: 27431 }, (_, i) => `ENSG${i}`);

  const validated = validateSelectionContext({
    selectionId: 'sel_huge',
    projectId: 'project_1',
    artifactId: manifest.artifactId,
    entityType: manifest.entityType,
    entityIds: huge,
    filterExpression: query.filterExpression,
  });
  assert.equal(validated.ok, true, JSON.stringify(validated.errors));

  const saved = repo.saveSelection({
    selectionId: 'sel_huge',
    projectId: 'project_1',
    artifactId: manifest.artifactId,
    entityType: manifest.entityType,
    entityIds: huge,
    filterExpression: query.filterExpression,
  });
  // 真实规模不因截断而说谎
  assert.equal(saved.entityIdCount, 27431);
  assert.equal(saved.entityIdsTruncated, true);
  assert.equal(saved.entityIds.length < 27431, true);
  assert.equal(saved.filterExpression.field, 'padj');

  const summary = summarizeSelection(saved);
  assert.equal(summary.entityIdCount, 27431);
  assert.equal(summary.truncated, true);
  assert.equal(summary.hasFilter, true);
});
