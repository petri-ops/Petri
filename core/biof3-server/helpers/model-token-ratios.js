/**
 * helpers/model-token-ratios.js — 按模型 token 计数校准系数（BLOCK-163 W3 P5/MDL-2）。
 *
 * 背景：token-estimator 用 cl100k 近似所有模型的计数。对 CJK 重度文本，
 * cl100k 相对 DeepSeek/Qwen/GLM 等自有分词器系统性高估（估算/实际 ≈ 1.4–2x）。
 * 本模块给估算值乘**校准系数 ratio（=actual/estimated）**：
 *   - 种子表按模型名子串匹配（启发式种子，注释留依据；无匹配=1.0）；
 *   - observeRatio EWMA 自愈：同一模型「估算 vs usage 实际」成对观测持续收敛系数；
 *   - 纯内存态（进程重启回种子）——预算红线由 estimate 的下限保护，系数只影响
 *     触发修剪的时点，不承担正确性。
 */

const SEED_SUBSTRING_RATIOS = [
  // 启发式种子（CJK 重度场景，cl100k vs 各家自有分词器的公开粗测口径；
  // 首批观测落库后由 EWMA 收敛，此处只做首日不出错的下限）
  ['deepseek', 0.65],
  ['qwen', 0.7],
  ['glm', 0.7],
  ['chatglm', 0.7],
  ['minimax', 0.7],
  ['claude', 0.95],
  ['gemini', 0.9],
  ['mistral', 0.95],
  ['kimi', 0.7],
  ['moonshot', 0.7],
];

const EWMA_ALPHA = 0.2; // 新观测权重（约 5 次观测收敛到 90%+）
const _observed = new Map(); // model → { ratio, observations }

function getRatio(model) {
  const lower = String(model || '').toLowerCase();
  for (const [needle, ratio] of SEED_SUBSTRING_RATIOS) {
    if (lower.includes(needle)) {
      const obs = _observed.get(lower);
      return obs ? obs.ratio : ratio;
    }
  }
  const obs = _observed.get(lower);
  return obs ? obs.ratio : 1.0;
}

/**
 * 成对观测：estimated=cl100k 估算值，actual=usage 回传值。
 * ratio = actual/estimated 的 EWMA（双侧夹持 [0.3, 2.0] 防坏观测）。
 */
function observeRatio(model, estimated, actual) {
  const key = String(model || '').toLowerCase();
  if (!key || !Number.isFinite(estimated) || estimated <= 0
    || !Number.isFinite(actual) || actual <= 0) return null;
  const raw = actual / estimated;
  const clamped = Math.min(2.0, Math.max(0.3, raw));
  const prev = _observed.get(key);
  const ratio = prev ? prev.ratio + EWMA_ALPHA * (clamped - prev.ratio) : clamped;
  const observations = (prev ? prev.observations : 0) + 1;
  _observed.set(key, { ratio, observations });
  return { ratio, observations };
}

/** 估算入口：estimateTokens(text 或 total, model) → 计入校准的估算值。 */
function calibratedEstimate(estimatedTokens, model) {
  return Math.ceil(estimatedTokens * getRatio(model));
}

/** 测试/观测钩子。 */
function _resetForTests() {
  _observed.clear();
}

module.exports = {
  getRatio,
  observeRatio,
  calibratedEstimate,
  _resetForTests,
};
