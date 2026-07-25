/**
 * artifact-selection.ts
 *
 * G0-RS3 — 前端选择上下文：把用户在表格/图上的交互变成 Agent 可理解的结构化选择。
 *
 * 契约镜像自 core/shared-backend/artifact-interaction.js 与
 * core/shared-backend/result-studio-contracts.js（SelectionContext v1）。
 * 两侧的字段名与枚举必须一致；后端是权威，本文件不得引入第三套词汇。
 *
 * 核心不变量：
 * - 选择永远基于**稳定实体 ID**（manifest 声明的 idField），不基于行号。
 *   排序、过滤、翻页都会改变行号，用行号表达选择在重开后必然错位。
 * - 超出上限的选择降级为 query 表达（filter + hash），不截断成"一半的真相"。
 * - 交给 Agent 的摘要恒定有界，永不夹带完整 ID 列表。
 */

/** 与后端 SelectionContext v1 的 MAX_PERSISTED_ENTITY_IDS 保持一致。 */
export const MAX_PERSISTED_ENTITY_IDS = 2000;

/** 交给 Agent 的样本 ID 上限。 */
export const MAX_AGENT_SAMPLE_IDS = 12;

export type ArtifactIdStrategy = 'declared_column' | 'inferred_column' | 'positional';

export type InteractionCapability =
  | 'row_select'
  | 'column_select'
  | 'filter'
  | 'sort'
  | 'point_select'
  | 'region_select'
  | 'legend_select';

export type SelectionOrigin = 'row_select' | 'column_select' | 'query' | 'point_select' | 'region_select' | 'legend_select';

export interface ArtifactInteractionColumn {
  field: string;
  sortable?: boolean;
  filterable?: boolean;
  numeric?: boolean;
}

export interface ArtifactInteractionManifest {
  interactionVersion: number;
  artifactId: string;
  revisionId: string | null;
  artifactFamilyId?: string | null;
  artifactKind: string;
  entityType: string;
  idField: string | null;
  idStrategy: ArtifactIdStrategy;
  /** false 表示只能按行号定位，选择不可跨会话恢复。UI 必须如实告知用户。 */
  selectionDurable: boolean;
  columns: ArtifactInteractionColumn[];
  totalRowCount: number;
  sampledRowCount?: number;
  capabilities: InteractionCapability[];
  diagnostics?: Array<{ code: string; message: string }>;
  interactionMode?: 'table' | 'scatter' | 'matrix' | 'read_only';
  mapping?: {
    artifactId: string;
    mode: 'table' | 'scatter' | 'matrix';
    entityType: string;
    dataArtifactId?: string;
    dataFile?: string;
    idField?: string;
    xField?: string;
    yField?: string;
    yTransform?: 'neg_log10';
    legendField?: string;
    rowIdField?: string;
    rowEntityType?: string;
    columnEntityType?: string;
  } | null;
}

export interface SelectionFilterClause {
  field: string;
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'contains';
  value: unknown;
}

export interface SelectionFilterExpression {
  logic: 'and' | 'or';
  clauses: SelectionFilterClause[];
}

