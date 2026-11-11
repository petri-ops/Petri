'use strict';
const { AGENT_TASK_EVENTS_ALL_LIMIT } = require('../../helpers/agent-task-event-limits'); // post-H9 K2/K-12: 全量回放上限具名单源

/**
 * routes/ai-agent/events.js — events 子域（PHASE 2.2b）
 *
 * 下沉的端点（来自 routes/ai-agent.js 第 1126-1219 行）：
 *   GET /api/ai/agent/task/:taskId — SSE 订阅端点
 *
 * 共享依赖：
 *   - agentTaskStore（agent-task-store.js）
 *
 * L3（BLOCK-407 / 蓝图 L-12/13/14）行为修订：
 *   - 终态判定（原 :113 裸奔）包进 try/catch：store 抛错 → 结构化 error 帧
 *     （reasonCode=sse_task_read_failed）+ [DONE] + res.end（SSE 不再悬挂/不再 reject）。
 *   - close listener 提前到 flushHeaders 之后（finish 单点清理 heartbeat+poll）。
 *   - 500ms 轮询 catch 计数熔断：连续 3 次失败 → error 帧（sse_poll_failed, retryable）
 *     + 清理 + res.end（原「下轮继续」无界静默移除）；瞬时单次失败自愈不熔断。
 *   - findFallbackChild / 回放两处空 catch 改具名降级（fallback_lookup_failed /
 *     event_replay_failed），不再空吞。
 */

const agentTaskStore = require('../../agent-task-store');

