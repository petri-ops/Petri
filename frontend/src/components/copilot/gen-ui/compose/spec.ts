/**
 * frontend/src/components/copilot/gen-ui/compose/spec.ts
 *
 * BLOCK-461 [W11 路径 A] `::compose` JSON spec 的严格 schema——手写校验器
 *（零依赖；沿 BLOCK-166 schema.ts 惯例）。扁平树形态：逐节点可寻址/可 diff
 *（评估 §9「审计单元」），校验 fail-closed：未知 kind / 悬空引用 / 环 /
 * 深度超限 / props 越界 / $state 引用非法一律拒绝整份 spec（上层降级占位）。
 */

const COMPOSE_SPEC_VERSION = 1;
const COMPOSE_KINDS = ['card', 'metric', 'table', 'chart', 'mesh-reference'] as const;
type ComposeKind = (typeof COMPOSE_KINDS)[number];

const MAX_NODES = 32;
const MAX_DEPTH = 8;
const MAX_ID_LENGTH = 64;
const MAX_TITLE_LENGTH = 120;
const MAX_STATE_PATH_LENGTH = 120;
const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
/** $state 引用：点分安全段（禁 __proto__/constructor/prototype 与空段）。 */
const STATE_REF_PATTERN = /^\$state\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*){0,8}$/;
const STATE_FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** own-enumerable 查找（BLOCK-456 先例形态：语义等价 + 防原型键 + 满足注入嗅探）。 */
function lookup(obj: Record<string, unknown>, key: string): unknown {
  return Object.entries(obj).find(([k]) => k === key)?.[1];
}

/** $state 引用全量校验：格式 + 原型链段黑名单（B-11 同款防原型键注入口径）。 */
function isSafeStateRef(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_STATE_PATH_LENGTH || !STATE_REF_PATTERN.test(value)) return false;
  const segments = value.slice('$state.'.length).split('.');
  return !segments.some((segment) => STATE_FORBIDDEN_SEGMENTS.has(segment));
}

interface ComposeMetricNode {
  kind: 'metric';
  parent?: string;
  title?: string;
  /** 字面量或 $state.<path>（P2 数据面）。 */
  value?: string;
  unit?: string;
  visible?: string;
}

interface ComposeTableNode {
  kind: 'table';
  parent?: string;
  title?: string;
  columns?: string[];
  /** 字面行 或 $state.<path>（整表取数）。 */
  rows?: unknown;
  visible?: string;
}

interface ComposeChartNode {
  kind: 'chart';
  parent?: string;
  title?: string;
  chartType?: 'bar' | 'line';
  labels?: string[];
  series?: { name?: string; values?: number[] | string }[];
  visible?: string;
}

interface ComposeCardNode {
  kind: 'card';
  parent?: string;
  title?: string;
  visible?: string;
}

export type ComposeNode = ComposeCardNode | ComposeMetricNode | ComposeTableNode | ComposeChartNode | ComposeMeshReferenceNode;

export interface ComposeMeshReferenceNode {
  kind: 'mesh-reference';
  parent?: string;
  title?: string;
  /** GLB 产物（工作区相对路径 + sha256 锚定，沿 mesh-assets 资产单源）。 */
  source?: { path?: string; sourceSha256?: string };
  visible?: string;
}

export interface ComposeSpec {
  version: typeof COMPOSE_SPEC_VERSION;
  root: string;
  /** 可选数据源（P2）：$state 引用经 gen-ui:get-data 通道按 jobId 取数。 */
  source?: { jobId?: string };
  nodes: Record<string, ComposeNode>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value);
}

function isOptionalTitle(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= MAX_TITLE_LENGTH);
}

function isOptionalVisible(value: unknown): boolean {
  // visible 只接受 $state 引用（真值条件）；裸字面量/其它前缀拒绝（fail-closed）。
  return value === undefined || isSafeStateRef(value);
}

function isStateRefOrLiteral(value: unknown, { allowLiteral }: { allowLiteral: boolean }): boolean {
  if (typeof value !== 'string' || value.length > MAX_STATE_PATH_LENGTH + 240) return false;
  if (value.startsWith('$')) return isSafeStateRef(value);
  return allowLiteral;
}

