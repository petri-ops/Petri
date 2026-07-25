'use strict';

/**
 * shared-backend/artifact-interaction.js
 *
 * G0-RS3 — ArtifactInteractionManifest v1。
 *
 * 职责：声明一个 artifact **能被怎样选择**，以及选择用什么标识去表达。
 *
 * 为什么需要它：RS2 的 SelectionContext 能存 entityIds，但没有任何东西回答
 * "这些 ID 从哪来、是否稳定"。如果选择落在行号上，重跑一次分析、换一次排序，
 * 同一个"第 27 行"就指向不同基因 —— Agent 会自信地回答错误的实体。
 * 本模块把"标识是否稳定"变成显式、可校验的事实，而不是默认假设。
 *
 * 不变量：
 * - 没有稳定 ID 列时**不假装**有：`idStrategy='positional'`，且选择被标记为不可持久。
 * - 本模块不判定科学有效性，不读写文件，不执行 Job。
 * - 实体 ID 一律按原样保留（不小写化、不去前缀）；生物学 ID 大小写敏感。
 */

const crypto = require('crypto');

const ARTIFACT_INTERACTION_VERSION = 1;

/** 选择标识的来源。`positional` 意味着选择不可跨重算复现。 */
const ID_STRATEGIES = Object.freeze(['declared_column', 'inferred_column', 'positional']);

const INTERACTION_CAPABILITIES = Object.freeze([
  'row_select',
  'column_select',
  'filter',
  'sort',
  'point_select',
  'region_select',
]);

/**
 * 常见稳定标识列名（按优先级）。
 *
 * 只做"候选识别"，最终仍会校验列是否真的唯一；名字像 ID 不等于值唯一。
 */
const ID_FIELD_CANDIDATES = Object.freeze([
  'gene_id', 'geneid', 'ensembl_gene_id', 'ensembl', 'ensembl_id',
  'transcript_id', 'protein_id', 'peptide_id', 'feature_id', 'featureid',
  'entrez_id', 'entrezgene', 'refseq_id', 'uniprot_id',
  'gene_symbol', 'symbol', 'gene_name', 'gene',
  'sample_id', 'sampleid', 'cell_id', 'cellid', 'barcode',
  'probe_id', 'peak_id', 'region_id', 'otu_id', 'taxon_id',
  'id', 'name', 'key',
]);

/** 列名 → 实体类型的保守推断。识别不出就归 `row`，不猜。 */
const ENTITY_TYPE_BY_FIELD = Object.freeze({
  gene_id: 'gene', geneid: 'gene', ensembl_gene_id: 'gene', ensembl: 'gene', ensembl_id: 'gene',
  gene_symbol: 'gene', symbol: 'gene', gene_name: 'gene', gene: 'gene',
  entrez_id: 'gene', entrezgene: 'gene', refseq_id: 'gene',
  transcript_id: 'transcript',
  protein_id: 'protein', peptide_id: 'protein', uniprot_id: 'protein',
  sample_id: 'sample', sampleid: 'sample',
  cell_id: 'cell', cellid: 'cell', barcode: 'cell',
  probe_id: 'probe', peak_id: 'peak', region_id: 'region',
  otu_id: 'taxon', taxon_id: 'taxon',
});

const MAX_SUMMARY_SAMPLE_IDS = 12;

class ArtifactInteractionError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ArtifactInteractionError';
    this.code = code;
    this.detail = detail;
  }
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function trimmed(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeFieldKey(field) {
  // 仅用于**匹配候选名**，不改变实际列名。
  return trimmed(field).toLowerCase().replace(/[\s.-]+/g, '_');
}

/**
 * 判断某列在给定行集合中是否可作唯一标识。
 *
 * @returns {{ unique: boolean, filled: boolean, distinctCount: number, rowCount: number }}
 */
function assessFieldUniqueness(rows, field) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  let filled = 0;
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const raw = row[field];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    filled += 1;
    seen.add(String(raw));
  }
  return {
    unique: list.length > 0 && filled === list.length && seen.size === list.length,
    filled: list.length > 0 && filled === list.length,
    distinctCount: seen.size,
    rowCount: list.length,
  };
}

/**
 * 选出稳定 ID 列。
 *
 * 优先用调用方声明的列；否则在候选名里找一个**实测唯一**的列；
 * 都不成立则回退 positional 并附诊断。
 *
 * @param {{ columns?: string[], rows?: object[], declaredIdField?: string|null }} input
 */
