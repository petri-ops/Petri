'use strict';

/**
 * shared-backend/governance/observation-bridge.js — BLOCK-337 P7③ 放权坡道观察数据 →
 * 规则生命周期账本桥（纯函数，零 IO、零 db 依赖）。
 *
 * 数据来源 = 观察存储的行（rule-observe / tool-observe，含复盘结论）。键规则：
 *   - rule_id 为 `pack::rule` 全限定形态 → 直接喂该规则的生命周期计数（入包规则退化数据）；
 *   - 其余（裸规则 id / 工具名）= 尚未入包的观察候选，账记在 `observed::` 命名空间，
 *     供复盘面确认入包（origin: observed 的沉淀通道）。
 * hits 取行内累计命中数；复盘结论 decision='misfire' → 该行命中整体计为误拦，
 * 'confirmed' → 保持命中；未复盘 → 乐观计命中（复盘翻案才会触发降级）。
 */

const { createRuleLedger, statusFromEntry } = require('./rule-lifecycle');

const OBSERVED_NAMESPACE = 'observed';

/** camel / snake 两形态取值（观察存储行可能来自 rowToView 或裸 sqlite 行）。 */
function pickText(primary, fallback) {
  if (primary !== undefined && primary !== null) return String(primary);
  if (fallback !== undefined && fallback !== null) return String(fallback);
  return '';
}

/** 行 → 账本键；无可用身份（空 rule_id 且空 tool_name）返回 null（丢弃，不猜）。 */
function ledgerKeyFor(row) {
  const ruleId = pickText(row.ruleId, row.rule_id).trim();
  if (ruleId.includes('::')) return ruleId;
  const toolName = pickText(row.toolName, row.tool_name).trim();
  const candidate = ruleId || toolName;
  return candidate ? `${OBSERVED_NAMESPACE}::${candidate}` : null;
}

/**
 * 观察行数组 → 账本 entries（可直接喂 createRuleLedger({ entries })）。
 * 同键多行合并累加；非 object 行忽略；hits 非法按 0 计。
 */
function ledgerEntriesFromRows(rows) {
  const merged = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const key = ledgerKeyFor(row);
    if (!key) continue;
    const hits = Math.max(0, Number(row.hits) || 0);
    const entry = merged.get(key) || { hits: 0, misfires: 0 };
    if (pickText(row.reviewDecision, row.review_decision) === 'misfire') entry.misfires += hits;
    else entry.hits += hits;
    merged.set(key, entry);
  }
  return Object.fromEntries(merged);
}

module.exports = {
  OBSERVED_NAMESPACE,
  ledgerEntriesFromRows,
  createRuleLedger,
  statusFromEntry,
};
