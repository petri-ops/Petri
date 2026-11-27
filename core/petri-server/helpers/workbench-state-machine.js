'use strict';

/**
 * item88 工作台任务状态机（设计稿 §4.4 原词）。机械层零 LLM 成本：
 * 纯函数决定下一态，调用方把每次变更落 task_events。
 */

const STATES = Object.freeze([
  'draft', 'confirm', 'queued', 'running', 'blocked', 'needs-user', 'approval',
  'reviewing', 'rework', 'delivered', 'accepted', 'cancelled', 'failed',
]);

const TRANSITIONS = Object.freeze({
  draft: ['confirm', 'cancel'],
  confirm: ['queue', 'cancel'],
  queued: ['start', 'cancel'],
  running: ['block', 'needs-user', 'request-approval', 'review', 'submit_review', 'cancel', 'fail'],
  blocked: ['start', 'cancel', 'fail'],
  'needs-user': ['start', 'cancel', 'fail'],
  approval: ['start', 'cancel', 'fail'],
  reviewing: ['rework', 'deliver', 'accept', 'cancel', 'fail'],
  rework: ['review', 'deliver', 'cancel', 'fail'],
  delivered: ['accept', 'rework', 'cancel', 'fail'],
  accepted: [],
  cancelled: [],
  failed: ['retry'],
});

const EVENT_TARGET = Object.freeze({
  confirm: 'confirm', queue: 'queued', start: 'running', block: 'blocked',
  'needs-user': 'needs-user', 'request-approval': 'approval', review: 'reviewing',
  submit_review: 'reviewing', rework: 'rework', deliver: 'delivered',
  accept: 'accepted', cancel: 'cancelled', fail: 'failed', retry: 'queued',
});

function transitionRun(state, event) {
  if (!STATES.includes(state)) return { ok: false, error: 'invalid_state', from: state, event };
  const transitions = Object.entries(TRANSITIONS).find(([key]) => key === state)?.[1] || [];
  if (!transitions.includes(event)) {
    return { ok: false, error: 'invalid_transition', from: state, event };
  }
  const target = Object.entries(EVENT_TARGET).find(([key]) => key === event)?.[1];
  return { ok: true, state: target };
}

/** 每次状态变更机械落 task_events（append-only，seq 由 store 侧保证）。 */
function appendWorkbenchEvent({ db, taskId, from, to, event, payload = {} }) {
  const seqRow = db.prepare('SELECT COALESCE(MAX(seq),0) + 1 AS seq FROM task_events WHERE task_id = ?').get(taskId);
  db.prepare('INSERT INTO task_events (task_id, seq, event_type, payload, created_at) VALUES (?,?,?,?,?)')
    .run(taskId, seqRow.seq, `workbench.transition:${event}`, JSON.stringify({ from, to, ...payload }), new Date().toISOString());
  return { ok: true, seq: seqRow.seq };
}

module.exports = { STATES, TRANSITIONS, transitionRun, appendWorkbenchEvent };