function resolveEntityIdField(input = {}) {
  const columns = Array.isArray(input.columns) ? input.columns.map((c) => trimmed(c)).filter(Boolean) : [];
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const declared = trimmed(input.declaredIdField);

  if (declared) {
    if (!columns.includes(declared)) {
      return {
        idField: null,
        idStrategy: 'positional',
        diagnostics: [{
          code: 'declared_id_field_missing',
          message: `Declared id field is not present in columns: ${declared}`,
        }],
      };
    }
    const check = assessFieldUniqueness(rows, declared);
    // 行样本为空时信任声明；有样本且不唯一则必须拒绝，否则会产出错误的实体映射。
    if (rows.length > 0 && !check.unique) {
      return {
        idField: null,
        idStrategy: 'positional',
        diagnostics: [{
          code: 'declared_id_field_not_unique',
          message: `Declared id field is not unique across sampled rows: ${declared}`,
          detail: check,
        }],
      };
    }
    return { idField: declared, idStrategy: 'declared_column', diagnostics: [] };
  }

  const byNormalized = new Map();
  for (const column of columns) byNormalized.set(normalizeFieldKey(column), column);
  for (const candidate of ID_FIELD_CANDIDATES) {
    const actual = byNormalized.get(candidate);
    if (!actual) continue;
    if (rows.length === 0) {
      // 无行样本 → 只能算推断，且明确告知未经唯一性验证。
      return {
        idField: actual,
        idStrategy: 'inferred_column',
        diagnostics: [{ code: 'id_uniqueness_unverified', message: `No sampled rows to verify uniqueness of ${actual}.` }],
      };
    }
    if (assessFieldUniqueness(rows, actual).unique) {
      return { idField: actual, idStrategy: 'inferred_column', diagnostics: [] };
    }
  }

  return {
    idField: null,
    idStrategy: 'positional',
    diagnostics: [{
      code: 'no_stable_id_field',
      message: 'No stable identifier column found; selections on this artifact are positional and cannot survive recomputation.',
    }],
  };
}

function inferEntityType(idField) {
  if (!idField) return 'row';
  return ENTITY_TYPE_BY_FIELD[normalizeFieldKey(idField)] || 'row';
}

/**
 * 构建表格类 artifact 的交互清单。
 *
 * @param {{ artifactId: string, revisionId?: string|null, columns?: string[], rows?: object[],
 *           rowCount?: number|null, declaredIdField?: string|null, declaredEntityType?: string|null }} input
 */
function buildTableInteractionManifest(input = {}) {
  const artifactId = trimmed(input.artifactId);
  if (!artifactId) throw new ArtifactInteractionError('artifact_id_required', 'artifactId is required.');

  const columns = Array.isArray(input.columns) ? input.columns.map((c) => trimmed(c)).filter(Boolean) : [];
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const resolved = resolveEntityIdField({
    columns,
    rows,
    declaredIdField: input.declaredIdField,
  });
  const entityType = trimmed(input.declaredEntityType) || inferEntityType(resolved.idField);

  // rowCount 可能远大于样本行数（10 万行表只抽样前 N 行做推断）。
  const sampledRowCount = rows.length;
  const totalRowCount = Number.isInteger(input.rowCount) && input.rowCount >= 0
    ? input.rowCount
    : sampledRowCount;

  const capabilities = ['column_select', 'sort', 'filter'];
  if (resolved.idStrategy !== 'positional') capabilities.unshift('row_select');

  return {
    interactionVersion: ARTIFACT_INTERACTION_VERSION,
    artifactId,
    revisionId: trimmed(input.revisionId) || null,
    artifactKind: 'table',
    entityType,
    idField: resolved.idField,
    idStrategy: resolved.idStrategy,
    // 选择是否能跨重算/重排复现。positional 一律 false。
    selectionDurable: resolved.idStrategy !== 'positional',
    columns: columns.map((field) => ({ field, sortable: true, filterable: true })),
    totalRowCount,
    sampledRowCount,
    capabilities,
    diagnostics: resolved.diagnostics,
  };
}

