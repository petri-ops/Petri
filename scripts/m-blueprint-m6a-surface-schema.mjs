#!/usr/bin/env node
/**
 * M6-A / BLOCK-435 — 三矩阵共用 schema 生成器 + 漂移棘轮。
 *
 * 背景（蓝图 M-70 / G-06 done-partial）：functional surface matrix、capability map、
 * IPC 三真相各自维护口径，字段与计数靠人抄，漂移只能靠事后对账发现。
 * 本生成器把三面（ipc / tool / route）收敛为**一份身份 schema**：
 *
 *   entry = { kind, id, scope, exposed, consumed, riskTier? }
 *
 * 并以「真相源」为基准计算漂移：
 *   - ipc  ：唯一注册表 src/ipc/channels.js ↔ matrix.ipcRows
 *   - tool ：工具 schema facade tool-defs.TOOL_DEFS ↔ matrix.toolRows
 *   - route：matrix.routeRows.module 必须能解析到 routes/<module>.js 或 <module>/index.js
 *
 * 只读生成，不改任何矩阵数据、不改产品代码。`--check` 对**结构性错误**判红，并把
 * 漂移量做成**只减不增**的棘轮（新漂移即红；收敛后 `--write` 下调基线）。
 *
 * 用法：
 *   node scripts/m-blueprint-m6a-surface-schema.mjs --check
 *   node scripts/m-blueprint-m6a-surface-schema.mjs --write
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MATRIX = 'acceptance/functional-audit-2026-11-04/surface-matrix.json';
const OUT_DIR = 'acceptance/m-blueprint-2026-11-11/m6a';
const OUT_FILE = `${OUT_DIR}/surface-schema.json`;

const REQUIRED_ENTRY_FIELDS = Object.freeze(['kind', 'id', 'scope']);

function flattenChannels(node, out = []) {
  for (const value of Object.values(node || {})) {
    if (typeof value === 'string') out.push(value);
    else flattenChannels(value, out);
  }
  return out;
}

function readTruth() {
  const channels = flattenChannels(require(path.join(ROOT, 'src/ipc/channels.js')));
  const toolDefs = require(path.join(ROOT, 'core/petri-server/agent-tools/tool-defs.js'));
  const tools = (toolDefs.TOOL_DEFS || [])
    .map((t) => (t && t.function && t.function.name) || null)
    .filter(Boolean);
  return {
    channels: [...new Set(channels)].sort(),
    tools: [...new Set(tools)].sort(),
  };
}

function resolveRouteModule(moduleName) {
  const asFile = path.join(ROOT, 'core/petri-server/routes', `${moduleName}.js`);
  const asDir = path.join(ROOT, 'core/petri-server/routes', moduleName, 'index.js');
  return fs.existsSync(asFile) || fs.existsSync(asDir);
}

export function buildSchema({ root = ROOT } = {}) {
  const matrix = JSON.parse(fs.readFileSync(path.join(root, MATRIX), 'utf8'));
  const truth = readTruth();

  const ipcRows = Array.isArray(matrix.ipcRows) ? matrix.ipcRows : [];
  const toolRows = Array.isArray(matrix.toolRows) ? matrix.toolRows : [];
  const routeRows = Array.isArray(matrix.routeRows) ? matrix.routeRows : [];

  const entries = [
    ...ipcRows.map((r) => ({
      kind: 'ipc',
      id: String(r.channel),
      scope: String(r.channel).split(':')[0] || 'unknown',
      exposed: Boolean(r.inPreload),
      consumed: Boolean(r.usedInRenderer),
    })),
    ...toolRows.map((r) => ({
      kind: 'tool',
      id: String(r.name),
      scope: String(r.domain || 'unknown'),
      exposed: Boolean(r.hasMetadata),
      consumed: Boolean(r.reachable),
      riskTier: r.riskTier ? String(r.riskTier) : null,
    })),
    ...routeRows.map((r) => ({
      kind: 'route',
      id: `${String(r.method).toUpperCase()} ${String(r.route)}`,
      scope: String(r.module || 'unknown'),
      exposed: Boolean(r.mounted),
      consumed: Boolean(r.mounted),
    })),
  ];

  const matrixChannels = ipcRows.map((r) => String(r.channel));
  const matrixTools = toolRows.map((r) => String(r.name));
  const matrixModules = [...new Set(routeRows.map((r) => String(r.module)))];

  const drift = {
    ipcMissingInRegistry: matrixChannels.filter((c) => !truth.channels.includes(c)).sort(),
    ipcMissingInMatrix: truth.channels.filter((c) => !matrixChannels.includes(c)).sort(),
    toolMissingInDefs: matrixTools.filter((t) => !truth.tools.includes(t)).sort(),
    toolMissingInMatrix: truth.tools.filter((t) => !matrixTools.includes(t)).sort(),
    routeModuleMissing: matrixModules.filter((m) => !resolveRouteModule(m)).sort(),
  };

  const summaryMap = new Map(Object.entries(matrix.summary || {}));
  const summaryMismatches = [];
  const expect = (field, actual) => {
    const reported = summaryMap.get(field);
    if (reported === undefined) return;
    if (Number(reported) !== actual) summaryMismatches.push(`${field}: matrix=${reported} actual=${actual}`);
  };
  expect('tools', toolRows.length);
  expect('ipcChannels', ipcRows.length);
  expect('routes', routeRows.length);
  expect('contracts', toolRows.filter((r) => r.hasContract).length);
  expect('metadata', toolRows.filter((r) => r.hasMetadata).length);
  expect('ipcMissingPreload', ipcRows.filter((r) => r.inPreload === false).length);

  const defects = [];
  const keySeen = new Set();
  for (const entry of entries) {
    const key = `${entry.kind}::${entry.id}`;
    if (keySeen.has(key)) defects.push(`DUPLICATE_ENTRY: ${key}`);
    keySeen.add(key);
  }
  for (const m of summaryMismatches) defects.push(`SUMMARY_DRIFT: ${m}`);

  return {
    schemaVersion: 1,
    kind: 'm6a-surface-schema',
    capturedAt: new Date().toISOString(),
    policy: '三面身份 schema 单一形状；漂移按「只减不增」棘轮冻结；本文件只读生成，不改矩阵数据',
    shape: { entry: REQUIRED_ENTRY_FIELDS, kinds: ['ipc', 'tool', 'route'] },
    counts: {
      entries: entries.length,
      ipc: ipcRows.length,
      tool: toolRows.length,
      route: routeRows.length,
      truthChannels: truth.channels.length,
      truthTools: truth.tools.length,
    },
    drift: {
      ipcMissingInRegistry: drift.ipcMissingInRegistry.length,
      ipcMissingInMatrix: drift.ipcMissingInMatrix.length,
      toolMissingInDefs: drift.toolMissingInDefs.length,
      toolMissingInMatrix: drift.toolMissingInMatrix.length,
      routeModuleMissing: drift.routeModuleMissing.length,
      samples: {
        ipcMissingInRegistry: drift.ipcMissingInRegistry.slice(0, 5),
        ipcMissingInMatrix: drift.ipcMissingInMatrix.slice(0, 5),
        toolMissingInDefs: drift.toolMissingInDefs.slice(0, 5),
        toolMissingInMatrix: drift.toolMissingInMatrix.slice(0, 5),
        routeModuleMissing: drift.routeModuleMissing.slice(0, 5),
      },
    },
    summaryMismatches,
    defects: [...new Set(defects)].sort(),
    entries,
    g0Note: 'G0 开发期常态 · 不外推 packaged/Provider/GA',
  };
}

const DRIFT_KEYS = Object.freeze([
  'ipcMissingInRegistry',
  'ipcMissingInMatrix',
  'toolMissingInDefs',
  'toolMissingInMatrix',
  'routeModuleMissing',
]);

export function adjudicateSchema(current, baseline) {
  const issues = [];

  // ① 结构性：必填字段 / 重复 id / 空面
  for (const entry of current.entries) {
    const values = new Map(Object.entries(entry));
    for (const field of REQUIRED_ENTRY_FIELDS) {
      const value = values.get(field);
      if (value === undefined || value === '') issues.push(`ENTRY_FIELD_MISSING: ${field} @ ${entry.id}`);
    }
  }
  for (const kind of ['ipc', 'tool', 'route']) {
    if (!current.entries.some((e) => e.kind === kind)) issues.push(`EMPTY_SURFACE: ${kind}`);
  }

  // ② 结构性缺陷（重复身份 / 矩阵摘要数字漂移）按基线冻结：新增即红，存量在册可见
  const knownDefects = new Set((baseline && baseline.defects) || []);
  const currentDefects = current.defects || [];
  for (const defect of currentDefects) {
    if (!knownDefects.has(defect)) issues.push(`NEW_DEFECT: ${defect}`);
  }

  // ③ 漂移棘轮：只减不增
  if (!baseline || !baseline.drift) {
    issues.push('BASELINE_MISSING: 先跑 --write 建立漂移基线');
  } else {
    const currentDrift = new Map(Object.entries(current.drift || {}));
    const baselineDrift = new Map(Object.entries(baseline.drift || {}));
    for (const key of DRIFT_KEYS) {
      const now = Number(currentDrift.get(key));
      const was = Number(baselineDrift.get(key));
      if (!Number.isFinite(now)) issues.push(`DRIFT_NOT_NUMERIC: ${key}`);
      else if (Number.isFinite(was) && now > was) issues.push(`DRIFT_INCREASED: ${key} ${was} → ${now}`);
    }
  }

  return { ok: issues.length === 0, issues };
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const check = args.includes('--check');
  if (write === check) {
    process.stderr.write('用法：node scripts/m-blueprint-m6a-surface-schema.mjs --check | --write（互斥）\n');
    process.exit(2);
  }

  const current = buildSchema();
  const outPath = path.join(ROOT, OUT_FILE);

  if (write) {
    const previous = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : null;
    // 基线只允许收敛：写盘时取「当前值」与「旧基线」的较小者，避免误抬
    const drift = { ...current.drift };
    if (previous && previous.drift) {
      const previousDrift = new Map(Object.entries(previous.drift));
      const currentDrift = new Map(Object.entries(current.drift));
      for (const key of DRIFT_KEYS) {
        const prev = Number(previousDrift.get(key));
        const now = Number(currentDrift.get(key));
        if (Number.isFinite(prev)) {
          Object.defineProperty(drift, key, { value: Math.min(prev, now), writable: true, enumerable: true, configurable: true });
        }
      }
    }
    fs.mkdirSync(path.join(ROOT, OUT_DIR), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify({ ...current, drift }, null, 2)}\n`);
    const entries = Object.entries(drift)
      .filter(([k]) => DRIFT_KEYS.includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    process.stdout.write(`[m6a-surface] schema 写入：entries=${current.counts.entries}（ipc ${current.counts.ipc} / tool ${current.counts.tool} / route ${current.counts.route}）drift ${entries}\n`);
    process.exit(0);
  }

  const baseline = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : null;
  const verdict = adjudicateSchema(current, baseline);
  process.stdout.write(`[m6a-surface] 共面 schema 门 → ${verdict.ok ? 'PASS' : 'FAIL'}（${verdict.issues.length} issues）\n`);
  for (const issue of verdict.issues.slice(0, 20)) process.stdout.write(`  ✖ ${issue}\n`);
  process.exit(verdict.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
