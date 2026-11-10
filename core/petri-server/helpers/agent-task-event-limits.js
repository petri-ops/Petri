'use strict';

/**
 * post-H9 K2 / K-12 — agent 任务事件「全量回放」上限的具名单一来源。
 *
 * 背景：生产里 14 处调用把 `1000000` 作为第三参硬编码传给
 * `getAgentTaskEventsSince(taskId, 0, …)`，语义是「取全量事件」但无名字、
 * 无上限契约，改一处漏一处。本模块把该字面量收编为具名常量；
 * SQL 仍是 `ORDER BY seq ASC LIMIT ?`（agent-task-store.js:406-409），
 * 默认 `limit = 500` 与 SSE 回放水位语义零改动（不撤销既有裁决）。
 *
 * 红线：此值不是「建议上限」，是既有行为的具名化；任何数值变更须走
 * 事件回放/续传的前后同套绿 + 负测，不得在调用点私自放大。
 */
const AGENT_TASK_EVENTS_ALL_LIMIT = 1000000;

module.exports = { AGENT_TASK_EVENTS_ALL_LIMIT };
