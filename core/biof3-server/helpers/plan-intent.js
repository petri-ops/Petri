/**
 * helpers/plan-intent.js — 自动计划意图识别（纯函数）
 *
 * 来源：BLOCK-60 加映三（UI-291）在 legacy SSE 路径的意图触发；P1.4 legacy 物理退役时
 * 确认该特性 task 模式从未实现（死特性，候选登记「自动计划意图恢复」，2026-09-21 用户
 * 裁决恢复）。本模块按原正则与否定剥离规则 1:1 移植，语义与旧块60测试向量兼容；
 * 差异：探测目标改为**最近一条**用户消息（当前轮输入）——旧实现取首条属顺带行为。
 */

const WANTS_PLAN_RE = /(先|只|别|不要)[^。\n]{0,8}(计划|规划|方案|讨论|想法)|先出(一?个)?(方案|计划)|先别(急着)?(执行|做|动手)|不要(直接)?(执行|动手|开跑)|给我(一?个)?(方案|计划)|planning mode|plan first|don.?t execute/i;
// 否定式执行短语（不要执行/别直接跑/先别动手）属计划意图：否定词连同其后紧邻的
// 执行短语一并剥除，避免「不要直接执行」被误判为执行意图。
const NEGATED_EXEC_RE = /(不要|别|先别)[^，。；,;\n]{0,6}(执行|跑|动手|开跑|做|开始)/g;
const WANTS_EXECUTE_RE = /(直接|立即|马上)(执行|跑|做|开始)|开干|开始执行|直接跑/i;

/**
 * 判定用户消息是否表达「先计划后执行」类意图。
 * @returns {boolean} true = 本轮应自动套用计划模式纪律（纯讨论 + 只留计划工具）
 */
function detectAutoPlanIntent(firstUserText) {
  const text = String(firstUserText || '');
  if (!text) return false;
  const wantsPlan = WANTS_PLAN_RE.test(text);
  const execProbe = text.replace(NEGATED_EXEC_RE, '');
  const wantsExecute = WANTS_EXECUTE_RE.test(execProbe);
  return wantsPlan && !wantsExecute;
}

/** 取消息数组中最近一条用户消息文本（无则空串）。 */
function latestUserText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') return String((m && m.content) || '');
  }
  return '';
}

module.exports = { detectAutoPlanIntent, latestUserText, WANTS_PLAN_RE, WANTS_EXECUTE_RE };
