'use strict';

/**
 * agent-tools/decision-tools.js — BLOCK-116 W2（全局待办 BK-04）agent 可见决策工具。
 *
 * 决策台账（decision_log）的只读查询面：模型可在会话内自查决策系统运行情况
 * （按接点聚合统计 / 最近判定逐条回放）。数据源单源=helpers/decision-log.js
 * （summarizeDecisions/recentDecisions，与设置面板 REST /api/ai/decisions/* 同源
 * 直调，不走 HTTP 自环）。
 *
 * 诚实边界：
 *  - 只读观测——阈值/供给配置的变更面（设置页 PUT 通道）不对模型开放；
 *    「改阈值必先重校准」红线不因工具面存在而改变。
 *  - DB 不可用=available:false 如实回传（与 REST 面同语义），不伪造空统计。
 *  - statePreview 为决策输入摘要（与 UI 逐条回放面同界）：用户本人会话内自查
 *    本人数据，越权面不存在。
 */

const decisionLog = require('../helpers/decision-log');

/**
 * decision_summary — 按接点聚合统计（调用量/均延迟/降级率/最近判定时间）。
 * @param {{days?: number}} args
 */
async function tool_decision_summary(args) {
  const days = Math.min(Math.max(parseInt(args && args.days, 10) || 7, 1), 90);
  const summary = await decisionLog.summarizeDecisions({ days });
  if (summary === null) {
    return { ok: true, available: false, days, points: [], message: '决策台账当前不可用（DB 未就绪），无统计可读。' };
  }
  const totalCalls = summary.reduce((acc, p) => acc + (p.calls || 0), 0);
  return {
    ok: true,
    available: true,
    days,
    points: summary,
    totalCalls,
    message: `最近 ${days} 天决策台账：${summary.length} 个接点、共 ${totalCalls} 次判定${summary.length ? `（最忙接点=${summary[0].point}）` : ''}。`,
  };
}

/**
 * decision_recent — 最近判定逐条回放（可按接点过滤）。
 * @param {{limit?: number, point?: string}} args
 */
async function tool_decision_recent(args) {
  const limit = Math.min(Math.max(parseInt(args && args.limit, 10) || 10, 1), 20);
  const point = typeof (args && args.point) === 'string' && args.point.trim()
    ? args.point.trim().slice(0, 64)
    : undefined;
  const recent = await decisionLog.recentDecisions({ limit, point });
  if (recent === null) {
    return { ok: true, available: false, decisions: [], message: '决策台账当前不可用（DB 未就绪）。' };
  }
  return {
    ok: true,
    available: true,
    count: recent.length,
    decisions: recent,
    message: `返回最近 ${recent.length} 条判定${point ? `（接点=${point}）` : ''}；含判定值/置信度/阈值/是否降级/耗时。`,
  };
}

module.exports = { tool_decision_summary, tool_decision_recent };
