'use strict';

/**
 * routes/ai-agent/resume.js — BLOCK-38 P1：Agent 任务中断续跑。
 *
 * GET  /api/ai/agent/task/:taskId/resume  — 只读预览（确认弹层数据源，无副作用）
 * POST /api/ai/agent/task/:taskId/resume  — 执行续跑
 *
 * 语义：
 * - 仅接受服务重启清扫显式标记（interrupted_at 非空）的 failed agent_loop 任务；
 *   非中断失败诚实 409（有独立 retry_pending 自动重试链路），running 任务 409。
 * - 原 task 保持 failed 不可变（审计链）；续跑 = 同会话新建一条 agent_loop task，
 *   params.resumeOfTaskId 关联原任务；loop-orchestrator 依 conversationId 自动
 *   resume 原 loop run（_loopInit 的 getActiveLoopRunForConversation 机制）。
 * - 上下文权威源：原 task params.messages（createAgentTask 时保存的完整前端请求历史）
 *   + 由 task_events 重建的中断前执行进度摘要（工具调用/结果）注入为合成 user 指令。
 * - 取证摘要：llm-transcripts 会话末条（BLOCK-37 readLastRecord）——中断前最后一次
 *   模型调用的「最后状态」，供前端确认弹层展示。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const agentTaskStore = require('../../agent-task-store');
const { readLastRecord } = require('../../../shared-backend/llm-providers/io-transcript');

const DIGEST_MAX_LINES = 40;
const DIGEST_LINE_CHARS = 220;

function clip(text, max = DIGEST_LINE_CHARS) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

/** 从 task_events 重建中断前执行进度摘要（工具调用 + 结果，保尾部）。 */
function buildProgressDigest(events) {
  const lines = [];
  for (const ev of events || []) {
    const p = (ev && ev.payload) || {};
    if (ev.eventType === 'tool_call') {
      lines.push(`· 第${p.iteration || '?'}轮 调用 ${p.name}(${clip(JSON.stringify(p.args || {}))})`);
    } else if (ev.eventType === 'tool_result') {
      lines.push(`· 第${p.iteration || '?'}轮 结果 ${p.name}: ${clip(p.summary || 'ok')}`);
    } else if (ev.eventType === 'agent_progress' && p.content) {
      lines.push(`· 进度: ${clip(p.content)}`);
    }
  }
  return lines.slice(-DIGEST_MAX_LINES).join('\n');
}

/** 中断前最后一次模型调用摘要（取证层，诚实空态）。 */
function buildLastModelCallSummary(conversationId) {
  const dataDir = process.env.BIOF3_LOCAL_DATA_DIR
    || path.join(os.homedir(), 'Documents', 'BioF3-Local');
  const last = readLastRecord(conversationId, { dataDir });
  if (!last) return null;
  const toolCalls = Array.isArray(last.response && last.response.toolCalls)
    ? last.response.toolCalls
      .map((c) => (c && c.function && c.function.name) || (c && c.id) || 'unknown')
      .slice(0, 10)
    : undefined;
  return {
    ts: last.ts || null,
    kind: last.kind || null,
    model: last.model || null,
    provider: last.provider || null,
    finishReason: (last.response && last.response.finishReason) || null,
    toolCallNames: toolCalls,
    error: last.error || null,
    truncated: last.truncated === true,
  };
}