module.exports = {
    register(app) {
    // ===== AGENT_TASK_MODE_v1：SSE 订阅端点（套 tools-metadata.js 模板）=====
    // 前端 POST /api/ai/agent 拿 taskId 后，订阅本端点拿事件流（回放 + 实时）。
    // 支持断线重连：?afterSeq=N 从第 N+1 条开始（前端记 lastSeq，重连时续传）。
    app.get('/api/ai/agent/task/:taskId', async (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) {
        return res.status(401).json({ status: 'error', error: '未登录' });
      }
      const { taskId } = req.params;
      const afterSeq = Math.max(0, parseInt(req.query.afterSeq, 10) || 0);

      let task;
      try {
        task = agentTaskStore.getAgentTask(taskId);
      } catch {
        return res.status(500).json({ status: 'error', error: '查询 task 失败' });
      }
      if (!task) {
        return res.status(404).json({ status: 'error', error: 'task 不存在' });
      }
      // 越权校验：agent task 有 user_id，必须匹配
      if (task.user_id && task.user_id !== userId) {
        return res.status(403).json({ status: 'error', error: '无权访问该 task' });
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders && res.flushHeaders();

      const sseSend = (obj) => {
        try {
          res.write('data: ' + JSON.stringify(obj) + '\n\n');
        } catch { /* 客户端已断开——写失败忽略（L-14 具名：sse_write_after_close） */ }
      };
      // [DONE] 是 SSE 协议哨兵而非 JSON 事件——必须写裸字符串。
      // 曾用 sseSend('[DONE]') 经 JSON.stringify 序列化成带引号的 "[DONE]"，
      // 前端 copilotClient 匹配裸 [DONE] 失败 → 每个正常完成的 task 都被
      // 判为「在完成前中断」→ 90s 重连烧窗后报 AgentStreamDisconnected。
      const sseDone = () => {
        try {
          res.write('data: [DONE]\n\n');
        } catch { /* 客户端已断开——写失败忽略（L-14 具名：sse_write_after_close） */ }
      };
      // BLOCK-159 P0-3 — 15s SSE 注释帧心跳（与终端流 mobile-gateway/index.js
      // 同款）：空闲期（模型思考中）零字节流动，中转 nginx 默认 60s 读超时会
      // 掐断长任务流。注释行对 EventSource 与手工解析器（^data: 匹配）天然透明。
      const heartbeat = setInterval(() => {
        try { res.write(': ping\n\n'); } catch { /* closed */ }
      }, 15_000);
      const stopHeartbeat = () => clearInterval(heartbeat);

      let lastSeq = afterSeq;
      let finished = false;
      let poll = null;
      // L3-1（L-12）：finish 单点——heartbeat/poll 清理 + res.end 只走这里，
      // close listener（下方提前注册）与终态/熔断路径共用，任何路径不再泄漏 interval。
      const finish = (withDone) => {
        if (finished) return;
        finished = true;
        stopHeartbeat();
        if (poll) clearInterval(poll);
        if (withDone) sseDone();
        try { res.end(); } catch { /* 已关闭 */ }
      };
      // L3-1（L-12）：close listener 提前注册（原实现在 handler 尾部——若中途 return
      // 路径抛错则永不注册，heartbeat/interval 泄漏）。
      req.on('close', () => finish(false));

      const isTerminal = (t) => t && ['done', 'failed', 'cancelled'].includes(t.agent_status);

      // BLOCK-56 P1 — 失败终态时查找任务级降级续跑子任务（model_fallback 事件
      // 携带 newTaskId），error 载荷附带 fallbackTaskId 供前端自动切换订阅。
      const findFallbackChild = () => {
        try {
          const events = agentTaskStore.getAgentTaskEventsSince(taskId, 0, AGENT_TASK_EVENTS_ALL_LIMIT);
          for (let i = events.length - 1; i >= 0; i -= 1) {
            const ev = events[i];
            if (ev.eventType === 'model_fallback' && ev.payload && ev.payload.newTaskId) return ev.payload;
          }
        } catch (e) {
          // L3-2（L-14）：空吞改具名降级——查询失败时 failedPayload 显式标注，
          // 前端投影读不到 fallbackTaskId 即走人工续跑，不再静默缺字段。
          console.warn(`[events] fallback lookup failed (task=${taskId}):`, e && e.message);
          return { lookupFailed: 'fallback_lookup_failed' };
        }
        return null;
      };
      const failedPayload = (t) => {
        const fb = findFallbackChild();
        return {
          event: 'error',
          error: t.error || 'agent task 失败',
          resumable: Boolean(t.interruptedAt),
          interruptedAt: t.interruptedAt || null,
          ...(fb && !fb.lookupFailed ? {
            fallbackTaskId: fb.newTaskId,
            fallbackLabel: fb.toProfileLabel || null,
            fallbackCategory: fb.category || null,
          } : {}),
          ...(fb && fb.lookupFailed ? { lookupFailed: fb.lookupFailed } : {}),
        };
      };

      // 1. 回放已存事件（afterSeq+1 起）
      try {
        const events = agentTaskStore.getAgentTaskEventsSince(taskId, afterSeq);
        for (const ev of events) {
          sseSend({ seq: ev.seq, eventType: ev.eventType, payload: ev.payload });
          lastSeq = ev.seq;
        }
      } catch (e) {
        // L3-2（L-14）：回放失败显式重置 lastSeq=afterSeq 并发结构化标注帧
        //（原空吞会让重连客户端以为回放成功、静默丢事件）。
        lastSeq = afterSeq;
        console.warn(`[events] replay failed (task=${taskId}):`, e && e.message);
        sseSend({ event: 'error', reasonCode: 'event_replay_failed', retryable: true, lastSeqResetTo: afterSeq });
      }

      // 2. 若 task 已终态，发 done/error 后结束（L3-1：判定包进 try/catch）
      let freshTask;
      try {
        freshTask = agentTaskStore.getAgentTask(taskId);
      } catch (e) {
        console.warn(`[events] terminal read failed (task=${taskId}):`, e && e.message);
        sseSend({ event: 'error', reasonCode: 'sse_task_read_failed', retryable: true, message: e && e.message });
        finish(true);
        return;
      }
      if (isTerminal(freshTask)) {
        if (freshTask.agent_status === 'failed') {
          // BLOCK-38 P1: 中断任务（服务重启清扫标记）附带 resumable 标记，前端据此显示「继续执行」
          // BLOCK-56 P1: 附带 fallbackTaskId（任务级降级续跑），前端自动切换订阅
          sseSend(failedPayload(freshTask));
        } else if (freshTask.agent_status === 'cancelled') {
          sseSend({ event: 'agent_cancelled' });
        } else {
          // BLOCK-31 P1: done 事件携带权威 filesChanged 清单
          sseSend({ event: 'done', filesChanged: freshTask.filesChanged || [] });
        }
        finish(true);
        return;
      }

      // 3. 轮询增量事件到终态（500ms 间隔；L3-2（L-13）：失败计数熔断）
      let consecutiveFails = 0;
      const POLL_MAX_CONSECUTIVE_FAILS = 3;
      poll = setInterval(() => {
        try {
          const events = agentTaskStore.getAgentTaskEventsSince(taskId, lastSeq);
          for (const ev of events) {
            sseSend({ seq: ev.seq, eventType: ev.eventType, payload: ev.payload });
            lastSeq = ev.seq;
          }
          const t = agentTaskStore.getAgentTask(taskId);
          if (isTerminal(t)) {
            if (t.agent_status === 'failed') {
              // BLOCK-38 P1: 轮询路径同样携带 resumable 标记；BLOCK-56 P1: 附带 fallbackTaskId
              sseSend(failedPayload(t));
            } else if (t.agent_status === 'cancelled') {
              sseSend({ event: 'agent_cancelled' });
            } else {
              // BLOCK-31 P1: done 事件携带权威 filesChanged 清单
              sseSend({ event: 'done', filesChanged: t.filesChanged || [] });
            }
            finish(true);
            return;
          }
          consecutiveFails = 0;
        } catch (e) {
          consecutiveFails += 1;
          console.warn(`[events] poll failed (task=${taskId}) ${consecutiveFails}/${POLL_MAX_CONSECUTIVE_FAILS}:`, e && e.message);
          if (consecutiveFails >= POLL_MAX_CONSECUTIVE_FAILS) {
            // L3-2（L-13）：连续 3 次失败熔断——结构化 error 帧 + 清理 + 关流
            //（原「下轮继续」在 DB 持续故障时每 500ms 无限静默重试）。
            sseSend({ event: 'error', reasonCode: 'sse_poll_failed', retryable: true, consecutiveFails });
            finish(true);
          }
        }
      }, 500);
    });
    },
};
