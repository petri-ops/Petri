/**
 * BLOCK-113 W1-3：agent loop 工具两跳预路由（决策原语 choice 接点）。
 *
 * 契约（plan docs/block-113-tool-prerouting-plan.md §1.1/§5）：
 *  - 决策必经 helpers/decision-api.js（pin jev-1.13.0）；本模块是下发链唯一分类入口。
 *  - 默认关 + 显式开（D-4，BIOF3_JEV_TOOL_ROUTE=1）：关=零出站零行为变化。
 *  - 类目集（D-1）=tool-defs 九域 + all（弃权=全量下发，路由永不比现行为更差的安全阀）。
 *  - 采纳（argmax≠all 且 confidence ≥ TOOL_ROUTE_THRESHOLD，D-3）→ defs 收窄为
 *    「路由域 ∪ session 基础件」（todo/plan/verify_state/system_info/process_* 为跨域底座）。
 *  - policy 层零变化：本模块只收 defs 下发展示面，agent-tool-policy/accessMode/审批门
 *    照常全量生效；任何失败形态回退全量，永不 throw。
 */
'use strict';

const { askDecision } = require('./decision-api');
const { DOMAIN_TOOL_DEFS, TOOL_DEFS } = require('../agent-tools/tool-defs');

// D-3（P0 校准证据 acceptance/block-113/calibration.json；调整阈值必须先重校准）。
const TOOL_ROUTE_THRESHOLD = 0.8;

/** D-1 九域 + 弃权类目（choice criteria；描述与 tool-defs 物理域一一对应）。 */
const TOOL_FAMILIES = {
  workspace: '项目工作区内的文件读写、搜索、代码编写与脚本执行、数据分析作业',
  knowledge: '知识空间与文档库的检索和管理（搜索、上传、移动、建空间、重建索引）',
  'result-studio': '结果库/结果图表/修订版本/changeset 的操作（打开、对比、采纳、回滚、重跑、生成方法学）',
  browser: '网页浏览、网页搜索、网页内容读取与网页操作',
  computer: 'OS 桌面自动化（截图、点击、键入、滚动本机应用窗口）',
  'agent-orchestration': '子智能体的派发、留言、中断、等待与清单查询',
  remote: '联邦协作节点的跨机任务委托与远程执行',
  resident: '驻留长任务与后台任务的创建、查询、回访',
  session: '会话杂项：系统信息、todo 清单、计划模式、状态校验、进程管理',
  all: '不确定、跨多域的复合任务、目标模糊的任务，或无需工具的纯对话（保守全量下发）',
};

/** 跨域底座：采纳任何特定域时都随行下发（todo/plan/校验/系统信息/进程管理）。 */
const BASELINE_DOMAIN = 'session';

/** D-4：默认关 + 显式开（同 W1-1/W1-2 先例）。 */
function isToolRouteEnabled() {
  return process.env.BIOF3_JEV_TOOL_ROUTE === '1';
}

/** 组装工具路由请求（P0 校准 harness 引用本函数——单源，形状漂移即校准失效）。 */
function buildToolRouteDecisionRequest(message) {
  return {
    state: `用户在 AI 工作台发给 agent 的任务消息：\n${String(message).slice(0, 600)}`,
    questions: {
      family: {
        type: 'choice',
        criteria: { ...TOOL_FAMILIES },
        instructions:
          '判断完成用户消息最可能需要哪个域的工具。单一明确域动作选该域；'
          + '跨多个域的复合任务、目标模糊的任务、或无需工具的纯对话，一律选 all（全量下发，宁全勿缺）。',
      },
    },
  };
}

/**
 * 按路由域收窄工具 defs：路由域 ∪ session 基础件（D-1 动作语义）。
 * 未知名/域映射缺失的工具保守保留（宁全勿缺，收窄只删「明确属于其他域」的）。
 */
function narrowToolDefsByFamily(allDefs, family) {
  if (!DOMAIN_TOOL_DEFS[family]) return allDefs; // 未知域保守回退全量（宁全勿缺）
  const routedDefs = DOMAIN_TOOL_DEFS[family];
  const baselineDefs = DOMAIN_TOOL_DEFS[BASELINE_DOMAIN] || [];
  const allowedNames = new Set([...routedDefs, ...baselineDefs].map((t) => t.function.name));
  // 71 工具中不属于 allowedNames 的按名剔除；schema 内无名的防御保留
  return allDefs.filter((t) => !t.function || !t.function.name || allowedNames.has(t.function.name));
}

/**
 * 分类并判定是否收窄。返回
 * {route: false, reason} | {route: true, family, confidence}；永不 throw。
 */
async function resolveToolRoute(message, overrides = {}) {
  if (!isToolRouteEnabled()) {
    return { route: false, reason: 'guard_disabled' };
  }
  const { state, questions } = buildToolRouteDecisionRequest(message);
  const outcome = await askDecision({ state, questions, overrides });
  if (!outcome.ok) return { route: false, reason: outcome.reason };
  const answer = outcome.answers.family;
  if (answer.choice === 'all') {
    return { route: false, reason: 'family_all', family: 'all', confidence: answer.confidence };
  }
  if (answer.confidence < TOOL_ROUTE_THRESHOLD) {
    return { route: false, reason: 'below_threshold', family: answer.choice, confidence: answer.confidence };
  }
  if (!DOMAIN_TOOL_DEFS[answer.choice]) {
    return { route: false, reason: 'unknown_family', family: answer.choice, confidence: answer.confidence };
  }
  return { route: true, family: answer.choice, confidence: answer.confidence };
}

module.exports = {
  TOOL_ROUTE_THRESHOLD,
  TOOL_FAMILIES,
  BASELINE_DOMAIN,
  isToolRouteEnabled,
  buildToolRouteDecisionRequest,
  narrowToolDefsByFamily,
  resolveToolRoute,
  _fullDefsForTest: TOOL_DEFS,
};
