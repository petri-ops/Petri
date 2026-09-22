/**
 * BLOCK-112 W1-2：copilot 发送前意图路由（决策原语 choice 接点）。
 *
 * 契约（plan docs/block-112-copilot-intent-routing-plan.md §2/§6）：
 *  - 决策必经 helpers/decision-api.js（pin jev-1.13.0）；本模块是提交链唯一分类入口。
 *  - 默认关 + 显式开（D-4，BIOF3_JEV_INTENT_ROUTE=1）：关=零出站零行为变化。
 *  - 分流仅当 argmax=chitchat 且 confidence ≥ INTENT_ROUTE_THRESHOLD（D-3 单阈值，
 *    P0 校准证据 acceptance/block-112/calibration.json；调整阈值必须先重校准）。
 *  - 任何失败形态（缺 key/超时/校验失败）一律返回 fastPath=false，调用方走现行
 *    runAgentLoop；本模块永不 throw。
 */
'use strict';

const { askDecision } = require('./decision-api');

// D-3（P0 校准：θ=0.70 时 chitchatRecall=1.0 / precision=1.0 / taskFalseAdoption=0，
// 留轮间漂移余量；证据 acceptance/block-112/calibration.json）。
const INTENT_ROUTE_THRESHOLD = 0.7;

/** D-1 四类意图 wire 契约（choice criteria；动作面 PoC 只挂 chitchat，其余维持现行 loop）。 */
const INTENT_CLASSES = {
  chitchat: '闲聊寒暄、情绪陪伴、致谢、身份或能力闲问等纯对话诉求，无任何数据/文件/工具动作',
  task: '对数据/文件/项目/分析/代码有执行诉求（跑、画、建、改、修、导出等）',
  knowledge_qa: '概念/方法/原理的纯解释性或选型咨询提问，无执行动作',
  result_studio: '对既有结果/图表/版本/运行状态的操作指令与查询（打开、导出、切换、重跑、存修订、查进度）',
};

/** D-4：默认关 + 显式开（同 W1-1/W0-P2 先例）。 */
function isIntentRouteEnabled() {
  return process.env.BIOF3_JEV_INTENT_ROUTE === '1';
}

/** 组装意图分类请求（P0 校准 harness 引用本函数——单源，形状漂移即校准失效）。 */
function buildIntentDecisionRequest(message) {
  return {
    state: `用户在 AI 工作台聊天框发送的消息：\n${String(message).slice(0, 600)}`,
    questions: {
      intent: {
        type: 'choice',
        criteria: { ...INTENT_CLASSES },
        instructions:
          '判断用户消息的主要意图类别。消息同时含问候/致谢与执行诉求时以执行诉求为准（task）；'
          + '纯概念解释、选型或结果解读咨询且无操作指令为 knowledge_qa；'
          + '对既有结果/版本/运行状态的操作与查询为 result_studio；'
          + '全部诉求可由纯对话满足（寒暄、陪伴、致谢、身份或能力闲问）为 chitchat。',
      },
    },
  };
}

/**
 * 分类最近一条用户消息。返回 {ok, intent?, confidence?, elapsedMs?} | {ok:false, reason}；
 * 永不 throw，!ok 即调用方走现行 runAgentLoop。
 */
async function classifyUserIntent(message, overrides = {}) {
  const { state, questions } = buildIntentDecisionRequest(message);
  const outcome = await askDecision({ state, questions, overrides });
  if (!outcome.ok) return { ok: false, reason: outcome.reason };
  const answer = outcome.answers.intent;
  return { ok: true, intent: answer.choice, confidence: answer.confidence, elapsedMs: outcome.elapsedMs };
}

/**
 * 提交链分流判定：true 才走 chitchat 快路径。
 * 返回 {fastPath, reason, intent?, confidence?, decisioned}——decisioned=false 表示未出站
 * （guard 关）或决策失败（no_key/timeout 等），调用方无需区分处理、一律走现行 loop。
 */
async function shouldUseChitchatFastPath(message, overrides = {}) {
  if (!isIntentRouteEnabled()) {
    return { fastPath: false, reason: 'guard_disabled', decisioned: false };
  }
  const verdict = await classifyUserIntent(message, overrides);
  if (!verdict.ok) {
    return { fastPath: false, reason: verdict.reason, decisioned: false };
  }
  const { intent, confidence } = verdict;
  if (intent === 'chitchat' && confidence >= INTENT_ROUTE_THRESHOLD) {
    return { fastPath: true, reason: 'adopted', intent, confidence, decisioned: true };
  }
  return {
    fastPath: false,
    reason: intent === 'chitchat' ? 'below_threshold' : `intent_${intent}`,
    intent,
    confidence,
    decisioned: true,
  };
}

module.exports = {
  INTENT_ROUTE_THRESHOLD,
  INTENT_CLASSES,
  isIntentRouteEnabled,
  buildIntentDecisionRequest,
  classifyUserIntent,
  shouldUseChitchatFastPath,
};
