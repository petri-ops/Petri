'use strict';

/**
 * routes/agent-review.js — BLOCK-25 Codex-parity AI code review launch.
 *
 * POST /api/agent/review — start a read-only review sub-agent over the
 * project workspace repository. The run persists events into the shared
 * agent task store, so the renderer subscribes via the existing
 * GET /api/ai/agent/task/:taskId SSE and cancels via the existing cancel
 * route. Findings arrive as a final `review_output` event.
 */

const express = require('express');

const dbMod = require('../db');
const agentTaskStore = require('../agent-task-store');
const { aiTaskConcurrencyAcquire, aiTaskConcurrencyRelease } = require('../helpers/runtime');
const { normalizeReviewTarget, userFacingHint } = require('../agent-review/review-prompts');
const { runReviewTask } = require('../agent-review/review-runner');

module.exports = function registerAgentReviewRoute(app) {
  app.post('/api/agent/review', express.json({ limit: '64kb' }), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(401).json({ status: 'error', error: '未登录' });
    }

    const { projectId, target, modelPresetId, modelName: requestedModelName } = req.body || {};
    if (!projectId || typeof projectId !== 'string') {
      return res.status(400).json({ status: 'error', error: 'projectId 必填' });
    }

    const normalized = normalizeReviewTarget(target);
    if (!normalized.ok) {
      return res.status(400).json({ status: 'error', error: normalized.error });
    }

    let project = null;
    try {
      project = dbMod.getProject(projectId);
    } catch {
      return res.status(500).json({ status: 'error', error: '查询项目失败' });
    }
    if (!project) {
      return res.status(404).json({ status: 'error', error: '项目不存在' });
    }
    const ownerId = String(project.user_id || 'local-user');
    if (ownerId !== String(userId)) {
      return res.status(403).json({ status: 'error', error: '无权审阅该项目' });
    }
    const workspacePath = project.workspace_path;
    if (!workspacePath || typeof workspacePath !== 'string') {
      return res.status(409).json({ status: 'error', error: '项目没有可用的工作区目录' });
    }

    const {
      getChatModelPreset,
      getChatModelCredential,
    } = require('../helpers/ai-settings');
    const selectedPreset = getChatModelPreset(modelPresetId);
    const providerName = (selectedPreset && selectedPreset.provider) || require('../helpers/ai-settings').getChatProviderName();
    const modelName = typeof requestedModelName === 'string' && requestedModelName.trim()
      ? requestedModelName.trim().slice(0, 200)
      : selectedPreset && selectedPreset.model;
    const baseUrl = selectedPreset && selectedPreset.baseUrl;
    const apiKey = getChatModelCredential(selectedPreset);

    let taskId;
    try {
      taskId = agentTaskStore.createAgentTask({
        status: 'running',
        agentStatus: 'running',
        userId,
        params: {
          kind: 'review',
          projectId: String(projectId),
          target: normalized.target,
          providerName,
          modelName: modelName || null,
        },
      }).taskId;
    } catch (e) {
      return res.status(500).json({ status: 'error', error: '创建 review task 失败: ' + e.message });
    }

    const acquired = aiTaskConcurrencyAcquire(userId, taskId);
    if (!acquired) {
      agentTaskStore.markAgentTaskFailed(taskId, '并发限制');
      return res.status(429).json({ status: 'error', error: '并发限制，请稍后再试' });
    }

    let seq = 0;
    const emit = (obj) => {
      try {
        seq += 1;
        agentTaskStore.appendAgentTaskEvent(taskId, seq, (obj && obj.event) || 'delta', obj);
      } catch {}
    };

    setImmediate(() => {
      runReviewTask({
        taskId,
        userId,
        workspacePath,
        target: normalized.target,
        apiKey,
        providerName,
        modelName,
        baseUrl,
        profileId: selectedPreset && selectedPreset.id,
        shouldAbort: () => agentTaskStore.isAgentTaskCancellationRequested(taskId),
        emit,
      })
        .then((result) => {
          if (result && result.ok) {
            agentTaskStore.markAgentTaskDone(taskId);
          } else {
            agentTaskStore.markAgentTaskFailed(taskId, (result && result.error) || 'review failed');
          }
        })
        .catch((e) => {
          agentTaskStore.markAgentTaskFailed(taskId, e && e.message ? e.message : String(e));
        })
        .finally(() => {
          try { aiTaskConcurrencyRelease(userId, taskId); } catch {}
        });
    });

    return res.json({
      taskId,
      status: 'running',
      kind: 'review',
      target: normalized.target,
      userFacingHint: userFacingHint(normalized.target),
    });
  });
};