export interface SelectionSortSpec {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ArtifactSelection {
  contractVersion: 1;
  artifactId: string;
  revisionId: string | null;
  entityType: string;
  origin: SelectionOrigin;
  /** 稳定实体 ID。超上限时只保留前 MAX_PERSISTED_ENTITY_IDS 个。 */
  entityIds: string[];
  /** 真实规模，永不因截断而说谎。 */
  entityIdCount: number;
  entityIdsTruncated: boolean;
  /** 覆盖**全部** ID 的哈希，截断不影响变更检测。 */
  entityIdsHash: string | null;
  filterHash?: string | null;
  /** 选中的列（column_select）。 */
  fields: string[];
  filterExpression: SelectionFilterExpression | null;
  sort: SelectionSortSpec[];
  /** 图形选择的几何范围，仅 point/region origin 使用。 */
  region: { x0: number; y0: number; x1: number; y1: number } | null;
  /** 选择是否可跨会话恢复。false 时 UI 不得声称"已保存选择"。 */
  durable: boolean;
  createdAt: string;
  selectionId?: string | null;
  compatibility?: 'compatible' | 'stale' | 'invalid';
}

export interface AgentSelectionSummary {
  artifactId: string;
  revisionId: string | null;
  entityType: string;
  origin: SelectionOrigin;
  entityIdCount: number;
  truncated: boolean;
  durable: boolean;
  sampleEntityIds: string[];
  entityIdsHash: string | null;
  fields: string[];
  hasFilter: boolean;
  filterDescription: string | null;
  sort: SelectionSortSpec[];
}

/**
 * FNV-1a 32-bit ×2（不同种子）拼成 64-bit hex。
 *
 * 用途仅为"选择是否变化"的等价性比较，不做安全用途。
 * 浏览器环境没有同步 sha256，crypto.subtle 是异步的；选择变更检测在
 * 渲染路径上必须同步，所以这里用非加密哈希，并在字段名上不冒充 sha256。
 */
function fnv1aHex(input: string, seed: number): string {
  let hash = seed;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    // 32-bit FNV prime 乘法，保持在无符号 32 位
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hashEntityIds(entityIds: string[]): string | null {
  if (entityIds.length === 0) return null;
  // 排序后哈希：选择是集合语义，点选顺序不同不应视为不同选择。
  const canonical = [...entityIds].sort().join('\u0000');
  return `${fnv1aHex(canonical, 0x811c9dc5)}${fnv1aHex(canonical, 0x1000193)}`;
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}

/**
 * 从行对象里取稳定实体 ID。
 *
 * manifest.idField 为空（positional 策略）时返回 null——调用方必须据此
 * 把选择标成 not durable，而不是退回行号伪装成 ID。
 */
export function readEntityId(
  manifest: ArtifactInteractionManifest,
  row: Record<string, unknown> | null | undefined,
): string | null {
  if (!row || !manifest.idField) return null;
  const raw = row[manifest.idField];
  if (raw == null) return null;
  const value = String(raw).trim();
  return value || null;
}

function baseSelection(
  manifest: ArtifactInteractionManifest,
  origin: SelectionOrigin,
  allEntityIds: string[],
): ArtifactSelection {
  const truncated = allEntityIds.length > MAX_PERSISTED_ENTITY_IDS;
  return {
    contractVersion: 1,
    artifactId: manifest.artifactId,
    revisionId: manifest.revisionId ?? null,
    entityType: manifest.entityType,
    origin,
    entityIds: truncated ? allEntityIds.slice(0, MAX_PERSISTED_ENTITY_IDS) : allEntityIds,
    entityIdCount: allEntityIds.length,
    entityIdsTruncated: truncated,
    entityIdsHash: hashEntityIds(allEntityIds),
    fields: [],
    filterExpression: null,
    sort: [],
    region: null,
    durable: manifest.selectionDurable && allEntityIds.length > 0,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 表格行选择。
 *
 * 只接受行对象，不接受行号：行号在排序/过滤后失效。
 * 取不到稳定 ID 的行被丢弃并记入 droppedRowCount，调用方应提示用户
 * 该产物不支持持久选择，而不是静默少选。
 */
export function buildRowSelection(
  manifest: ArtifactInteractionManifest,
  rows: Array<Record<string, unknown>>,
): { selection: ArtifactSelection; droppedRowCount: number } {
  const ids: string[] = [];
  let dropped = 0;
  for (const row of rows) {
    const id = readEntityId(manifest, row);
    if (id) ids.push(id);
    else dropped += 1;
  }
  const unique = uniqueStrings(ids);
  return { selection: baseSelection(manifest, 'row_select', unique), droppedRowCount: dropped };
}

/** 列选择。列本身就是稳定标识，不涉及行号。 */
export function buildColumnSelection(
  manifest: ArtifactInteractionManifest,
  fields: string[],
): ArtifactSelection {
  const known = new Set(manifest.columns.map((column) => column.field));
  const selected = uniqueStrings(fields).filter((field) => known.has(field));
  const selection = baseSelection(manifest, 'column_select', []);
  selection.fields = selected;
  // 列选择不含实体 ID，其可恢复性只取决于列名稳定性。
  selection.durable = selected.length > 0;
  return selection;
}

/**
 * Query 选择：10 万行表格的选择用 filter + hash 表达，不枚举 ID。
 *
 * `matchedEntityIds` 可选；给了就参与 hash 与计数，没给则完全依赖 filter 复现。
 */
export function buildQuerySelection(
  manifest: ArtifactInteractionManifest,
  options: {
    filterExpression: SelectionFilterExpression;
    sort?: SelectionSortSpec[];
    matchedEntityIds?: string[];
    matchedCount?: number;
    entityIdsHash?: string | null;
    filterHash?: string | null;
  },
): ArtifactSelection {
  const matched = uniqueStrings(options.matchedEntityIds || []);
  const selection = baseSelection(manifest, 'query', matched);
  selection.filterExpression = options.filterExpression;
  selection.sort = options.sort ? [...options.sort] : [];
  if (typeof options.matchedCount === 'number' && Number.isFinite(options.matchedCount)) {
    // 后端知道真实命中数时以它为准；前端可能只拿到一页样本。
    selection.entityIdCount = Math.max(options.matchedCount, matched.length);
    selection.entityIdsTruncated = selection.entityIdCount > selection.entityIds.length;
  }
  if (options.entityIdsHash) selection.entityIdsHash = options.entityIdsHash;
  selection.filterHash = options.filterHash || null;
  // query 选择即使超上限也可复现：filter 本身就是复现依据。
  selection.durable = !!selection.entityIdsHash && !!selection.filterHash;
  return selection;
}

/** 图上点选。落在点上的实体必须能映射回稳定 ID。 */
export function buildPointSelection(
  manifest: ArtifactInteractionManifest,
  points: Array<Record<string, unknown>>,
): ArtifactSelection {
  const ids = uniqueStrings(points.map((point) => readEntityId(manifest, point) || ''));
  return baseSelection(manifest, 'point_select', ids);
}

/** 图例选择最终仍解析为稳定实体 ID，不把颜色标签本身冒充科学实体。 */
export function buildLegendSelection(
  manifest: ArtifactInteractionManifest,
  points: Array<Record<string, unknown>>,
): ArtifactSelection {
  const ids = uniqueStrings(points.map((point) => readEntityId(manifest, point) || ''));
  return baseSelection(manifest, 'legend_select', ids);
}

/**
 * 图上框选。
 *
 * 几何范围与命中实体一起保存：范围用于回显框，ID 用于表达科学含义。
 * 只存范围不存 ID 会导致换了坐标轴范围后选择漂移。
 */
export function buildRegionSelection(
  manifest: ArtifactInteractionManifest,
  region: { x0: number; y0: number; x1: number; y1: number },
  matchedPoints: Array<Record<string, unknown>>,
): ArtifactSelection {
  const ids = uniqueStrings(matchedPoints.map((point) => readEntityId(manifest, point) || ''));
  const selection = baseSelection(manifest, 'region_select', ids);
  selection.region = {
    x0: Math.min(region.x0, region.x1),
    y0: Math.min(region.y0, region.y1),
    x1: Math.max(region.x0, region.x1),
    y1: Math.max(region.y0, region.y1),
  };
  return selection;
}

const OP_LABELS: Record<SelectionFilterClause['op'], string> = {
  eq: '=',
  ne: '≠',
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  in: '∈',
  contains: '包含',
};

/** 把 filter 渲染成一句人类可读的说明，用于选择摘要 chip 与 Agent 上下文。 */
export function describeFilter(filter: SelectionFilterExpression | null): string | null {
  if (!filter || filter.clauses.length === 0) return null;
  const joiner = filter.logic === 'or' ? ' 或 ' : ' 且 ';
  return filter.clauses
    .map((clause) => {
      const value = Array.isArray(clause.value)
        ? `[${clause.value.slice(0, 3).join(', ')}${clause.value.length > 3 ? ', …' : ''}]`
        : String(clause.value);
      return `${clause.field}${OP_LABELS[clause.op]}${value}`;
    })
    .join(joiner);
}

/**
 * 交给 Agent 的有界摘要。
 *
 * 恒定有界：无论选了 5 个还是 50 万个实体，摘要体积不变。
 * 永不夹带完整 ID 列表——那会拖慢 UI 并污染 prompt。
 */
export function summarizeSelectionForAgent(
  selection: ArtifactSelection | null,
  options: { maxSampleIds?: number } = {},
): AgentSelectionSummary | null {
  if (!selection) return null;
  const maxSampleIds = options.maxSampleIds ?? MAX_AGENT_SAMPLE_IDS;
  return {
    artifactId: selection.artifactId,
    revisionId: selection.revisionId,
    entityType: selection.entityType,
    origin: selection.origin,
    entityIdCount: selection.entityIdCount,
    truncated: selection.entityIdsTruncated,
    durable: selection.durable,
    sampleEntityIds: selection.entityIds.slice(0, maxSampleIds),
    entityIdsHash: selection.entityIdsHash,
    fields: selection.fields,
    hasFilter: !!selection.filterExpression,
    filterDescription: describeFilter(selection.filterExpression),
    sort: selection.sort,
  };
}

/** UI 上的一句话选择摘要，例如「已选择 27 个 gene · padj<0.05」。 */
export function formatSelectionChip(selection: ArtifactSelection | null): string {
  if (!selection) return '';
  const parts: string[] = [];
  if (selection.entityIdCount > 0) {
    parts.push(`已选择 ${selection.entityIdCount} 个 ${selection.entityType}`);
  } else if (selection.fields.length > 0) {
    parts.push(`已选择 ${selection.fields.length} 列`);
  }
  const filterText = describeFilter(selection.filterExpression);
  if (filterText) parts.push(filterText);
  if (!selection.durable) parts.push('该结果不支持持久选择');
  return parts.join(' · ');
}

/**
 * 选择等价性判断。
 *
 * 用于避免重复写回与重复通知 Agent。比较集合语义而非点击顺序。
 */
export function isSameSelection(
  left: ArtifactSelection | null,
  right: ArtifactSelection | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.artifactId === right.artifactId
    && left.revisionId === right.revisionId
    && left.origin === right.origin
    && left.entityIdCount === right.entityIdCount
    && left.entityIdsHash === right.entityIdsHash
    && left.fields.join(',') === right.fields.join(',')
    && JSON.stringify(left.filterExpression) === JSON.stringify(right.filterExpression)
  );
}

/** 转成后端 SelectionContext v1 的入参形状。字段名与后端校验器一致。 */
export function toPersistPayload(
  selection: ArtifactSelection,
  context: { selectionId: string; projectId: string; conversationId?: string | null },
): Record<string, unknown> {
  return {
    selectionId: context.selectionId,
    projectId: context.projectId,
    conversationId: context.conversationId ?? null,
    artifactId: selection.artifactId,
    revisionId: selection.revisionId,
    entityType: selection.entityType,
    entityIds: selection.entityIds,
    entityIdCount: selection.entityIdCount,
    // 显式小选择由后端重算 SHA-256；query 选择才传权威完整集合摘要。
    entityIdsHash: selection.origin === 'query' ? selection.entityIdsHash : null,
    filterHash: selection.origin === 'query' ? selection.filterHash || null : null,
    filterExpression: selection.filterExpression,
    sort: selection.sort,
    displayState: {
      origin: selection.origin,
      fields: selection.fields,
      region: selection.region,
      durable: selection.durable,
      clientEntityIdsHash: selection.entityIdsHash,
    },
  };
}

/** 从后端返回的 SelectionContext 还原前端选择（重启/切会话恢复路径）。 */
export function fromPersistedSelection(
  persisted: Record<string, unknown> | null | undefined,
): ArtifactSelection | null {
  if (!persisted || typeof persisted !== 'object') return null;
  const display = (persisted.displayState as Record<string, unknown> | null) || null;
  const entityIds = Array.isArray(persisted.entityIds) ? uniqueStrings(persisted.entityIds) : [];
  const rawCount = Number(persisted.entityIdCount);
  const origin = (display?.origin as SelectionOrigin) || 'row_select';
  return {
    contractVersion: 1,
    artifactId: String(persisted.artifactId || ''),
    revisionId: (persisted.revisionId as string) || null,
    entityType: String(persisted.entityType || 'row'),
    origin,
    entityIds,
    entityIdCount: Number.isFinite(rawCount) ? rawCount : entityIds.length,
    entityIdsTruncated: persisted.entityIdsTruncated === true,
    entityIdsHash: typeof persisted.entityIdsHash === 'string'
      ? persisted.entityIdsHash
      : hashEntityIds(entityIds),
    filterHash: typeof persisted.filterHash === 'string' ? persisted.filterHash : null,
    fields: Array.isArray(display?.fields) ? uniqueStrings(display!.fields as unknown[]) : [],
    filterExpression: (persisted.filterExpression as SelectionFilterExpression) || null,
    sort: Array.isArray(persisted.sort) ? (persisted.sort as SelectionSortSpec[]) : [],
    region: (display?.region as ArtifactSelection['region']) || null,
    durable: display?.durable === undefined ? true : display.durable === true,
    createdAt: String(persisted.createdAt || new Date().toISOString()),
    selectionId: typeof persisted.selectionId === 'string' ? persisted.selectionId : null,
  };
}
