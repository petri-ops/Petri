'use strict';

/**
 * routes/automation.js — Q7（BLOCK-256）目标与定时任务 REST 面。
 *
 * 数据面：automation-store（单一真相）；执行面：automation-runner 复用
 * POST /api/ai/agent。所有操作 user-scoped（desktop-local 本地用户）。
 */

const express = require('express');
const store = require('../helpers/automation-store');
const { runScheduleById } = require('../helpers/automation-runner');

function userIdOf(req) {
  return (req.user && req.user.id) || null;
}

function fail(res, result, status = 400) {
  return res.status(status).json({ ok: false, error: result.error || 'invalid_request', message: result.message || '' });
}

module.exports = function registerAutomationRoutes(app) {
  app.get('/api/automation', async (req, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
    const result = store.getAutomationSnapshot({ projectId, userId: userIdOf(req) });
    if (!result.ok) return fail(res, result, 400);
    res.json(result);
  });

  app.post('/api/schedules', express.json({ limit: '32kb' }), async (req, res) => {
    const result = store.createSchedule({
      userId: userIdOf(req),
      projectId: req.body && req.body.projectId,
      goalId: req.body && req.body.goalId,
      title: req.body && req.body.title,
      prompt: req.body && req.body.prompt,
      kind: req.body && req.body.kind,
      intervalMinutes: req.body && req.body.intervalMinutes,
      reminderText: req.body && req.body.reminderText,
      workflowScript: req.body && req.body.workflowScript,
      workflowArgs: req.body && req.body.workflowArgs,
      enabled: req.body ? req.body.enabled !== false : true,
    });
    if (!result.ok) return fail(res, result, 400);
    res.json(result);
  });

  app.post('/api/schedules/:id/toggle', express.json({ limit: '4kb' }), async (req, res) => {
    const result = store.setScheduleEnabled({
      id: req.params.id,
      enabled: Boolean(req.body && req.body.enabled),
      userId: userIdOf(req),
    });
    if (!result.ok) return fail(res, result, 404);
    res.json(result);
  });

  app.post('/api/schedules/:id/run', async (req, res) => {
    const schedule = store.getSchedule(req.params.id);
    const userId = userIdOf(req);
    if (!schedule || (userId && schedule.user_id && schedule.user_id !== userId)) {
      return fail(res, { error: 'schedule_not_found', message: '定时计划不存在。' }, 404);
    }
    const result = await runScheduleById(req.params.id);
    if (result.status === 'not_found') return fail(res, { error: 'schedule_not_found', message: '定时计划不存在。' }, 404);
    res.json({ ok: true, result });
  });

  app.delete('/api/schedules/:id', async (req, res) => {
    const result = store.deleteSchedule({ id: req.params.id, userId: userIdOf(req) });
    if (!result.ok) return fail(res, result, 404);
    res.json(result);
  });

  app.post('/api/goals/:id/status', express.json({ limit: '4kb' }), async (req, res) => {
    const result = store.updateGoal({
      id: req.params.id,
      status: req.body && req.body.status,
      userId: userIdOf(req),
    });
    if (!result.ok) return fail(res, result, result.error === 'goal_not_found' ? 404 : 400);
    res.json(result);
  });

  app.get('/api/schedules/reminders', async (req, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
    const rows = projectId
      ? store.listReminders({ projectId, unacknowledged: req.query.unacknowledged !== '0' })
      : store.listAllUnacknowledgedReminders();
    res.json({ ok: true, reminders: rows });
  });

  app.post('/api/schedules/reminders/:id/ack', async (req, res) => {
    res.json(store.acknowledgeReminder(req.params.id));
  });
};
