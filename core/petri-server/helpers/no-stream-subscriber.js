'use strict';

/**
 * helpers/no-stream-subscriber.js — 后台 run 的「无 SSE 订阅者」显式占位（POST-S7 H2/B-08）。
 *
 * 为什么需要它：`runAgentLoop` 接受 `onEvent` 回调用于**实时**转发事件给一个 SSE 响应流。
 * 后台派发的子智能体、续跑任务、以及非流式提交链**没有**订阅者——它们的事件仍然由 loop
 * 自身写入 `task_events`（可观测性走 DB，不走这条回调）。
 *
 * 此前这三处写成 `onEvent: () => {}`：行为没错，但它与「忘了处理事件」的空 catch 长得一样，
 * 审计时无法区分。改成具名函数后，**意图**进入代码（也和 silent-catch 棘轮口径对齐：
 * 有留痕的忽略不算债务）。
 *
 * 纪律：不要把它用在有 SSE 响应的地方——那会把用户可见的事件流吞掉。
 */
function noStreamSubscriber() {}

module.exports = { noStreamSubscriber };
