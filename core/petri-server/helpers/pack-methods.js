'use strict';

/**
 * BLOCK-220 — 已安装领域包贡献的 methods 数据面。
 *
 * Methods/导出是生信产品面，但「哪个分析类型该引用哪些标准工具」「该类型的工具标签叫什么」
 * 是**领域数据**，不该硬编码在核心。领域包通过 `pack.json` 的
 * `provides.methods = { citations?, toolLabels? }` 声明两个 JSON 的相对路径：
 *
 *   citations.json   { "<analysisType>": ["引用字符串", …] }
 *   tool-labels.json { "<analysisType>": "工具标签" }
 *
 * 纪律（与 pack-prompt-fragments.js 同一先例）：
 * - 只读已安装且 `enabled !== false` 的包；包缺失/停用 → 空结果，核心不伪造引文。
 * - 只读 + 有界：单文件 ≤256KB、类型键 ≤200、单类型条目 ≤40、单条 ≤400 字符；
 *   越界截断并计入 `warnings`（不抛错，不无界膨胀）。
 * - 形状错误 fail-closed：该包该面整块忽略并留 warning，不做半读拼接。
 * - 路径只允许落在 packRoot 之内（防 `../` 逃逸）。
 */

const fs = require('fs');
const path = require('path');
const packRegistry = require('../../shared-backend/pack-registry');
const { resolveDataDir } = require('../../shared-backend/data-paths');

const MAX_FILE_BYTES = 256 * 1024;
const MAX_TYPES = 200;
const MAX_ENTRIES_PER_TYPE = 40;
const MAX_ENTRY_CHARS = 400;
const MAX_TEMPLATE_LINES = 400;
const MAX_REPORT_CITATIONS = 40;

function readBoundedJson(filePath, packRoot, warnings, label) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(packRoot);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    warnings.push({ packId: null, code: 'path_outside_pack', file: label });
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
    warnings.push({ packId: null, code: 'file_too_large', file: label, size: stat.size });
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    warnings.push({ packId: null, code: 'invalid_json', file: label });
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clip(text, limit) {
  const str = String(text);
  return str.length > limit ? str.slice(0, limit) : str;
}

function sanitizeCitations(raw, packId, warnings) {
  if (!isPlainObject(raw)) {
    warnings.push({ packId, code: 'citations_not_object' });
    return {};
  }
  const out = {};
  const types = Object.keys(raw).slice(0, MAX_TYPES);
  if (Object.keys(raw).length > MAX_TYPES) {
    warnings.push({ packId, code: 'citations_types_truncated', kept: types.length });
  }
  for (const type of types) {
    const list = raw[type];
    if (!Array.isArray(list)) {
      warnings.push({ packId, code: 'citations_entry_not_array', type });
      continue;
    }
    const items = list
      .filter((item) => typeof item === 'string' && item.trim())
      .slice(0, MAX_ENTRIES_PER_TYPE)
      .map((item) => clip(item.trim(), MAX_ENTRY_CHARS));
    if (list.length > MAX_ENTRIES_PER_TYPE) {
      warnings.push({ packId, code: 'citations_entries_truncated', type, kept: items.length });
    }
    if (items.length > 0) out[type] = items;
  }
  return out;
}

function sanitizePythonEquivalents(raw, packId, warnings) {
  if (!isPlainObject(raw)) {
    warnings.push({ packId, code: 'python_equivalents_not_object' });
    return {};
  }
  const out = {};
  const types = Object.keys(raw).slice(0, MAX_TYPES);
  if (Object.keys(raw).length > MAX_TYPES) {
    warnings.push({ packId, code: 'python_equivalents_types_truncated', kept: types.length });
  }
  for (const type of types) {
    const lines = raw[type];
    if (!Array.isArray(lines)) {
      warnings.push({ packId, code: 'python_equivalent_not_array', type });
      continue;
    }
    const clean = lines
      .filter((line) => typeof line === 'string')
      .slice(0, MAX_TEMPLATE_LINES)
      .map((line) => clip(line, MAX_ENTRY_CHARS));
    if (lines.length > MAX_TEMPLATE_LINES) {
      warnings.push({ packId, code: 'python_equivalent_truncated', type, kept: clean.length });
    }
    if (clean.length > 0) out[type] = clean;
  }
  return out;
}

function sanitizeReportCitations(raw, packId, warnings) {
  if (!Array.isArray(raw)) {
    warnings.push({ packId, code: 'report_citations_not_array' });
    return [];
  }
  const clean = raw
    .filter((item) => typeof item === 'string' && item.trim())
    .slice(0, MAX_REPORT_CITATIONS)
    .map((item) => clip(item.trim(), MAX_ENTRY_CHARS));
  if (raw.length > MAX_REPORT_CITATIONS) {
    warnings.push({ packId, code: 'report_citations_truncated', kept: clean.length });
  }
  return clean;
}

function sanitizeToolLabels(raw, packId, warnings) {
  if (!isPlainObject(raw)) {
    warnings.push({ packId, code: 'tool_labels_not_object' });
    return {};
  }
  const out = {};
  const types = Object.keys(raw).slice(0, MAX_TYPES);
  if (Object.keys(raw).length > MAX_TYPES) {
    warnings.push({ packId, code: 'tool_labels_types_truncated', kept: types.length });
  }
  for (const type of types) {
    const label = raw[type];
    if (typeof label !== 'string' || !label.trim()) {
      warnings.push({ packId, code: 'tool_label_not_string', type });
      continue;
    }
    out[type] = clip(label.trim(), MAX_ENTRY_CHARS);
  }
  return out;
}

