'use strict';

/**
 * shared-backend/do-sources.js
 *
 * item 87 第一阶段 —— 真理源清单（sources.yaml）schema 与解析。
 *
 * 「可信」是领域内判断，模型排不出来（方案 §5.2）：清单必须领域专家拍板，
 * 本模块只负责把**已拍板/待拍板的清单**变成机器可校验的形状——校验通过 ≠ 权威性确认。
 *
 * 零依赖约束（BLOCK-511 红线）：本文件内置一个严格子集 YAML 解析器，只支持
 * 我们自己定义的清单形态（顶层 map + 两级嵌套 + `- ` 列表项 + `#` 注释）。
 * 遇到 tab、未知缩进形态一律 fail-closed 抛错，不做宽容解析——清单是纪律资产，
 * 解析器宽容 = 格式漂移温床。
 *
 * schema：
 *   meta:
 *     domain: <string>            领域名
 *     status: draft|confirmed     草案期必须 draft；confirmed 需 owner 拍板
 *     updated: <date>
 *   sources:
 *     - id: <string>              清单内唯一，被卡片/纪律引用
 *       name: <string>
 *       url: <string>
 *       authority_level: official|peer-reviewed|preprint|community
 *       freshness: stable|fast
 *       verified_date: <date>     最近一次人工核验日期
 *       notes: <string>（可选）
 */

const AUTHORITY_LEVELS = Object.freeze(['official', 'peer-reviewed', 'preprint', 'community']);
const FRESHNESS_VALUES = Object.freeze(['stable', 'fast']);
const SOURCE_STATUSES = Object.freeze(['draft', 'confirmed']);

/** 去注释（整行/行尾 # 前有空格才算注释；URL 里的 # 片段是合法形态）。 */
function stripComment(line) {
  const hashAt = line.indexOf(' #');
  return (hashAt >= 0 ? line.slice(0, hashAt) : line).trimEnd();
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === 'null' || trimmed === '') return null;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}


/** 顶层/第 2 层键封闭键表（meta/sources）。未知键 fail-closed。 */
function setMapField(map, key, value, lineNo) {
  switch (key) {
    case 'domain': map.domain = value; break;
    case 'status': map.status = value; break;
    case 'updated': map.updated = value; break;
    case 'confirmed_by': map.confirmed_by = value; break;
    default:
      throw new Error(`sources.yaml 第 ${lineNo} 行未知键：${key}（meta 允许 domain/status/updated/confirmed_by）`);
  }
}

/**
 * 严格子集解析。返回普通对象；任何超出子集的形态抛 Error（fail-closed）。
 * 形态约束：键路径深度 ≤ 2；列表项只在第 2 层键下出现，形如 `  - key: value`。
 */
function parseSourcesYaml(text) {
  if (typeof text !== 'string') throw new Error('sources.yaml 内容缺失');
  if (/\t/.test(text)) throw new Error('sources.yaml 含 tab 缩进——只允许空格（严格子集解析拒绝）');
  const lines = text.split('\n').map(stripComment).filter((line) => !line.trim().startsWith('#'));
  const root = {};
  let currentKey = null;
  let currentItem = null;

  for (const [index, raw] of lines.entries()) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();

    if (indent === 0) {
      const match = trimmed.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (!match) throw new Error(`sources.yaml 第 ${index + 1} 行无法解析（顶层形态）：${trimmed}`);
      currentKey = match[1];
      currentItem = null;
      // 键表封闭：只认 meta/sources 两个已知顶层键（严格子集解析器契约）
      if (currentKey !== 'meta' && currentKey !== 'sources') {
        throw new Error(`sources.yaml 第 ${index + 1} 行未知顶层键：${currentKey}（只允许 meta/sources）`);
      }
      if (currentKey === 'meta') root.meta = match[2] === '' ? null : parseScalar(match[2]);
      else root.sources = match[2] === '' ? null : parseScalar(match[2]);
      continue;
    }

    if (indent !== 2 && indent !== 4) {
      throw new Error(`sources.yaml 第 ${index + 1} 行缩进异常（只允许 2/4 空格）：${trimmed}`);
    }

    if (indent === 2) {
      // 第 2 层：meta 的键，或 sources 列表项的开头
      const listItem = trimmed.match(/^-\s+(.*)$/);
      if (listItem) {
        if (currentKey !== 'sources') throw new Error(`第 ${index + 1} 行：列表只允许出现在 sources 键下`);
        if (root.sources === null) root.sources = [];
        currentItem = {};
        root.sources.push(currentItem);
        const pair = listItem[1].match(/^([A-Za-z0-9_]+):\s*(.*)$/);
        if (!pair) throw new Error(`sources.yaml 第 ${index + 1} 行无法解析（列表项形态）：${trimmed}`);
        setItemField(currentItem, pair, index + 1);
        continue;
      }
      const pair = trimmed.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (!pair) throw new Error(`sources.yaml 第 ${index + 1} 行无法解析（第 2 层形态）：${trimmed}`);
      if (!currentKey) throw new Error(`第 ${index + 1} 行：键 ${pair[1]} 缺少第 1 层宿主`);
      if (currentKey === 'sources') throw new Error(`第 ${index + 1} 行：sources 下不允许键值对（只允许 - 列表项）`);
      if (currentKey === 'meta') {
        if (root.meta === null) root.meta = {};
        if (typeof root.meta !== 'object') throw new Error(`第 ${index + 1} 行：键 meta 已是标量，不能再挂子键`);
        setMapField(root.meta, pair[1], parseScalar(pair[2]), index + 1);
      } else {
        // sources 列表键下出现键值对：形状非法
        throw new Error(`第 ${index + 1} 行：sources 下不允许键值对（只允许 - 列表项）`);
      }
      currentItem = null;
      continue;
    }

    // indent === 4：列表项的字段
    if (!currentItem) throw new Error(`第 ${index + 1} 行字段缺少所属列表项：${trimmed}`);
    const pair = trimmed.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!pair) throw new Error(`sources.yaml 第 ${index + 1} 行无法解析（列表字段形态）：${trimmed}`);
    setItemField(currentItem, pair, index + 1);
  }
  return root;
}

