/**
 * QODER-J2 P1 — 技能自进化建议投影器（2026-11-23）。
 *
 * 用户发令「开始 J2」；D1=本地 lessons 审计为源（listLessonEvidence 只读输出），
 * D2=不自动建任务（建议只出草案，用户一键才触发既有任务创建链）。
 *
 * 零新依赖：纯函数，输入 lessons + availableSkillIds + ignored 账本，输出建议列表。
 * 红线：不改内置 skill 资产（manifest 带 sha256）、不自动落盘 skill、不伪造归因。
 */
'use strict';

const TIER = 'draft'; // 建议一律草案档：只出 prompt 草案，不自动执行/落盘。

/** action/title 关键词 → skill id 归因（保守：无匹配则不产出建议，不伪造）。 */
const SKILL_HINTS = {
  'script-host': ['参数校验', '脚本', 'script', '校验模板', 'runtime'],
  'coding-playbook': ['工具描述', 'description', '示例', '编码规范', 'review'],
  'paper-writing': ['论文', '改写', '保真', '引用', 'prose'],
  'capability-intake': ['能力扩展', 'provenance', '版权', '内化'],
};

function attributeSkill(lesson, availableSkillIds = []) {
  const haystack = `${lesson.action || ''} ${lesson.title || ''}`.toLowerCase();
  for (const skillId of availableSkillIds) {
    const hints = Object.entries(SKILL_HINTS).find(([k]) => k === skillId)?.[1] || [];
    if (hints.some((hint) => haystack.includes(String(hint).toLowerCase()))) return skillId;
  }
  return null;
}

/**
 * lessons → 建议列表。
 * @param {{lessons?:Array, availableSkillIds?:Array<string>, ignored?:Record<string,object>, limit?:number}} input
 * @returns {{ok:true, suggestions:Array, ignoredCount:number, total:number, tier:'draft', autoApply:false}}
 */
function projectSkillSuggestions(input = {}) {
  const lessons = Array.isArray(input.lessons) ? input.lessons : [];
  const availableSkillIds = Array.isArray(input.availableSkillIds)
    ? input.availableSkillIds.filter((id) => typeof id === 'string' && id) : [];
  const ignored = input.ignored && typeof input.ignored === 'object' ? input.ignored : {};
  const limit = Number.isFinite(input.limit) && input.limit > 0 ? Math.min(input.limit, 50) : 20;
  const suggestions = [];
  let ignoredCount = 0;

  for (const lesson of lessons) {
    const fingerprint = String(lesson.sourceFingerprint || '');
    if (!fingerprint) continue;
    if (Object.prototype.hasOwnProperty.call(ignored, fingerprint)) {
      ignoredCount += 1;
      continue;
    }
    const skillId = attributeSkill(lesson, availableSkillIds);
    if (!skillId) continue; // 无可用 skill 归因 → 不伪造建议
    if (String(lesson.status || 'active') !== 'active') continue;
    const action = String(lesson.action || '').trim();
    suggestions.push({
      sourceFingerprint: fingerprint,
      skillId,
      title: String(lesson.title || '').slice(0, 200),
      action,
      scope: lesson.scope === 'auto' || lesson.scope === 'ack' ? lesson.scope : 'draft',
      confidence: Number.isFinite(lesson.confidence) ? lesson.confidence : null,
      evidence: { before: Number(lesson.before) || 0, after: Number(lesson.after) || 0, verdict: lesson.verdict || null },
      tier: TIER,
      autoApply: false,
      // 一键建任务的草案 prompt：用户显式触发才走既有 createAgentTask 链。
      prompt: `请针对技能「${skillId}」处理以下自进化建议：${action}。仅生成操作草案，改动须经既有治理门审批。`,
    });
    if (suggestions.length >= limit) break;
  }

  return {
    ok: true,
    suggestions,
    ignoredCount,
    total: suggestions.length,
    tier: TIER,
    autoApply: false,
  };
}

module.exports = { TIER, SKILL_HINTS, attributeSkill, projectSkillSuggestions };
