'use strict';

/**
 * agent-tools/ask-user-tools.js — ask_user_question（BLOCK-244 Q1-REM C19）。
 *
 * 结构化提问：模型提出 question + 最多 8 个选项（可多选/可自由输入）。
 * handler 返回 `_questionPromise`；loop executor await 用户回答（或超时）后
 * 把 answered/timedOut 写回同一 callId 的工具结果，模型在同一轮拿到答案。
 * 无 taskId（直接调用/测试）时 fail-closed，不伪造回答。
 */

const { createUserQuestion } = require('../helpers/user-question-store');

const MAX_QUESTION = 500;
const MAX_OPTIONS = 8;

async function tool_ask_user_question(args = {}, ctx = {}) {
  const question = String(args.question || '').trim();
  if (!question || question.length > MAX_QUESTION) {
    return {
      ok: false,
      error: 'invalid_arguments',
      message: `question 必须是 1-${MAX_QUESTION} 字符。`,
    };
  }
  if (args.options !== undefined && !Array.isArray(args.options)) {
    return { ok: false, error: 'invalid_arguments', message: 'options 必须是数组。' };
  }
  const rawOptions = Array.isArray(args.options) ? args.options.slice(0, MAX_OPTIONS) : [];
  for (const option of rawOptions) {
    if (!option || typeof option !== 'object' || !String(option.id || '').trim() || !String(option.label || '').trim()) {
      return { ok: false, error: 'invalid_arguments', message: '每个选项必须包含 id 与 label。' };
    }
  }
  const created = createUserQuestion(ctx.taskId, {
    question,
    options: rawOptions,
    multiSelect: args.multiSelect === true,
    allowFreeText: args.allowFreeText !== false,
  });
  if (!created.ok) {
    return {
      ok: false,
      error: created.error,
      message: created.error === 'task_required'
        ? '结构化提问需要有效任务上下文。'
        : '问题无法创建（请检查 question/options）。',
    };
  }
  return {
    ok: true,
    needQuestion: true,
    questionId: created.questionId,
    question: created.entry.question,
    options: created.entry.options,
    multiSelect: created.entry.multiSelect,
    allowFreeText: created.entry.allowFreeText,
    message: '已向用户提出结构化问题，等待回答。',
    _questionPromise: created.promise,
  };
}

module.exports = { tool_ask_user_question };