/**
 * 构建图形类 artifact 的交互清单。
 *
 * 图形的稳定性取决于底层数据是否带 ID：只有点能映射回实体 ID 时才允许 point_select
 * 产出持久选择；否则只能表达区域（坐标区间），且标记为不可持久。
 */
function buildPlotInteractionManifest(input = {}) {
  const artifactId = trimmed(input.artifactId);
  if (!artifactId) throw new ArtifactInteractionError('artifact_id_required', 'artifactId is required.');

  const idField = trimmed(input.declaredIdField) || null;
  const hasEntityMapping = !!idField;
  const axes = input.axes && typeof input.axes === 'object' ? input.axes : {};

  const capabilities = ['region_select'];
  if (hasEntityMapping) capabilities.unshift('point_select');

  return {
    interactionVersion: ARTIFACT_INTERACTION_VERSION,
    artifactId,
    revisionId: trimmed(input.revisionId) || null,
    artifactKind: 'plot',
    entityType: trimmed(input.declaredEntityType) || inferEntityType(idField),
    idField,
    idStrategy: hasEntityMapping ? 'declared_column' : 'positional',
    selectionDurable: hasEntityMapping,
    // 区域选择用数据坐标表达；像素坐标会随画布尺寸漂移，不作为持久表达。
    coordinateSpace: 'data',
    axes: {
      x: trimmed(axes.x) || null,
      y: trimmed(axes.y) || null,
    },
    capabilities,
    diagnostics: hasEntityMapping ? [] : [{
      code: 'plot_without_entity_mapping',
      message: 'Plot has no entity id mapping; only coordinate regions can be expressed and they are not durable.',
    }],
  };
}

function validateArtifactInteractionManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: [{ code: 'manifest_invalid', message: 'Manifest must be an object.' }] };
  }
  if (manifest.interactionVersion !== ARTIFACT_INTERACTION_VERSION) {
    errors.push({ code: 'interaction_version_unsupported', message: 'Unsupported interactionVersion.' });
  }
  if (!trimmed(manifest.artifactId)) {
    errors.push({ code: 'artifact_id_required', message: 'artifactId is required.' });
  }
  if (!ID_STRATEGIES.includes(manifest.idStrategy)) {
    errors.push({ code: 'id_strategy_invalid', message: `idStrategy must be one of: ${ID_STRATEGIES.join(', ')}.` });
  }
  if (manifest.idStrategy === 'positional' && manifest.selectionDurable === true) {
    // 这是最危险的自相矛盾：声称可持久但标识是行号。
    errors.push({
      code: 'positional_selection_cannot_be_durable',
      message: 'A positional manifest must not claim selectionDurable=true.',
    });
  }
  if (manifest.idStrategy !== 'positional' && !trimmed(manifest.idField)) {
    errors.push({ code: 'id_field_required', message: 'A non-positional manifest requires idField.' });
  }
  for (const capability of Array.isArray(manifest.capabilities) ? manifest.capabilities : []) {
    if (!INTERACTION_CAPABILITIES.includes(capability)) {
      errors.push({ code: 'capability_unknown', message: `Unknown capability: ${capability}` });
    }
  }
  if (manifest.idStrategy === 'positional'
    && Array.isArray(manifest.capabilities)
    && manifest.capabilities.includes('row_select')) {
    errors.push({
      code: 'positional_row_select_forbidden',
      message: 'row_select requires a stable id field; positional artifacts must not offer it.',
    });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 把表格行选择解析成稳定实体 ID。
 *
 * 关键点：接受的是**行对象**而不是行号。调用方（UI）必须把选中的行数据传进来，
 * 这样即使表格被重排，映射结果也不变。
 *
 * @param {{ manifest: object, selectedRows: object[] }} input
 * @returns {{ entityType: string, entityIds: string[], durable: boolean, skipped: number, diagnostics: Array }}
 */
function resolveSelectedEntityIds(input = {}) {
  const { manifest } = input;
  if (!manifest) throw new ArtifactInteractionError('manifest_required', 'manifest is required.');
  const selectedRows = Array.isArray(input.selectedRows) ? input.selectedRows : [];

  if (manifest.idStrategy === 'positional' || !manifest.idField) {
    return {
      entityType: manifest.entityType || 'row',
      entityIds: [],
      durable: false,
      skipped: selectedRows.length,
      diagnostics: [{
        code: 'selection_not_durable',
        message: 'Artifact has no stable id field; row selection cannot be expressed as entity ids.',
      }],
    };
  }

  const entityIds = [];
  const seen = new Set();
  let skipped = 0;
  for (const row of selectedRows) {
    if (!row || typeof row !== 'object') { skipped += 1; continue; }
    const raw = row[manifest.idField];
    const value = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!value) { skipped += 1; continue; }
    if (seen.has(value)) continue;
    seen.add(value);
    entityIds.push(value);
  }

  return {
    entityType: manifest.entityType || 'row',
    entityIds,
    durable: true,
    skipped,
    diagnostics: skipped > 0
      ? [{ code: 'rows_without_id_skipped', message: `${skipped} selected row(s) had no usable id value.` }]
      : [],
  };
}

