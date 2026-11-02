'use strict';

/**
 * helpers/loop-decision.js — BLOCK-335 P0 判据驱动驾驶员（纯函数，零 IO）。
 *
 * 把 loop-orchestrator 每轮迭代的 decision 瀑布抽出来，并接入「验证器投票」：
 * 模型自报 complete 不再单独有效——complete 必须附结构化验证结果（verify 原语产出），
 * 验证红 → 强制 retry（连续上限 MAX_VERIFY_RETRIES）→ block（宁慢勿腐，不得宣称 ready）。
 * 验证器不在场（verifyVote=null）= 现状语义逐字节不变（未接线的任务零行为变化）。
 *
 * 红线：不建第二执行器/第二验证器；投票失败（verifier 抛错/不可用）如实返回
 * { verdict:'unavailable' }，本函数按「无投票」处理——由闭环外层的 phase 级 verify 兜底，
 * 这里不把验证器故障伪装成绿。
 */

const MAX_VERIFY_RETRIES = 2;

const VERIFY_VERDICTS = Object.freeze(['ready', 'blocked', 'needs_restart', 'unavailable']);

/**
 * 迭代决策瀑布（优先级与 loop-orchestrator 原实现逐条对齐，勿改序）：
 *   假成功 → block；需用户输入 → wait；失败未解 → retry；任务在跑 → continue；
 *   模型收尾 → 【验证器投票】全绿才 complete，红则 retry≤cap→block。
 * @param {object} input
 * @param {number} input.falseSuccessJobsCount 假成功任务数
 * @param {boolean} input.requiresUserDecision 关键输入未确认
 * @param {number} input.unresolvedFailedJobsCount 失败未解任务数
 * @param {number} input.activeJobsCount 运行中任务数
 * @param {boolean} input.modelFinalized 模型收尾（自报无后续工具调用）
 * @param {boolean} input.noActivities 本轮无工具活动
 * @param {{verdict:string, detail?:string}|null} input.verifyVote 验证器投票（null=无验证器）
 * @param {number} input.verifyRedStreak 跨迭代连续验证红计数
 * @param {object} input.reasonCodes REASON_CODES（loop-contract 注入，纯函数不 require）
 * @returns {{decision:string, decisionReasonCode:string, publicConclusion:string|null, verifyVoteConsumed:boolean}}
 */
function decideIterationOutcome(input = {}) {
  const {
    falseSuccessJobsCount = 0,
    requiresUserDecision = false,
    unresolvedFailedJobsCount = 0,
    activeJobsCount = 0,
    modelFinalized = false,
    noActivities = false,
    verifyVote = null,
    verifyRedStreak = 0,
    reasonCodes,
  } = input;
  const CODES = reasonCodes || {};
  const consumed = { verifyVoteConsumed: false };

  if (falseSuccessJobsCount > 0) {
    return {
      decision: 'block',
      decisionReasonCode: CODES.ARTIFACT_VALIDATION_FAILED,
      publicConclusion: `检测到假成功：任务失败但产生了文件（${falseSuccessJobsCount} 个）。已验证结果不完整，禁止宣称完成。`,
      ...consumed,
    };
  }
  if (requiresUserDecision) {
    return {
      decision: 'wait',
      decisionReasonCode: CODES.USER_INPUT_REQUIRED,
      publicConclusion: '关键输入或科学设计尚未确认；系统未创建非法 Job，等待补齐必要信息。',
      ...consumed,
    };
  }
  if (unresolvedFailedJobsCount > 0) {
    return {
      decision: 'retry',
      decisionReasonCode: CODES.TRANSIENT_RUNTIME_RETRY,
      publicConclusion: `工具执行失败（${unresolvedFailedJobsCount} 个）。Loop Controller 将在下一轮决策中处理。`,
      ...consumed,
    };
  }
  if (activeJobsCount > 0) {
    return { decision: 'continue', decisionReasonCode: CODES.TOOL_SUCCEEDED, publicConclusion: `工具执行中（${activeJobsCount} 个运行中）。继续监控。`, ...consumed };
  }
  if (modelFinalized || noActivities) {
    // BLOCK-335 P0 — 验证器投票：complete 需要结构化验证背书。
    // 'unavailable'（验证器缺席/故障）= 无投票 → 现状语义（闭环外 phase 级 verify 兜底），
    // 不把验证器故障伪装成红也不伪装成绿。
    if (verifyVote && typeof verifyVote.verdict === 'string'
      && verifyVote.verdict !== 'unavailable'
      && VERIFY_VERDICTS.includes(verifyVote.verdict)) {
      consumed.verifyVoteConsumed = true;
      const detail = String(verifyVote.detail || '').slice(0, 200);
      if (verifyVote.verdict === 'needs_restart') {
        return {
          decision: 'block',
          decisionReasonCode: CODES.VERIFY_RESTART_REQUIRED,
          publicConclusion: `改动域触及需重启面（${detail || '详见验证报告'}），本进程内无法验证；如实留人工。`,
          ...consumed,
        };
      }
      if (verifyVote.verdict !== 'ready') {
        if (verifyRedStreak < MAX_VERIFY_RETRIES) {
          return {
            decision: 'retry',
            decisionReasonCode: CODES.VERIFY_RED_RETRY,
            publicConclusion: `验证红：结构化验证未通过（${detail || '详见验证报告'}）。第 ${verifyRedStreak + 1} 次自动重试（上限 ${MAX_VERIFY_RETRIES} 次），模型自报完成不被采纳。`,
            ...consumed,
          };
        }
        return {
          decision: 'block',
          decisionReasonCode: CODES.VERIFY_RED_BLOCK,
          publicConclusion: `验证红且连续重试已达上限（${verifyRedStreak} 次）：禁止宣称 ready，转人工复盘（${detail || '详见验证报告'}）。`,
          ...consumed,
        };
      }
    }
    return {
      decision: 'complete',
      decisionReasonCode: CODES.GOAL_ACHIEVED,
      publicConclusion: modelFinalized ? '已根据真实工具与产物状态完成本轮交付。' : '本轮无工具调用，已整理最终答复。',
      ...consumed,
    };
  }
  return { decision: 'continue', decisionReasonCode: CODES.TOOL_SUCCEEDED, publicConclusion: '', ...consumed };
}

module.exports = {
  MAX_VERIFY_RETRIES,
  VERIFY_VERDICTS,
  decideIterationOutcome,
};
