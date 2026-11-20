'use strict';

/**
 * EVO-3 — Verify 频率判据纯函数（lesson 生效前后同类 fingerprint 频率）。
 * 职责边界：只做数值判据，不碰 DB / 文件 / 网络 / 计时。
 * 判据（plan §2.5）：降→keep（保留加固）/ 平→degrade（降级观察）/ 升→rollback（自动回滚）。
 * after=0 为最强保留信号（学会后零复发）。
 */

/** 冻结判据常量（可调但 owner:code，agent 自进化不可改）。 */
const VERIFY_RULES = Object.freeze({
  maxFlatRatio: 0.1,        // |after-before|/max(before,1) ≤ 该值视为持平
  minSamplesForRebound: 1,  // after 至少这么多才可能判回升
  owner: 'code',
});

/**
 * 判定 lesson 的频率结论（纯函数）。
 * @param {number} before - 生效前同类 incident 数
 * @param {number} after - 生效后同类 incident 数
 * @returns {{decision:'keep'|'degrade'|'rollback', code:string, reason:string}}
 */
function judgeFrequency(before = 0, after = 0) {
  const b = Number.isFinite(before) ? Math.max(0, before) : 0;
  const a = Number.isFinite(after) ? Math.max(0, after) : 0;
  if (a === 0) {
    return Object.freeze({ decision: 'keep', code: 'zero_recurrence', reason: '生效后零复发：保留并加固置信' });
  }
  if (a > b) {
    return Object.freeze({ decision: 'rollback', code: 'frequency_rebound', reason: `生效后频率回升（${b}→${a}）：自动回滚该 lesson` });
  }
  const denom = Math.max(b, 1);
  const ratio = Math.abs(a - b) / denom;
  if (ratio <= VERIFY_RULES.maxFlatRatio) {
    return Object.freeze({ decision: 'degrade', code: 'frequency_flat', reason: `频率基本持平（${b}→${a}）：降级观察，不继续扩散` });
  }
  return Object.freeze({ decision: 'keep', code: 'frequency_down', reason: `频率下降（${b}→${a}）：保留并加固置信` });
}

module.exports = { VERIFY_RULES, judgeFrequency };