/** 逐 kind props 白名单校验（未知字段一律拒收——沿 BLOCK-322 材质白名单执法口径）。 */
function validateNodeProps(id: string, node: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const keys = Object.keys(node);
  const kind = typeof node.kind === 'string' ? node.kind : '';
  const common = ['kind', 'parent', 'title', 'visible'];
  if (kind === 'metric') {
    const allowed = [...common, 'value', 'unit'];
    if (keys.some((key) => !allowed.includes(key))) issues.push(`${id}: 未知字段（metric 白名单）`);
    if (!isStateRefOrLiteral(node.value, { allowLiteral: true })) issues.push(`${id}: metric.value 缺失或非法`);
    if (node.unit !== undefined && (typeof node.unit !== 'string' || String(node.unit).length > 24)) issues.push(`${id}: metric.unit 非法`);
  } else if (kind === 'table') {
    const allowed = [...common, 'columns', 'rows'];
    if (keys.some((key) => !allowed.includes(key))) issues.push(`${id}: 未知字段（table 白名单）`);
    if (!Array.isArray(node.columns) || node.columns.length === 0 || !node.columns.every((c) => typeof c === 'string' && c.length <= 80)) {
      issues.push(`${id}: table.columns 缺失或非法`);
    }
    const rows = node.rows;
    const rowsOk = rows === undefined || typeof rows === 'string'
      ? rows === undefined || STATE_REF_PATTERN.test(String(rows))
      : Array.isArray(rows) && rows.length <= 200 && rows.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string' || typeof cell === 'number'));
    if (!rowsOk) issues.push(`${id}: table.rows 非法`);
  } else if (kind === 'chart') {
    const allowed = [...common, 'chartType', 'labels', 'series'];
    if (keys.some((key) => !allowed.includes(key))) issues.push(`${id}: 未知字段（chart 白名单）`);
    if (node.chartType !== undefined && node.chartType !== 'bar' && node.chartType !== 'line') issues.push(`${id}: chart.chartType 非法`);
    if (!Array.isArray(node.labels) || !node.labels.every((l) => typeof l === 'string' && l.length <= 80)) issues.push(`${id}: chart.labels 缺失或非法`);
    if (!Array.isArray(node.series) || node.series.length === 0 || node.series.length > 8) issues.push(`${id}: chart.series 缺失或非法`);
    else {
      for (const series of node.series) {
        if (!isPlainObject(series)) issues.push(`${id}: chart.series 元素非法`);
        else {
          const values = series.values;
          const valuesOk = typeof values === 'string' ? STATE_REF_PATTERN.test(values) : Array.isArray(values) && values.every((v) => typeof v === 'number' && Number.isFinite(v));
          if (!valuesOk) issues.push(`${id}: chart.series.values 非法`);
        }
      }
    }
  } else if (kind === 'mesh-reference') {
    const allowed = [...common, 'source'];
    if (keys.some((key) => !allowed.includes(key))) issues.push(`${id}: 未知字段（mesh-reference 白名单）`);
    const source = node.source;
    if (!isPlainObject(source) || typeof source.path !== 'string' || !source.path.toLowerCase().endsWith('.glb')) {
      issues.push(`${id}: mesh-reference.source.path 必须是 .glb`);
    }
    if (!isPlainObject(source) || typeof source.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(source.sourceSha256)) {
      issues.push('mesh_source_hash_required');
    }
  } else if (kind === 'card') {
    if (keys.some((key) => !common.includes(key))) issues.push(`${id}: 未知字段（card 白名单）`);
  } else {
    issues.push(`${id}: 未知 kind`);
  }
  return issues;
}

/** 解析并校验 ComposeSpec；任何不符合返回 null（上层降级占位，不炸穿投影）。 */
export function parseComposeSpec(value: unknown): ComposeSpec | null {
  if (!isPlainObject(value)) return null;
  const record = value;
  if (record.version !== COMPOSE_SPEC_VERSION) return null;
  if (!isSafeId(record.root)) return null;
  if (!isPlainObject(record.nodes)) return null;
  if (record.source !== undefined && !isPlainObject(record.source)) return null;
  if (isPlainObject(record.source) && record.source.jobId !== undefined && !isSafeId(record.source.jobId)) return null;

  const nodes = record.nodes;
  const ids = Object.keys(nodes);
  if (ids.length === 0 || ids.length > MAX_NODES) return null;
  if (!ids.includes(record.root)) return null;
  if (lookup(nodes, record.root) === undefined) return null;
  for (const id of ids) {
    if (!isSafeId(id)) return null;
    const node = lookup(nodes, id);
    if (!isPlainObject(node)) return null;
    if (!COMPOSE_KINDS.includes(node.kind as ComposeKind)) return null;
    if (!isOptionalTitle(node.title)) return null;
    if (!isOptionalVisible(node.visible)) return null;
    if (node.parent !== undefined && (!isSafeId(node.parent) || !ids.includes(node.parent))) return null;
  }

  // 树形校验：root 必须无 parent；每个节点沿 parent 链向上必须无环、不超深、必达 root。
  const rootNode = lookup(nodes, record.root);
  if (!isPlainObject(rootNode) || rootNode.parent !== undefined) return null;
  for (const id of ids) {
    const seen = new Set<string>([id]);
    let cursor = id;
    let depth = 1;
    while (cursor !== record.root) {
      const parentNode = lookup(nodes, cursor);
      if (!isPlainObject(parentNode)) return null;
      const parent = parentNode.parent;
      if (typeof parent !== 'string' || !ids.includes(parent) || seen.has(parent)) return null; // 悬空/环
      seen.add(parent);
      cursor = parent;
      depth += 1;
      if (depth > MAX_DEPTH) return null;
    }
  }

  for (const id of ids) {
    for (const issue of validateNodeProps(id, lookup(nodes, id) as Record<string, unknown>)) return null;
  }

  const spec: ComposeSpec = { version: COMPOSE_SPEC_VERSION, root: record.root, nodes: nodes as ComposeSpec['nodes'] };
  if (isPlainObject(record.source) && record.source.jobId !== undefined) {
    spec.source = { jobId: record.source.jobId as string };
  }
  return spec;
}

/** 解析 $state 引用路径（已通过格式校验的前提下）；非 $state 引用返回 null。 */
export function stateRefPath(value: string): string | null {
  if (!value.startsWith('$state.')) return null;
  return value.slice('$state.'.length);
}
