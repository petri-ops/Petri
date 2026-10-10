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

/** 取接点单阈值（可选 per-model 覆盖；gates 形态接点无单阈值，返回 undefined）。 */
function thresholdForPoint(point, model) {
  const config = configForPoint(point, model);
  return config && typeof config.threshold === 'number' ? config.threshold : undefined;
}

/**
 * 取接点门控配置（BLOCK-118 P0）：per-model 覆盖优先（thresholdsByModel[model]，键=响应体
 * model 字段），未命中回落条目校准默认（threshold 或 gates）。返回 {threshold?}|{gates?}；
 * 未登记点 null。红线：thresholdsByModel 每条必须绑定各自校准证据（block116 契约测试承载），
 * 当前仅 dev-time 接点（test-suggest/doc-suggest）使用——产品运行时五接点条目零漂移。
 */
function configForPoint(point, model) {
  const entry = module.exports[point];
  if (!entry || typeof entry !== 'object') return null;
  const perModel = model != null && entry.thresholdsByModel ? entry.thresholdsByModel[model] : undefined;
  const resolved = perModel !== undefined ? perModel
    : (typeof entry.threshold === 'number' ? entry.threshold : entry.gates);
  if (typeof resolved === 'number') return { threshold: resolved };
  if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) return { gates: { ...resolved } };
  return null;
}

module.exports = {
  thresholdForPoint,
  configForPoint,
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
  // W1-5 增量测试建议（dev-time，BLOCK-115）：Laya 供给校准裁决=不可采纳
  //（confidence/top-probability 双语义均不过门，证据=acceptance/block-118/calibration-test-suggest-laya.json）
  // ——不落 thresholdsByModel（无证据不改阈值红线），Laya 供给下零建议=安全默认。
  'test-suggest': {
    threshold: 0.8,
    evidence: 'acceptance/block-115/calibration.json',
    model: 'jev-1.13.0',
  },
  // BLOCK-118 P1 — doc-suggest 文档回写建议（dev-time）：仅 planDoc 有达标模型门控
  //（θ=0.5：precision 0.8222/coverage 0.8654，Jev 云 150 样本）；uiAudit 走确定性硬规则
  //（frontend/src → 必建议，A 型永不模型化）；roadmap/handoff/auditLog 双供给校准均不可采纳
  //（最优精度≈基础正例率=排序无信息量，v4 证据+三轮 D-修订留痕同目录）——缺键回落 1=永不采纳。
  'doc-suggest': {
    gates: { planDoc: 0.5 },
    evidence: 'acceptance/block-118/calibration-doc-suggest-cloud.json',
    model: 'jev-1.13.0',
  },
  // BLOCK-119 P0 — output-judge 输出评判门（dev-time + P2 试点运行时）：fit 五级量表
  //（score≥fitPass=PASS 区；≥fitRetry=RETRY 区；更低=ESCALATE）。配对语料下界校准
  //（θ=3：precision 0.8254/coverage 0.7875；真实配对 21% 落 retry 区，fail-open+RETRY 语义
  // 承载）。
  // BLOCK-119 加映 2（2026-09-23）— faithful/goal 校准达标落键，升级为可门控：
  // faithfulPass=0.3（noul，precision 0.9455/coverage 0.9286/trap 0.0536，仓内文档锚定
  // 语料 112）、goalPass=0.5（noul，precision 0.8504/coverage 0.9173/trap 0.164，语料
  // 504 判定）。证据=calibration-judge-faithful-goal.json；改键必先重校准（红线）。
  // CK-09 设计结论（2026-09-25）— 本接点**热调不开放**：fitPass/fitRetry 是配对语料
  // 校准的精度/覆盖最优解（非环境适应参数，与 topic-shift 类 [0,1] 接点语义不同）；
  // judge 是质量门——无校准依据的热调=纯风险（调松放行质量降、调紧误拦升），边界
  // 样本由 RETRY/ESCALATE 弹性承载。「改键必先重校准」红线不变，无运行时操作员通道。
  // BLOCK-119 加映 4（2026-09-24）— fitReviewBand=0.5：fit 阈值邻域复核带（|fit−fitPass|
  // ≤band 触发 fit-only 重放 k−1=2 取中位数重建路由；θ 不动）。证据=fit-volatility-review
  // .json（P2 试点同一好汇报 5 判 2.91~3.61 跨 θ 两侧、真负例 ≤0.78 远低于带下界；改带
  // 必先重盘点）。
  'output-judge': {
    gates: { fitPass: 3, fitRetry: 2.5, faithfulPass: 0.3, goalPass: 0.5, fitReviewBand: 0.5 },
    evidence: 'acceptance/block-119/calibration-judge-fit.json',
    evidenceFaithfulGoal: 'acceptance/block-119/calibration-judge-faithful-goal.json',
    evidenceFitVolatility: 'acceptance/block-119/fit-volatility-review.json',
    model: 'jev-1.13.0',
  },
};