module.exports = {
  /**
   * @param {object} app Express app
   * @param {object} [deps] 外部注入（测试用）：deps.runAgentLoop 覆盖真实 loop
   */
  register(app, deps) {
    const injectedRunAgentLoop = deps && typeof deps.runAgentLoop === 'function' ? deps.runAgentLoop : null;

    // 共享校验：返回 { task } 或 { error: status, body }
    function authorizeTask(req, res) {
      const userId = req.user && req.user.id;
      if (!userId) {
        res.status(401).json({ status: 'error', error: '未登录' });
        return null;
      }
      const { taskId } = req.params;
      let task;
      try {
        task = agentTaskStore.getAgentTask(taskId);
      } catch {
        res.status(500).json({ status: 'error', error: '查询 task 失败' });
        return null;
      }
      if (!task) {
        res.status(404).json({ status: 'error', error: 'task 不存在' });
        return null;
      }
      if (task.user_id && task.user_id !== userId) {
        res.status(403).json({ status: 'error', error: '无权续跑该 task' });
        return null;
      }
      return { userId, taskId, task };
    }

    // BLOCK-38 P2: 只读预览——确认弹层展示「中断时间 + 中断前最后状态」，
    // 不产生任何副作用。非中断任务诚实返回 resumable:false，不报错。
    app.get('/api/ai/agent/task/:taskId/resume', (req, res) => {
      const auth = authorizeTask(req, res);
      if (!auth) return;
      const { taskId, task } = auth;
      const resumable = Boolean(task.interruptedAt) && task.status === 'failed';
      if (!resumable) {
        return res.json({ resumable: false, interruptedAt: null, lastModelCall: null, progressDigest: null });
      }
      const originalParams = task.params && typeof task.params === 'object' ? task.params : {};
      const conversationId = originalParams.conversationId || null;
      let digest = '';
      try {
        digest = buildProgressDigest(agentTaskStore.getAgentTaskEventsSince(taskId, 0, 1000000));
      } catch {}
      return res.json({
        resumable: true,
        interruptedAt: task.interruptedAt,
        lastModelCall: buildLastModelCallSummary(conversationId),
        progressDigest: digest || null,
      });
    });

    app.post('/api/ai/agent/task/:taskId/resume', async (req, res) => {
      const auth = authorizeTask(req, res);
      if (!auth) return;
      const userId = auth.userId;
      const taskId = auth.taskId;
      const task = auth.task;
      if (task.agent_status === 'running' || task.status === 'running') {
        return res.status(409).json({ status: 'error', error: '任务仍在运行，无需续跑' });
      }
      if (!task.interruptedAt || task.status !== 'failed') {
        return res.status(409).json({
          status: 'error',
          error: '仅服务中断的任务可以续跑；其他失败任务请直接重试或重新发起',
        });
      }

      const originalParams = task.params && typeof task.params === 'object' ? task.params : {};
      const originalMessages = Array.isArray(originalParams.messages) ? originalParams.messages : [];
      if (originalMessages.length === 0) {
        return res.status(409).json({ status: 'error', error: '原任务缺少可复用的请求上下文，无法续跑' });
      }
      const conversationId = originalParams.conversationId || null;
      const context = originalParams.context && typeof originalParams.context === 'object'
        ? originalParams.context
        : {};

      // 中断前执行进度（task_events）→ 合成恢复指令（不落 conversation 消息，transcript 可见即取证）
      let digest = '';
      try {
        digest = buildProgressDigest(agentTaskStore.getAgentTaskEventsSince(taskId, 0, 1000000));
      } catch {}
      const resumeInstruction = [
        '=== 任务恢复（系统注入，非用户输入） ===',
        '上次执行因服务重启中断。中断前的执行进度：',
        digest || '（无已记录的工具执行）',
        '请基于以上进度继续完成原任务；已完成的步骤不要重复执行。',
      ].join('\n');
      const resumeMessages = [...originalMessages, { role: 'user', content: resumeInstruction }];

      // 模型与凭据按当前设置重新解析（params 不持久化 apiKey，重启后凭据可能已更换）
      const { getChatModelPreset, getChatModelCredential } = require('../../helpers/ai-settings');
      let selectedPreset = null;
      try {
        selectedPreset = getChatModelPreset(req.body && req.body.modelPresetId);
      } catch {}
      const providerName = (selectedPreset && selectedPreset.provider) || 'deepseek';
      const providerLabel = (selectedPreset && selectedPreset.label) || providerName;
      const modelName = (selectedPreset && selectedPreset.model) || originalParams.modelName;
      const baseUrl = selectedPreset && selectedPreset.baseUrl;
      const apiKey = getChatModelCredential(selectedPreset);

      const lastModelCall = buildLastModelCallSummary(conversationId);

      let newTaskId;
      try {
        newTaskId = agentTaskStore.createAgentTask({
          status: 'running',
          agentStatus: 'running',
          userId,
          params: {
            messages: resumeMessages,
            context,
            conversationId,
            providerName,
            providerLabel,
            modelName,
            kind: 'primary',
            parentTaskId: null,
            resumeOfTaskId: taskId,
          },
        }).taskId;
      } catch (e) {
        return res.status(500).json({ status: 'error', error: '创建续跑 task 失败: ' + e.message });
      }

      // 原 task 追加续跑溯源事件（只追加，不改终态）
      try {
        const priorEvents = agentTaskStore.getAgentTaskEventsSince(taskId, 0, 1000000);
        const nextSeq = priorEvents.length > 0 ? priorEvents[priorEvents.length - 1].seq + 1 : 1;
        agentTaskStore.appendAgentTaskEvent(taskId, nextSeq, 'task_resumed', {
          newTaskId,
          resumedAt: new Date().toISOString(),
        });
      } catch {}

      const { aiTaskConcurrencyAcquire, aiTaskConcurrencyRelease } = require('../../helpers/runtime');
      const acquired = aiTaskConcurrencyAcquire(userId, newTaskId);
      if (!acquired) {
        agentTaskStore.markAgentTaskFailed(newTaskId, '并发限制');
        return res.status(429).json({ status: 'error', error: '并发限制，请稍后再试' });
      }

      let _activeConv = null;
      try {
        const convSync = require('../../helpers/conversations');
        _activeConv = convSync.getOrCreateActiveConversation(userId, {
          conversationId,
          page: context && context.page,
          projectId: context && context.projectId,
          titleHint: '恢复任务',
        });
      } catch {}

      const runAgentLoop = injectedRunAgentLoop || require('../../agent-runner').runAgentLoop;
      setImmediate(() => {
        runAgentLoop({
          messages: resumeMessages,
          context,
          userId,
          conversationId: _activeConv && _activeConv.id,
          _activeConv,
          apiKey,
          providerName,
          providerLabel,
          modelName,
          profileId: selectedPreset && selectedPreset.id,
          baseUrl,
          taskId: newTaskId,
          kind: 'primary',
          parentLoopRunId: null,
          onEvent: () => {},
          shouldAbort: () => agentTaskStore.isAgentTaskCancellationRequested(newTaskId),
        }).catch((e) => {
          try { agentTaskStore.markAgentTaskFailed(newTaskId, e && e.message ? e.message : String(e)); } catch {}
          try { aiTaskConcurrencyRelease(userId, newTaskId); } catch {}
        });
      });

      return res.json({
        taskId: newTaskId,
        status: 'running',
        kind: 'primary',
        parentTaskId: null,
        conversationId,
        resumeOfTaskId: taskId,
        interruptedAt: task.interruptedAt,
        lastModelCall,
      });
    });
  },
  buildProgressDigest,
  buildLastModelCallSummary,
};
