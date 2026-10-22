/**
 * BLOCK-244 — AskUserQuestion store + 工具契约（红绿先行）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const store = require(resolve(root, 'core/petri-server/helpers/user-question-store.js'));
const { tool_ask_user_question } = require(resolve(root, 'core/petri-server/agent-tools/ask-user-tools.js'));

test('BLOCK-244 提问 store：创建/回答唤醒/只能回答一次', async () => {
  const created = store.createUserQuestion('b244-q1', {
    question: '选择目标？',
    options: [{ id: 'deg', label: 'DEG' }, { id: 'gsea', label: 'GSEA' }],
  });
  assert.equal(created.ok, true);
  assert.ok(created.questionId.startsWith('q_'));
  const answered = store.answerUserQuestion('b244-q1', created.questionId, { selected: ['deg'], text: '' });
  assert.equal(answered.ok, true);
  const wake = await created.promise;
  assert.deepEqual(wake.answer, { selected: ['deg'], text: '' });
  assert.equal(store.answerUserQuestion('b244-q1', created.questionId, { selected: ['gsea'], text: '' }).error, 'question_not_found');
});

test('BLOCK-244 提问 store：非法回答保持 pending，修正后可回答', async () => {
  const created = store.createUserQuestion('b244-q2', {
    question: '单选',
    options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    multiSelect: false,
  });
  assert.equal(store.answerUserQuestion('b244-q2', created.questionId, { selected: ['a', 'b'] }).error, 'single_select_only');
  assert.equal(store.answerUserQuestion('b244-q2', created.questionId, { selected: ['x'] }).error, 'unknown_option');
  assert.equal(store.answerUserQuestion('b244-q2', created.questionId, { selected: [], text: '' }).error, 'empty_answer');
  assert.equal(store.answerUserQuestion('b244-q2', created.questionId, { selected: ['a'], text: '' }).ok, true);
  const wake = await created.promise;
  assert.deepEqual(wake.answer.selected, ['a']);
});

test('BLOCK-244 提问 store：超时/释放如实降级', async () => {
  const timed = store.createUserQuestion('b244-q3', { question: '会超时吗？', timeoutMs: 1000 });
  const wake = await timed.promise;
  assert.equal(wake.timedOut, true);

  const released = store.createUserQuestion('b244-q4', { question: '会被释放吗？' });
  store.releaseUserQuestions('b244-q4');
  const cancelled = await released.promise;
  assert.equal(cancelled.timedOut, true);
  assert.equal(cancelled.cancelled, true);
});

test('BLOCK-244 ask_user_question：返回 needQuestion + _questionPromise，回答后回传', async () => {
  const result = await tool_ask_user_question({
    question: '选择目标？',
    options: [{ id: 'deg', label: 'DEG' }],
    multiSelect: false,
    allowFreeText: true,
  }, { taskId: 'b244-tool' });
  assert.equal(result.ok, true);
  assert.equal(result.needQuestion, true);
  assert.ok(result.questionId);
  assert.equal(typeof result._questionPromise.then, 'function');
  const answered = store.answerUserQuestion('b244-tool', result.questionId, { selected: ['deg'], text: '补充' });
  assert.equal(answered.ok, true);
  const wake = await result._questionPromise;
  assert.equal(wake.answered, true);
  assert.deepEqual(wake.answer, { selected: ['deg'], text: '补充' });
});

test('BLOCK-244 ask_user_question：无任务上下文/非法选项 fail-closed', async () => {
  const noTask = await tool_ask_user_question({ question: 'hi' }, {});
  assert.equal(noTask.ok, false);
  assert.equal(noTask.error, 'task_required');

  const badOption = await tool_ask_user_question({
    question: 'hi',
    options: [{ label: '缺 id' }],
  }, { taskId: 'b244-bad' });
  assert.equal(badOption.ok, false);
  assert.equal(badOption.error, 'invalid_arguments');
});
