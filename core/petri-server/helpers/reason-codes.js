/**
 * helpers/reason-codes.js — BLOCK-324 统一结构化原因码 taxonomy。
 *
 * 封闭 REASONS 注册表（借鉴 dsh-superagent REASONS 形态，长在 Petri 治理审计面上）：
 *   code → { category, template }；template 用 {placeholder} 占位，renderReason 渲染。
 *
 * 纪律：
 *  - 封闭集 + 注册即扩：新场景先注册再用；agent-tool-policy 的 deny/allow 首参字面量
 *    由源码扫描契约测试锁死（test/block324-reason-taxonomy.test.mjs）——新增未注册即红。
 *  - 加性接线零行为变更：既有 deny 信封的 reason/error/message/messageKey 字段不动；
 *    本表是审计渲染词表（permission.auto_allowed 事件 reasonText / REST 词表出口），
 *    不是 UI 文案替换源。
 *  - decision_log 的 reason 是 AI 决策自由文本，语义不同，不归并（BLOCK-324 plan reopen）。
 */

'use strict';

/** category 封闭集（新增类别需先扩此表并在测试对账）。 */
const REASON_CATEGORIES = Object.freeze([
  'governance', // 治理面：用户规则/动态防护/MCP 信任/工具策略/循环防护
  'mode',       // 档位与模式：plan/read/workspace-write/只读请求
  'workspace',  // 项目工作区：前置校验/授权
  'data',       // 数据完整性：源数据不可变/sha 门
  'schema',     // 参数校验
  'autonomy',   // 放权坡道（BLOCK-323）：观察/自动放行
  'provider',   // 模型提供者/上游通信（BLOCK-338）：流式停滞等上游侧异常
]);

const REASONS = Object.freeze({
  // —— 判定序第一层：未知工具 ——
  unknown_tool: { category: 'governance', template: '未知工具 {tool}，拒绝执行。' },
  // —— 判定序第二层：用户规则（BLOCK-160 ORC-1）——
  user_rule_denied: { category: 'governance', template: '用户规则「{ruleId}」拒绝此调用。' },
  user_rule_require_ack: { category: 'governance', template: '用户规则「{ruleId}」要求先确认（guardKey={guardKey}）。' },
  // —— 判定序第三层：动态防护（ORC-2）——
  dynamic_guard: { category: 'governance', template: '动态防护拦截：{detail}（guardKey={guardKey}）。' },
  // —— 判定序第四层：MCP 服务信任位（BLOCK-243 Q1）——
  mcp_trust_required: { category: 'governance', template: 'MCP 服务「{serverId}」信任位为 ask 且工具声明破坏性，需确认。' },
  // —— 判定序第五层：逐工具审批策略（BLOCK-244 A1/A8）——
  tool_denied_by_policy: { category: 'governance', template: '工具「{tool}」被审批策略设为拒绝。' },
  tool_approval_required: { category: 'governance', template: '工具「{tool}」被审批策略设为每次询问，需确认。' },
  // —— 判定序第六层：循环防护（BLOCK-244 A5）——
  loop_guard: { category: 'governance', template: '循环防护：连续 {count} 次相同调用，可能陷入循环。' },
  // —— 档位/模式闸（plan 模式、四档 accessMode、只读请求）——
  read_only: { category: 'mode', template: '当前模式禁止执行有副作用操作：{detail}' },
  // —— 安全策略/preflight 族 ——
  policy_denied: { category: 'governance', template: '安全策略拒绝：{detail}' },
  project_required: { category: 'workspace', template: '该工具需要有效项目工作区。' },
  permission_denied: { category: 'workspace', template: '无权访问该项目工作区（{detail}）。' },
  invalid_arguments: { category: 'schema', template: '工具参数无效：{detail}' },
  // —— 数据完整性 ——
  source_data_immutable: { category: 'data', template: '科学源数据不可原地修改，请在 derived/ 或 results/ 下派生。' },
  expected_sha256_required: { category: 'data', template: '覆写/替换已有文件前必须先读取并传入 expectedSha256。' },
  overwrite_requires_sha256: { category: 'data', template: '完整覆写已有文件前必须先读取文件，并传入 overwrite=true 和 expectedSha256。' },
  replace_requires_sha256: { category: 'data', template: '文本替换前必须先读取文件并传入 expectedSha256。' },
  // —— 放行结果（audit 词表）——
  policy_allowed: { category: 'governance', template: '策略放行（默认档位）。' },
  delegated_approval: { category: 'governance', template: '插件委托执行（下游白名单内）。' },
  // —— 放权坡道（BLOCK-323）——
  rule_auto_allow: { category: 'autonomy', template: '规则「{ruleId}」放行档自动执行，未经逐次确认。' },
  // —— 上游通信（BLOCK-338 流式 stall 看门狗）——
  stream_stalled: {
    category: 'provider',
    template: '模型流式响应停滞（{phase}，{elapsedMs}ms 无有效输出），已中止本次调用。',
  },
});

/** 渲染原因文本：{placeholder} 按 values 替换；未注册 code 走诚实的回退文本。 */
function renderReason(code, values = {}) {
  const entry = REASONS[code];
  if (!entry) {
    return `未注册原因码「${String(code)}」（应在 reason-codes.js 注册后再用）。`;
  }
  return String(entry.template).replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, key) => {
    const value = values[key];
    return value === undefined || value === null ? match : String(value);
  });
}

function isRegisteredReason(code) {
  return Object.prototype.hasOwnProperty.call(REASONS, String(code));
}

/** 词表出口（REST /api/ai/reason-codes）：code + category + template。 */
function listReasonCodes() {
  return Object.entries(REASONS).map(([code, entry]) => ({
    code,
    category: entry.category,
    template: entry.template,
  }));
}

module.exports = {
  REASON_CATEGORIES,
  REASONS,
  renderReason,
  isRegisteredReason,
  listReasonCodes,
};
