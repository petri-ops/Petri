'use strict';

/**
 * helpers/job-events.js — BLOCK-126 P1（G0-PLATFORM PL-2 终态失效事件）。
 *
 * 语义：tool_job 到达终态时向 jobs 域发布 SSE 失效信号（cache-invalidation
 * 模式，只发「数据变了」不推数据本体；前端 useInvalidationStream 消费后
 * 按需刷新既有 REST）。CK-03 建立的通道此前仅 agent-task-store 发布，
 * tools-executor 侧终态缺失导致非对话内完成的 job 要等 60s 兜底轮询。
 *
 * 纪律：通知是 best-effort——永不 throw（SSE 写失败静默，断线由心跳/前端
 * 重连兜底），与 agent-task-store 的调用姿势同款。
 */

const eventBus = require('./event-bus');

/** 终态收敛后广播。state ∈ completed | failed | cancelled。 */
function publishJobTerminalState(jobId, state, extra) {
  try {
    eventBus.publishInvalidation('jobs', { toolJobId: jobId, state, ...(extra || {}) });
  } catch { /* 通知面故障不影响作业链 */ }
}

module.exports = { publishJobTerminalState };
