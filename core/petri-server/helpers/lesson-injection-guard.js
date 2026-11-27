'use strict';

/**
 * helpers/lesson-injection-guard.js — A3-D1 注入边界频率异常熔断（纯函数、零依赖）。
 *
 * 职责：在 selfEvolutionLessons 写入 prompt context 之前，对每条 active lesson 复用
 * EVO-3 既有的频率判据结果；仅 rollback（frequency_rebound）本轮剔除，degrade/keep/
 * 判据读失败一律原样注入（fail-open，不误伤、不中断主链）。本模块只做内存过滤：
 * 不回写任何 DB 状态（事后收口仍归既有路径），不碰 MD 回读面与记忆文件，不触及红线表。
 *
 * 真源 API（现读核对，未臆造）：verifyLessonFrequency(fp) 返回
 * {before, after, decision:{decision, code, reason}, ok}；lesson 主键字段 sourceFingerprint；
 * rollback 的唯一机器码为 frequency_rebound。
 *
 * @param {Array<object>} lessons - listActiveLessons 产物
 * @param {Function} verifyFn - (fingerprint) => verifyLessonFrequency 形态的判据容器
 * @returns {{lessons: Array<object>, frozen: Array<{sourceFingerprint: string, verdict: object}>}}
 */
function guardLessonInjection(lessons = [], verifyFn = null) {
  if (!Array.isArray(lessons) || lessons.length === 0) return { lessons: [], frozen: [] };

  const allowed = [];
  const frozen = [];
  for (const lesson of lessons) {
    const fp = lesson && lesson.sourceFingerprint;
    let result = null;
    try {
      if (typeof verifyFn === 'function' && fp) result = verifyFn(fp);
    } catch { /* 判据读取失败 → fail-open，既不冻结也不影响本轮运行 */ }

    const verdict = result && result.decision;
    if (verdict && verdict.decision === 'rollback') {
      // 冻结理由随 verdict 留痕：code / reason 原样带出，不改写判据本体
      const entry = { sourceFingerprint: fp, verdict };
      frozen.push(entry);
      if (process.env.EVO_DEBUG) { try { console.warn('[evo][guard] frozen at injection boundary:', JSON.stringify(entry)); } catch { /* debug 留痕失败可忽略，不影响冻结主链路 */ } }
      continue;
    }
    allowed.push(lesson);
  }

  return { lessons: allowed, frozen };
}

module.exports = { guardLessonInjection };