/**
 * 把"用 query 表达的选择"规范化。
 *
 * 10 万行表格不可能把全部 ID 塞进上下文；此时选择的**权威表达是 filter**，
 * entityIds 只是可选的抽样证据。
 *
 * @param {{ manifest: object, filter: object, matchedCount: number, sampleEntityIds?: string[] }} input
 */
function buildQuerySelection(input = {}) {
  const { manifest } = input;
  if (!manifest) throw new ArtifactInteractionError('manifest_required', 'manifest is required.');
  const filter = input.filter && typeof input.filter === 'object' ? input.filter : null;
  if (!filter) {
    throw new ArtifactInteractionError('filter_required', 'A query selection requires a filter expression.');
  }
  const matchedCount = Number.isInteger(input.matchedCount) && input.matchedCount >= 0 ? input.matchedCount : 0;
  const sampleEntityIds = Array.isArray(input.sampleEntityIds)
    ? [...new Set(input.sampleEntityIds.map((id) => String(id).trim()).filter(Boolean))]
    : [];

  return {
    interactionVersion: ARTIFACT_INTERACTION_VERSION,
    artifactId: manifest.artifactId,
    revisionId: manifest.revisionId || null,
    entityType: manifest.entityType || 'row',
    // 权威表达：filter + hash。重算后重放 filter 即可得到等价选择。
    selectionMode: 'query',
    filterExpression: filter,
    filterHash: sha256Hex(JSON.stringify(sortedValue(filter))),
    matchedCount,
    sampleEntityIds: sampleEntityIds.slice(0, MAX_SUMMARY_SAMPLE_IDS),
    durable: manifest.selectionDurable === true,
  };
}

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedValue(value[key])]));
}

/**
 * 给 Agent 的有界描述。
 *
 * 永不返回完整 ID 列表；永不把 positional 选择说成稳定选择。
 */
function describeSelectionForAgent(selection, { maxSampleIds = MAX_SUMMARY_SAMPLE_IDS } = {}) {
  if (!selection) return null;
  const ids = Array.isArray(selection.entityIds) ? selection.entityIds : [];
  const sample = Array.isArray(selection.sampleEntityIds) && selection.sampleEntityIds.length > 0
    ? selection.sampleEntityIds
    : ids;
  const total = Number.isInteger(selection.entityIdCount)
    ? selection.entityIdCount
    : (Number.isInteger(selection.matchedCount) ? selection.matchedCount : ids.length);

  return {
    artifactId: selection.artifactId || null,
    revisionId: selection.revisionId || null,
    entityType: selection.entityType || 'row',
    selectionMode: selection.selectionMode || (selection.filterExpression ? 'query' : 'explicit'),
    entityCount: total,
    sampleEntityIds: sample.slice(0, maxSampleIds),
    truncated: total > sample.slice(0, maxSampleIds).length,
    durable: selection.durable === true,
    // 不可持久时必须显式告知，避免 Agent 把行号当成基因身份。
    caveat: selection.durable === true
      ? null
      : 'Selection is positional and may not refer to the same entities after recomputation.',
  };
}

module.exports = {
  ARTIFACT_INTERACTION_VERSION,
  ID_STRATEGIES,
  INTERACTION_CAPABILITIES,
  ID_FIELD_CANDIDATES,
  ArtifactInteractionError,
  assessFieldUniqueness,
  resolveEntityIdField,
  inferEntityType,
  buildTableInteractionManifest,
  buildPlotInteractionManifest,
  validateArtifactInteractionManifest,
  resolveSelectedEntityIds,
  buildQuerySelection,
  describeSelectionForAgent,
};
