'use strict';

/**
 * helpers/lesson-render.js — EVO-2 selfEvolution prompt 段渲染（照 renderWorkingTreeRejectsForPrompt 模板）。
 * 纯函数：lessons 数组 → 有界 prompt 段；空数组零注入；逐条预算递减；超长截断标注。
 * 段内只放可执行的行为修正（action），不含事实/数据/统计方法（照 loop-repair-strategy ALLOW 边界）。
 */
const { LESSON_LIMITS } = require('../../shared-backend/lesson-distiller.js');

const SELF_EVOLUTION_BLOCK_TAG = '=== 自进化经验（harness 从本机历史失败中学到的行为修正，仅提示非事实） ===';

/**
 * 把活跃 lessons 渲染成 prompt 段。
 * @param {Array<object>} lessons
 * @returns {string} 空数组返回 ''；否则返回以两个换行开头的有界段
 */
function renderSelfEvolutionForPrompt(lessons = []) {
  if (!Array.isArray(lessons) || lessons.length === 0) return '';
  const entries = lessons
    .filter((l) => l && typeof l.action === 'string' && l.action.trim())
    .slice(0, LESSON_LIMITS.maxPromptEntries);
  if (entries.length === 0) return '';

  let block = '\n\n' + SELF_EVOLUTION_BLOCK_TAG;
  block += '\n- 以下为本机 harness 从过往失败中沉淀的行为修正；仅调整做法，不改动任何事实、数据或统计方法。';
  block += '\n- 若当前任务与某条经验适用条件不符，忽略即可；用户否决过的方向以用户为准。';
  let budget = LESSON_LIMITS.maxPromptChars - block.length;
  for (const l of entries) {
    if (budget <= 0) break;
    const title = typeof l.title === 'string' ? l.title.replace(/\s+/g, ' ').slice(0, 80) : '(untitled)';
    const action = typeof l.action === 'string' ? l.action.replace(/\s+/g, ' ').slice(0, 400) : '';
    const confidence = Number.isFinite(l.confidence) ? l.confidence.toFixed(2) : '?';
    let line = `\n- [${l.scope || '?'}·置信${confidence}] ${title} → ${action}`;
    if (line.length > budget) line = line.slice(0, Math.max(0, budget - 4)) + ' …';
    block += line;
    budget -= line.length;
  }
  return block;
}

module.exports = { SELF_EVOLUTION_BLOCK_TAG, renderSelfEvolutionForPrompt };