/**
 * 读取所有启用包的 methods 面。返回
 * `{ citations, toolLabels, packs: [{ packId, citations, toolLabels }], warnings }`。
 * 同一分析类型被多个包声明时按 packId 字典序后者覆盖前者（稳定、可预测），
 * 并把覆盖记进 warnings（不静默胜出）。
 */
function loadPackMethods() {
  let packs = [];
  try {
    packs = packRegistry.readInstalledPacks(resolveDataDir());
  } catch {
    return { citations: {}, toolLabels: {}, packs: [], warnings: [] };
  }
  const warnings = [];
  const citations = {};
  const toolLabels = {};
  const pythonEquivalents = {};
  let reportCitations = [];
  const contributions = [];
  const ordered = packs
    .filter((pack) => pack && pack.enabled !== false && pack.packRoot)
    .sort((a, b) => String(a.packId).localeCompare(String(b.packId)));
  for (const pack of ordered) {
    const packId = pack.packId;
    const manifest = readBoundedJson(path.join(pack.packRoot, 'pack.json'), pack.packRoot, warnings, 'pack.json');
    const methods = manifest && isPlainObject(manifest.provides) ? manifest.provides.methods : null;
    if (!isPlainObject(methods)) continue;
    const packCitations = {};
    const packLabels = {};
    const packTemplates = {};
    let packReportCitations = [];
    if (typeof methods.citations === 'string' && methods.citations.trim()) {
      const file = path.join(pack.packRoot, methods.citations.trim());
      const parsed = readBoundedJson(file, pack.packRoot, warnings, methods.citations.trim());
      if (parsed !== null) Object.assign(packCitations, sanitizeCitations(parsed, packId, warnings));
    }
    if (typeof methods.toolLabels === 'string' && methods.toolLabels.trim()) {
      const file = path.join(pack.packRoot, methods.toolLabels.trim());
      const parsed = readBoundedJson(file, pack.packRoot, warnings, methods.toolLabels.trim());
      if (parsed !== null) Object.assign(packLabels, sanitizeToolLabels(parsed, packId, warnings));
    }
    if (typeof methods.pythonEquivalents === 'string' && methods.pythonEquivalents.trim()) {
      const file = path.join(pack.packRoot, methods.pythonEquivalents.trim());
      const parsed = readBoundedJson(file, pack.packRoot, warnings, methods.pythonEquivalents.trim());
      if (parsed !== null) Object.assign(packTemplates, sanitizePythonEquivalents(parsed, packId, warnings));
    }
    if (typeof methods.reportCitations === 'string' && methods.reportCitations.trim()) {
      const file = path.join(pack.packRoot, methods.reportCitations.trim());
      const parsed = readBoundedJson(file, pack.packRoot, warnings, methods.reportCitations.trim());
      if (parsed !== null) packReportCitations = sanitizeReportCitations(parsed, packId, warnings);
    }
    contributions.push({
      packId,
      citations: packCitations,
      toolLabels: packLabels,
      pythonEquivalents: packTemplates,
      reportCitations: packReportCitations,
    });
    for (const [type, list] of Object.entries(packCitations)) {
      if (citations[type]) warnings.push({ packId, code: 'citations_overridden', type });
      citations[type] = list;
    }
    for (const [type, label] of Object.entries(packLabels)) {
      if (toolLabels[type]) warnings.push({ packId, code: 'tool_label_overridden', type });
      toolLabels[type] = label;
    }
    for (const [type, lines] of Object.entries(packTemplates)) {
      if (pythonEquivalents[type]) warnings.push({ packId, code: 'python_equivalent_overridden', type });
      pythonEquivalents[type] = lines;
    }
    if (packReportCitations.length > 0) {
      if (reportCitations.length > 0) warnings.push({ packId, code: 'report_citations_overridden' });
      reportCitations = packReportCitations;
    }
  }
  return { citations, toolLabels, pythonEquivalents, reportCitations, packs: contributions, warnings };
}

function getCitations(type, bundle) {
  if (typeof type !== 'string' || !type) return [];
  const source = bundle && bundle.citations ? bundle : loadPackMethods();
  const list = source.citations[type];
  return Array.isArray(list) ? list.slice() : [];
}

function getToolLabel(type, bundle) {
  if (typeof type !== 'string' || !type) return null;
  const source = bundle && bundle.toolLabels ? bundle : loadPackMethods();
  const label = source.toolLabels[type];
  return typeof label === 'string' && label ? label : null;
}

function getPythonEquivalent(type, bundle) {
  if (typeof type !== 'string' || !type) return null;
  const source = bundle && bundle.pythonEquivalents ? bundle : loadPackMethods();
  const lines = source.pythonEquivalents[type];
  return Array.isArray(lines) ? lines.slice() : null;
}

function getReportCitations(bundle) {
  const source = bundle && Array.isArray(bundle.reportCitations) ? bundle : loadPackMethods();
  return Array.isArray(source.reportCitations) ? source.reportCitations.slice() : [];
}

module.exports = {
  loadPackMethods,
  getCitations,
  getToolLabel,
  getPythonEquivalent,
  getReportCitations,
  MAX_FILE_BYTES,
  MAX_TYPES,
  MAX_ENTRIES_PER_TYPE,
  MAX_ENTRY_CHARS,
};
