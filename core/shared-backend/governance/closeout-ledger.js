'use strict';

/**
 * shared-backend/governance/closeout-ledger.js — BLOCK-337 P5 收口自动落账（纯函数渲染）。
 *
 * 收口 phase 用 closeout 原语全绿后，由宿主把本模块渲染的三块**草稿**带进返回值 /
 * journal：NEXT-STEP-BRIEF 固定块 + AUDIT-LOG 处理记录行 + handoff 恢复要点。
 * 红线：模板只填机械槽位，人可读视图不变——判断与裁决（建议措辞、状态判定、归属）
 * 仍由人写；槽位缺失渲染 '<待补：slot>' 占位，绝不编造事实。
 */

const MAX_SLOT_CHARS = 1200;

function slot(value, name) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return `<待补：${name}>`;
  return text.length > MAX_SLOT_CHARS ? `${text.slice(0, MAX_SLOT_CHARS)}…` : text;
}

/** NEXT-STEP-BRIEF 固定块（petri-project-governance skill「固定模板」节的槽位形态）。 */
function renderNextStepBrief(input = {}) {
  const bp = input.blueprint && typeof input.blueprint === 'object' ? input.blueprint : {};
  return [
    `Jev 单一建议：${slot(input.suggestion, 'suggestion')}`,
    `母纲波次顺序：${slot(input.waveOrder, 'waveOrder')}`,
    '蓝图 / 全局计划进展：',
    `- 母纲 Q-MATRIX：${slot(bp.qMatrix, 'blueprint.qMatrix')}`,
    `- 竞争力纲 / 成熟度蓝图：${slot(bp.competitiveness, 'blueprint.competitiveness')}`,
    `- Result Studio：${slot(bp.resultStudio, 'blueprint.resultStudio')}`,
    `- UI 台账：${slot(bp.uiLedger, 'blueprint.uiLedger')}`,
    `- 当前 active 工作包：${slot(bp.activePackages, 'blueprint.activePackages')}`,
  ].join('\n');
}

/** AUDIT-LOG「最近处理记录」表行（四列：状态+事项 / 日期 / 详情 / 归属）。 */
function renderAuditLogRow(input = {}) {
  const detail = slot(input.detail, 'detail').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return `| ${slot(input.headline, 'headline')} | ${slot(input.date, 'date')} | ${detail} | ${slot(input.domain, 'domain')} |`;
}

/** handoff 恢复要点（要点式，槽位固定）。 */
function renderHandoffResume(input = {}) {
  return [
    `- 工作包：${slot(input.packageId, 'packageId')}`,
    `- 阶段：${slot(input.phase, 'phase')}`,
    `- 恢复入口：${slot(input.entry, 'entry')}`,
    `- 证据：${slot(input.evidence, 'evidence')}`,
  ].join('\n');
}

/** 三块草稿一次渲染（closeout 宿主原语的 ledger 载荷入口）。 */
function renderCloseoutLedgerDraft(input = {}) {
  return {
    nextStepBrief: renderNextStepBrief(input.nextStepBrief),
    auditLogRow: renderAuditLogRow(input.auditLogRow),
    handoffResume: renderHandoffResume(input.handoffResume),
  };
}

module.exports = {
  renderNextStepBrief,
  renderAuditLogRow,
  renderHandoffResume,
  renderCloseoutLedgerDraft,
};
