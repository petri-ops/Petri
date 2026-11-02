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

const OBSERVED_NAMESPACE = 'observed';

function rowField(row, camel, snake) {
  if (row[camel] !== undefined && row[camel] !== null) return row[camel];
  if (row[snake] !== undefined && row[snake] !== null) return row[snake];
  return '';
}

/** 行 → 账本键；无可用身份（空 rule_id 且空 tool_name）返回 null（丢弃，不猜）。 */
function ledgerKeyFor(row) {
  const ruleId = String(rowField(row, 'ruleId', 'rule_id') || '').trim();
  if (ruleId.includes('::')) return ruleId;
  const toolName = String(rowField(row, 'toolName', 'tool_name') || '').trim();
  const candidate = ruleId || toolName;
  return candidate ? `${OBSERVED_NAMESPACE}::${candidate}` : null;
}

/**
 * 观察行数组 → 账本 entries（可直接喂 createRuleLedger({ entries })）。
 * 同键多行合并累加；非 object 行忽略；hits 非法按 0 计。
 */
function ledgerEntriesFromRows(rows) {
  const entries = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const key = ledgerKeyFor(row);
    if (!key) continue;
    const hits = Math.max(0, Number(row.hits) || 0);
    if (!entries[key]) entries[key] = { hits: 0, misfires: 0 };
    const decision = rowField(row, 'reviewDecision', 'review_decision');
    if (decision === 'misfire') entries[key].misfires += hits;
    else entries[key].hits += hits;
  }
  return entries;
}

module.exports = {
  OBSERVED_NAMESPACE,
  ledgerEntriesFromRows,
};