/** 列表项字段封闭键表：显式白名单直取赋值（消除动态键注入面）。 */
function setItemField(item, pair, lineNo) {
  const key = pair[1];
  const value = parseScalar(pair[2]);
  switch (key) {
    case 'id': item.id = value; break;
    case 'name': item.name = value; break;
    case 'url': item.url = value; break;
    case 'authority_level': item.authority_level = value; break;
    case 'freshness': item.freshness = value; break;
    case 'verified_date': item.verified_date = value; break;
    case 'notes': item.notes = value; break;
    default:
      throw new Error(`sources.yaml 第 ${lineNo} 行未知来源字段：${key}（白名单 id/name/url/authority_level/freshness/verified_date/notes）`);
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 结构校验。返回 { ok, meta, sources, error?, violations? }。
 * 结构错误（缺字段/未知枚举/重复 id）返回 ok:false，不抛——供资产 lint 逐条报告。
 */
function validateSourcesFile(text) {
  let parsed;
  try {
    parsed = parseSourcesYaml(text);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  const violations = [];
  const meta = parsed && typeof parsed.meta === 'object' && parsed.meta ? parsed.meta : null;
  if (!meta) violations.push('缺 meta 段');
  if (meta) {
    if (!meta.domain) violations.push('meta.domain 缺失');
    if (!SOURCE_STATUSES.includes(meta.status)) violations.push(`meta.status 必须是 ${SOURCE_STATUSES.join('/')}，实际：${meta.status}`);
    if (meta.updated && !ISO_DATE_RE.test(meta.updated)) violations.push('meta.updated 需为 YYYY-MM-DD');
  }
  const sources = Array.isArray(parsed.sources) ? parsed.sources : null;
  if (!sources || sources.length === 0) violations.push('sources 段缺失或为空');
  const seen = new Set();
  for (const source of sources || []) {
    // 显式五字段检查（消除动态键注入面；REQUIRED_SOURCE_FIELDS 常量保留供文档对照）
    const missingField =
      source.id === undefined || source.id === null || source.id === '' ? 'id'
      : source.name === undefined || source.name === null || source.name === '' ? 'name'
      : source.url === undefined || source.url === null || source.url === '' ? 'url'
      : source.authority_level === undefined || source.authority_level === null || source.authority_level === '' ? 'authority_level'
      : source.freshness === undefined || source.freshness === null || source.freshness === '' ? 'freshness'
      : source.verified_date === undefined || source.verified_date === null || source.verified_date === '' ? 'verified_date'
      : null;
    if (missingField) {
      violations.push(`来源 ${source.id || '(无 id)'} 缺字段 ${missingField}`);
    }
    if (source.authority_level !== undefined && !AUTHORITY_LEVELS.includes(source.authority_level)) {
      violations.push(`来源 ${source.id} authority_level 未知：${source.authority_level}`);
    }
    if (source.freshness !== undefined && !FRESHNESS_VALUES.includes(source.freshness)) {
      violations.push(`来源 ${source.id} freshness 未知：${source.freshness}`);
    }
    if (source.verified_date && !ISO_DATE_RE.test(source.verified_date)) {
      violations.push(`来源 ${source.id} verified_date 需为 YYYY-MM-DD`);
    }
    if (source.id) {
      if (seen.has(source.id)) violations.push(`来源 id 重复：${source.id}`);
      seen.add(source.id);
    }
    if (source.url && !/^https?:\/\//i.test(String(source.url))) {
      violations.push(`来源 ${source.id} url 必须是 http(s)`);
    }
  }
  if (violations.length > 0) return { ok: false, violations: violations, meta: meta || null, sources: sources || [] };
  return { ok: true, meta, sources };
}

/** id → source 索引（纪律钉与 ingest 用）。 */
function buildSourceIndex(sources) {
  const index = new Map();
  for (const source of sources || []) {
    if (source && source.id) index.set(source.id, source);
  }
  return index;
}

module.exports = {
  parseSourcesYaml,
  validateSourcesFile,
  buildSourceIndex,
};
