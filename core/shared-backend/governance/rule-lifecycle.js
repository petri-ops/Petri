'use strict';

/**
 * governance/rule-lifecycle.js — BLOCK-337 P7③ 规则候选沉淀与退化（纯函数账本）。
 *
 * 规则能长出来也能退化：
 *   - 记录每条规则的命中（hit=正确拦截/正确提醒）与误拦（misfire=不该拦却拦了）；
 *   - 误拦率超阈自动降级为 observe（等人复盘），不再硬拦——规则包不是只增不减的单向门；
 *   - 数据来源 v1=放权坡道 observe 档的聚合（P5 落账时接线），本模块只管账本与判定。
 *
 * 判定：misfires ≥ MIN_MISFIRES_TO_DOWNGRADE 且 misfireRate ≥ DOWNGRADE_MISFIRE_RATE
 * → `observe`；其余 `enforce`。无记录 = enforce（新规则默认生效，但一上来就狂误拦会被打回）。
 */

const MIN_MISFIRES_TO_DOWNGRADE = 3;
const DOWNGRADE_MISFIRE_RATE = 0.5;

function emptyEntry() {
  return { hits: 0, misfires: 0 };
}

function keyOf(packId, ruleId) {
  return `${packId}::${ruleId}`;
}

function createRuleLedger(initial = {}) {
  const entries = {};
  const source = initial && typeof initial.entries === 'object' ? initial.entries : {};
  for (const [key, entry] of Object.entries(source)) {
    if (!entry || typeof entry !== 'object') continue;
    entries[key] = {
      hits: Number(entry.hits) || 0,
      misfires: Number(entry.misfires) || 0,
    };
  }

  function entryFor(packId, ruleId) {
    const key = keyOf(packId, ruleId);
    if (!entries[key]) entries[key] = emptyEntry();
    return entries[key];
  }

  return {
    /** outcome: 'hit'（拦对了/提对了）| 'misfire'（误拦/误提）| 其他值忽略。 */
    recordOutcome({ packId, ruleId, outcome }) {
      if (!packId || !ruleId) return { ok: false, reason: 'invalid_input' };
      if (outcome !== 'hit' && outcome !== 'misfire') return { ok: false, reason: 'unknown_outcome' };
      const entry = entryFor(packId, ruleId);
      // outcome 单数、账本字段复数——直接以 outcome 为键会写出 NaN（契约测抓真）
      entry[outcome === 'hit' ? 'hits' : 'misfires'] += 1;
      return { ok: true, ...entry };
    },

    /** 当前生效档位：'enforce' | 'observe'（observe=只观察不硬拦，等人复盘）。 */
    status(packId, ruleId) {
      const entry = entries[keyOf(packId, ruleId)] || emptyEntry();
      const total = entry.hits + entry.misfires;
      const misfireRate = total > 0 ? entry.misfires / total : 0;
      const downgraded = entry.misfires >= MIN_MISFIRES_TO_DOWNGRADE && misfireRate >= DOWNGRADE_MISFIRE_RATE;
      return {
        hits: entry.hits,
        misfires: entry.misfires,
        misfireRate: Math.round(misfireRate * 1000) / 1000,
        total,
        mode: downgraded ? 'observe' : 'enforce',
      };
    },

    /** 人工复盘后复位（降级的规则确认保留则清计数，确认删除则 remove）。 */
    reset(packId, ruleId) {
      delete entries[keyOf(packId, ruleId)];
      return { ok: true };
    },

    remove(packId, ruleId) {
      return this.reset(packId, ruleId);
    },

    toJSON() {
      return { entries };
    },
  };
}

module.exports = {
  MIN_MISFIRES_TO_DOWNGRADE,
  DOWNGRADE_MISFIRE_RATE,
  createRuleLedger,
};
