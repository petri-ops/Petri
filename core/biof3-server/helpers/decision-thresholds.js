/**
 * helpers/decision-thresholds.js — BLOCK-116 W2 阈值配置中心（v1：集中声明 + 证据绑定）。
 *
 * 契约（plan docs/block-116-decision-platform-plan.md §2）：
 *  - 每接点 {threshold 或 gates, evidence, model}：evidence 指向校准证据文件，
 *    「改阈值必先重校准」由一致性契约测试机械承载（block116 契约）。
 *  - 各模块常量改为从本注册表取值（re-export 兼容，调用方零改动）。
 *  - W0 两个 noul/双值接点以 gates 形态声明（语义不同不硬归一）。
 *  - v1 无运行时热调：改这里=改代码，走正常校准+评审流程。
 */
'use strict';

/** 取接点单阈值（gates 形态接点无单阈值，返回 undefined——调用方用 gates）。 */
function thresholdForPoint(point) {
  const entry = module.exports[point];
  return entry && typeof entry.threshold === 'number' ? entry.threshold : undefined;
}

module.exports = {
  thresholdForPoint,
  // W0-P1 话题漂移（noul 双阈值三区间：≥YES 切换 / ≤NO 未切换 / 中间带回退大模型）
  'topic-shift': {
    gates: { yes: 0.85, no: 0.5 },
    evidence: 'acceptance/block-110/calibration.json',
    model: 'jev-1.13.0',
  },
  // W0-P2 知识库二跳（is_relevant<0.5 丢弃 / has_injection≥0.70 拦截；fail-open）
  'knowledge-guard': {
    gates: { relevantMin: 0.5, injectionMax: 0.7 },
    evidence: 'acceptance/block-110/calibration.json',
    model: 'jev-1.13.0',
  },
  // W1-1 marker→细胞类型判别（单阈值）
  'marker-celltype': {
    threshold: 0.55,
    evidence: 'acceptance/block-111/calibration.json',
    model: 'jev-1.13.0',
  },
  // W1-2 copilot 意图路由
  'intent-route': {
    threshold: 0.7,
    evidence: 'acceptance/block-112/calibration.json',
    model: 'jev-1.13.0',
  },
  // W1-3 工具两跳预路由
  'tool-route': {
    threshold: 0.8,
    evidence: 'acceptance/block-113/calibration.json',
    model: 'jev-1.13.0',
  },
  // W1-4 测试失败归因（L3 残差层）
  'failure-triage': {
    threshold: 0.7,
    evidence: 'acceptance/block-114/calibration.json',
    model: 'jev-1.13.0',
  },
  // W1-5 增量测试建议
  'test-suggest': {
    threshold: 0.8,
    evidence: 'acceptance/block-115/calibration.json',
    model: 'jev-1.13.0',
  },
};
