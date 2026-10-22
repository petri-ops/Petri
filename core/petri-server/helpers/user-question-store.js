'use strict';

/**
 * helpers/user-question-store.js — AskUserQuestion 暂停资源（BLOCK-244 Q1-REM C19）。
 *
 * 工具 handler 建问题后返回 `_questionPromise`；loop executor 像 run_tool 的
 * `_ackPromise` 一样 await 该 promise，直到用户经 task 路由回答或超时。
 * 语义：
 * - 任务内内存态，任务结束清理；TTL 默认 5 分钟；
 * - 回答校验：selected 必须是选项 id、multiSelect=false 最多 1 个、text ≤2000；
 * - 超时/任务取消 resolve `{timedOut:true}`，模型收到诚实降级，不伪造回答。
 */

const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TEXT = 2000;
const pending = new Map(); // taskId -> Map(questionId -> entry)

function getTaskStore(taskId) {
  return pending.get(taskId) || null;
}

function normalizeOptions(rawOptions) {
  if (!Array.isArray(rawOptions)) return [];
  return rawOptions.slice(0, 8).flatMap((option) => {
    if (!option || typeof option !== 'object') return [];
    const id = String(option.id || '').trim().slice(0, 64);
    const label = String(option.label || '').trim().slice(0, 120);
    if (!id || !label) return [];
    return [{
      id,
      label,
      ...(option.description ? { description: String(option.description).trim().slice(0, 240) } : {}),
    }];
  });
}

function createUserQuestion(taskId, {
  question,
  options = [],
  multiSelect = false,
  allowFreeText = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!taskId) return { ok: false, error: 'task_required' };
  const text = String(question || '').trim();
  if (!text || text.length > 500) return { ok: false, error: 'invalid_question' };
  const questionId = `q_${crypto.randomBytes(6).toString('hex')}`;
  let resolvePromise = null;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  const finish = (value) => {
    clearTimeout(timer);
    resolvePromise(value);
  };
  const timer = setTimeout(() => {
    const store = getTaskStore(taskId);
    if (store && store.get(questionId)) {
      store.delete(questionId);
      finish({ ok: true, timedOut: true, questionId });
    }
  }, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  timer.unref?.();
  const entry = {
    questionId,
    taskId,
    question: text,
    options: normalizeOptions(options),
    multiSelect: multiSelect === true,
    allowFreeText: allowFreeText !== false,
    createdAt: Date.now(),
    resolve: finish,
    timer,
  };
  const store = getTaskStore(taskId) || new Map();
  store.set(questionId, entry);
  pending.set(taskId, store);
  return { ok: true, questionId, entry, promise };
}

function validateAnswer(entry, answer) {
  if (!entry) return { ok: false, error: 'question_not_found' };
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return { ok: false, error: 'answer_required' };
  }
  const rawSelected = Array.isArray(answer.selected) ? answer.selected : [];
  const allowed = new Set(entry.options.map((option) => option.id));
  const selected = [...new Set(rawSelected.map((value) => String(value)))];
  const unknown = selected.filter((value) => !allowed.has(value));
  if (unknown.length) return { ok: false, error: 'unknown_option', details: unknown.slice(0, 8) };
  if (!entry.multiSelect && selected.length > 1) return { ok: false, error: 'single_select_only' };
  const text = String(answer.text || '').trim().slice(0, MAX_TEXT);
  if (!entry.allowFreeText && text) return { ok: false, error: 'free_text_not_allowed' };
  if (selected.length === 0 && !text) return { ok: false, error: 'empty_answer' };
  return { ok: true, answer: { selected, text } };
}

function answerUserQuestion(taskId, questionId, answer) {
  const store = getTaskStore(taskId);
  const entry = store ? store.get(String(questionId || '')) : null;
  if (!entry) return { ok: false, error: 'question_not_found' };
  const checked = validateAnswer(entry, answer);
  if (!checked.ok) return checked;
  store.delete(entry.questionId);
  entry.resolve({ ok: true, answered: true, questionId: entry.questionId, answer: checked.answer });
  return { ok: true, questionId: entry.questionId, answer: checked.answer };
}

function releaseUserQuestions(taskId) {
  const store = getTaskStore(taskId);
  if (!store) return;
  for (const entry of store.values()) {
    entry.resolve({ ok: true, timedOut: true, cancelled: true, questionId: entry.questionId });
  }
  pending.delete(taskId);
}

function countPendingQuestions(taskId) {
  const store = getTaskStore(taskId);
  return store ? store.size : 0;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_TEXT,
  createUserQuestion,
  answerUserQuestion,
  releaseUserQuestions,
  countPendingQuestions,
};
