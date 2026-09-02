'use strict';

/**
 * routes/ai-agent/events.js — events 子域（PHASE 2.2b）
 *
 * 下沉的端点（来自 routes/ai-agent.js 第 1126-1219 行）：
 *   GET /api/ai/agent/task/:taskId — SSE 订阅端点
 *
 * 共享依赖：
 *   - agentTaskStore（agent-task-store.js）
 *
 * 行为 100% 兼容：try/catch 顺序、status code、response shape 保持不变。
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
      } catch (e) {
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
        } catch {}
      };

      let lastSeq = afterSeq;
      const isTerminal = (t) => t && ['done', 'failed', 'cancelled'].includes(t.agent_status);

      // 1. 回放已存事件（afterSeq+1 起）
      try {
        const events = agentTaskStore.getAgentTaskEventsSince(taskId, afterSeq);
        for (const ev of events) {
          sseSend({ seq: ev.seq, eventType: ev.eventType, payload: ev.payload });
          lastSeq = ev.seq;
        }
      } catch {}

      // 2. 若 task 已终态，发 done/error 后结束
      const freshTask = agentTaskStore.getAgentTask(taskId);
      if (isTerminal(freshTask)) {
        if (freshTask.agent_status === 'failed') {
          // BLOCK-38 P1: 中断任务（服务重启清扫标记）附带 resumable 标记，前端据此显示「继续执行」
          sseSend({
            event: 'error',
            error: freshTask.error || 'agent task 失败',
            resumable: Boolean(freshTask.interruptedAt),
            interruptedAt: freshTask.interruptedAt || null,
          });
        } else if (freshTask.agent_status === 'cancelled') {
          sseSend({ event: 'agent_cancelled' });
        } else {
          // BLOCK-31 P1: done 事件携带权威 filesChanged 清单
          sseSend({ event: 'done', filesChanged: freshTask.filesChanged || [] });
        }
        sseSend('[DONE]');
        return res.end();
      }

      // 3. 轮询增量事件到终态（500ms 间隔）
      const poll = setInterval(() => {
        try {
          const events = agentTaskStore.getAgentTaskEventsSince(taskId, lastSeq);
          for (const ev of events) {
            sseSend({ seq: ev.seq, eventType: ev.eventType, payload: ev.payload });
            lastSeq = ev.seq;
          }
          const t = agentTaskStore.getAgentTask(taskId);
          if (isTerminal(t)) {
            clearInterval(poll);
            if (t.agent_status === 'failed') {
              // BLOCK-38 P1: 轮询路径同样携带 resumable 标记
              sseSend({
                event: 'error',
                error: t.error || 'agent task 失败',
                resumable: Boolean(t.interruptedAt),
                interruptedAt: t.interruptedAt || null,
              });
            } else if (t.agent_status === 'cancelled') {
              sseSend({ event: 'agent_cancelled' });
            } else {
              // BLOCK-31 P1: done 事件携带权威 filesChanged 清单
              sseSend({ event: 'done', filesChanged: t.filesChanged || [] });
            }
            sseSend('[DONE]');
            res.end();
          }
        } catch (e) {
          // 轮询出错不终止，下轮继续
        }
      }, 500);

      // 用户关闭订阅：只清 interval，不影响后台 loop（loop 继续跑，事件写 task_events 待重连）
      req.on('close', () => {
        clearInterval(poll);
      });
    });
    },
};
